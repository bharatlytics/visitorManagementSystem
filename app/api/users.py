"""
VMS Users Management API

Complete user management for standalone VMS operation:
- List users in company
- Create/invite new users
- Update user roles and status
- Deactivate users
- Reset passwords

When integrated with Platform, user management syncs with Platform users.
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime
from passlib.hash import bcrypt
import secrets

from app.db import users_collection, companies_collection
from app.auth import require_auth, require_company_access
from app.services.rbac import require_role, require_permission, get_available_roles, AVAILABLE_ROLES
from app.utils import get_current_utc, validate_required_fields, error_response, validate_email_format

users_bp = Blueprint('users', __name__)


def convert_objectids(obj):
    """Recursively convert ObjectIds to strings"""
    if isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(i) for i in obj]
    elif isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def sanitize_user(user: dict) -> dict:
    """Remove sensitive fields from user object"""
    user = convert_objectids(user)
    # Remove password hash
    user.pop('password', None)
    user.pop('resetToken', None)
    user.pop('resetTokenExpiry', None)
    return user


@users_bp.route('/', methods=['GET'])
@require_company_access
@require_permission('users.read')
def list_users():
    """
    List all users in the company.
    
    Query Parameters:
        companyId (required): Company ObjectId
        status (optional): Filter by status (active, inactive, invited)
        role (optional): Filter by role
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        # Build query
        query = {}
        try:
            query['companyId'] = ObjectId(company_id)
        except:
            query['companyId'] = company_id
        
        status = request.args.get('status')
        if status:
            query['status'] = status
        
        role = request.args.get('role')
        if role:
            query['role'] = role
        
        users = list(users_collection.find(query).sort('createdAt', -1))
        
        # Sanitize users (remove passwords)
        sanitized_users = [sanitize_user(u) for u in users]
        
        return jsonify({
            'users': sanitized_users,
            'count': len(sanitized_users)
        }), 200
        
    except Exception as e:
        print(f"Error listing users: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@users_bp.route('/<user_id>', methods=['GET'])
@require_company_access
@require_permission('users.read')
def get_user(user_id):
    """Get a single user by ID"""
    try:
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Verify user belongs to same company
        company_id = request.args.get('companyId')
        if str(user.get('companyId')) != company_id:
            return error_response('User not found', 404)
        
        return jsonify({
            'user': sanitize_user(user)
        }), 200
        
    except InvalidId:
        return error_response('Invalid user ID', 400)
    except Exception as e:
        print(f"Error getting user: {e}")
        return error_response(str(e), 500)


@users_bp.route('/', methods=['POST'])
@require_company_access
@require_permission('users.create')
def create_user():
    """
    Create a new user in the company.
    
    Request Body:
        companyId (required): Company ObjectId
        email (required): User email
        name (required): User name
        role (required): User role (receptionist, security_guard, manager, etc.)
        password (optional): If not provided, generates invite token
        phone (optional): User phone number
        department (optional): Department name
        sendInvite (optional): Send email invitation
    """
    try:
        data = request.json or {}
        
        required_fields = ['companyId', 'email', 'name', 'role']
        valid, msg = validate_required_fields(data, required_fields)
        if not valid:
            return error_response(msg, 400)
        
        # Validate email format
        if not validate_email_format(data['email']):
            return error_response('Invalid email format', 400)
        
        # Validate role
        valid_roles = [r['id'] for r in AVAILABLE_ROLES]
        if data['role'] not in valid_roles:
            return error_response(f'Invalid role. Must be one of: {valid_roles}', 400)
        
        # Check if email already exists
        existing = users_collection.find_one({'email': data['email'].lower()})
        if existing:
            return error_response('User with this email already exists', 409)
        
        # Prepare company ID
        try:
            company_id = ObjectId(data['companyId'])
        except:
            company_id = data['companyId']
        
        # Create user object
        user_doc = {
            '_id': ObjectId(),
            'email': data['email'].lower(),
            'name': data['name'],
            'role': data['role'],
            'companyId': company_id,
            'phone': data.get('phone'),
            'department': data.get('department'),
            'status': 'active',
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'system'),
            'updatedAt': get_current_utc()
        }
        
        # Handle password or invite
        if data.get('password'):
            # Direct password provided
            user_doc['password'] = bcrypt.hash(data['password'])
        else:
            # Generate invite token
            invite_token = secrets.token_urlsafe(32)
            user_doc['status'] = 'invited'
            user_doc['inviteToken'] = invite_token
            user_doc['inviteExpiry'] = get_current_utc() + timedelta(days=7)
        
        users_collection.insert_one(user_doc)
        
        response = {
            'message': 'User created successfully',
            'user': sanitize_user(user_doc)
        }
        
        # Include invite token for admin (so they can share it)
        if 'inviteToken' in user_doc:
            response['inviteToken'] = user_doc['inviteToken']
            response['inviteUrl'] = f"/auth/accept-invite?token={user_doc['inviteToken']}"
        
        return jsonify(response), 201
        
    except Exception as e:
        print(f"Error creating user: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@users_bp.route('/<user_id>', methods=['PATCH'])
@require_company_access
@require_permission('users.update')
def update_user(user_id):
    """
    Update user details.
    
    Request Body (all optional):
        name, role, phone, department, status
    """
    try:
        data = request.json or {}
        
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Verify user belongs to same company
        company_id = data.get('companyId') or request.args.get('companyId')
        if str(user.get('companyId')) != company_id:
            return error_response('User not found', 404)
        
        # Build update fields
        update_fields = {}
        allowed_fields = ['name', 'role', 'phone', 'department', 'status']
        
        for field in allowed_fields:
            if field in data:
                # Validate role if changing
                if field == 'role':
                    valid_roles = [r['id'] for r in AVAILABLE_ROLES]
                    if data['role'] not in valid_roles:
                        return error_response(f'Invalid role. Must be one of: {valid_roles}', 400)
                update_fields[field] = data[field]
        
        if not update_fields:
            return error_response('No fields to update', 400)
        
        update_fields['updatedAt'] = get_current_utc()
        update_fields['updatedBy'] = getattr(request, 'user_id', 'system')
        
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': update_fields}
        )
        
        updated_user = users_collection.find_one({'_id': ObjectId(user_id)})
        
        return jsonify({
            'message': 'User updated successfully',
            'user': sanitize_user(updated_user)
        }), 200
        
    except InvalidId:
        return error_response('Invalid user ID', 400)
    except Exception as e:
        print(f"Error updating user: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@users_bp.route('/<user_id>', methods=['DELETE'])
@require_company_access
@require_permission('users.delete')
def deactivate_user(user_id):
    """
    Deactivate a user (soft delete).
    
    Users are not hard deleted for audit purposes.
    """
    try:
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Verify user belongs to same company
        company_id = request.args.get('companyId')
        if str(user.get('companyId')) != company_id:
            return error_response('User not found', 404)
        
        # Don't allow deactivating yourself
        if str(user['_id']) == str(getattr(request, 'user_id', '')):
            return error_response('Cannot deactivate your own account', 400)
        
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {
                'status': 'inactive',
                'deactivatedAt': get_current_utc(),
                'deactivatedBy': getattr(request, 'user_id', 'system')
            }}
        )
        
        return jsonify({
            'message': 'User deactivated successfully'
        }), 200
        
    except InvalidId:
        return error_response('Invalid user ID', 400)
    except Exception as e:
        print(f"Error deactivating user: {e}")
        return error_response(str(e), 500)


@users_bp.route('/<user_id>/reactivate', methods=['POST'])
@require_company_access
@require_permission('users.update')
def reactivate_user(user_id):
    """Reactivate a deactivated user"""
    try:
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Verify user belongs to same company
        data = request.json or {}
        company_id = data.get('companyId') or request.args.get('companyId')
        if str(user.get('companyId')) != company_id:
            return error_response('User not found', 404)
        
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {
                'status': 'active',
                'reactivatedAt': get_current_utc(),
                'reactivatedBy': getattr(request, 'user_id', 'system')
            }}
        )
        
        return jsonify({
            'message': 'User reactivated successfully'
        }), 200
        
    except InvalidId:
        return error_response('Invalid user ID', 400)
    except Exception as e:
        print(f"Error reactivating user: {e}")
        return error_response(str(e), 500)


@users_bp.route('/<user_id>/reset-password', methods=['POST'])
@require_company_access
@require_permission('users.update')
def admin_reset_password(user_id):
    """
    Admin-initiated password reset.
    Generates a reset token for the user.
    """
    try:
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Generate reset token
        reset_token = secrets.token_urlsafe(32)
        
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {
                'resetToken': reset_token,
                'resetTokenExpiry': get_current_utc() + timedelta(hours=24)
            }}
        )
        
        return jsonify({
            'message': 'Password reset token generated',
            'resetToken': reset_token,
            'resetUrl': f"/auth/reset-password?token={reset_token}",
            'expiresIn': '24 hours'
        }), 200
        
    except InvalidId:
        return error_response('Invalid user ID', 400)
    except Exception as e:
        print(f"Error generating reset token: {e}")
        return error_response(str(e), 500)


@users_bp.route('/roles', methods=['GET'])
@require_auth
def list_roles():
    """Get available roles for user assignment"""
    return jsonify({
        'roles': get_available_roles()
    }), 200


@users_bp.route('/me', methods=['PATCH'])
@require_auth
def update_current_user():
    """
    Update current user's own profile.
    
    Request Body (all optional):
        name, phone
    
    Note: Role and status cannot be self-updated.
    """
    try:
        data = request.json or {}
        user_id = request.user_id
        
        if not user_id:
            return error_response('User not found', 404)
        
        # Only allow updating own profile fields
        update_fields = {}
        allowed_fields = ['name', 'phone']
        
        for field in allowed_fields:
            if field in data:
                update_fields[field] = data[field]
        
        if not update_fields:
            return error_response('No fields to update', 400)
        
        update_fields['updatedAt'] = get_current_utc()
        
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': update_fields}
        )
        
        updated_user = users_collection.find_one({'_id': ObjectId(user_id)})
        
        return jsonify({
            'message': 'Profile updated successfully',
            'user': sanitize_user(updated_user)
        }), 200
        
    except Exception as e:
        print(f"Error updating profile: {e}")
        return error_response(str(e), 500)


@users_bp.route('/me/change-password', methods=['POST'])
@require_auth
def change_own_password():
    """
    Change current user's password.
    
    Request Body:
        currentPassword (required): Current password
        newPassword (required): New password (min 8 chars)
    """
    try:
        data = request.json or {}
        user_id = request.user_id
        
        current_password = data.get('currentPassword')
        new_password = data.get('newPassword')
        
        if not current_password or not new_password:
            return error_response('Current password and new password are required', 400)
        
        if len(new_password) < 8:
            return error_response('New password must be at least 8 characters', 400)
        
        user = users_collection.find_one({'_id': ObjectId(user_id)})
        if not user:
            return error_response('User not found', 404)
        
        # Verify current password
        if not bcrypt.verify(current_password, user.get('password', '')):
            return error_response('Current password is incorrect', 401)
        
        # Update password
        users_collection.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {
                'password': bcrypt.hash(new_password),
                'passwordChangedAt': get_current_utc()
            }}
        )
        
        return jsonify({
            'message': 'Password changed successfully'
        }), 200
        
    except Exception as e:
        print(f"Error changing password: {e}")
        return error_response(str(e), 500)


# Import timedelta at module level
from datetime import timedelta
