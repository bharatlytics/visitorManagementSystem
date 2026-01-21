"""
VMS Company Management API

Complete company management for standalone VMS operation:
- Get company details
- Create new company (super_admin only in multi-tenant mode)
- Update company settings
- Delete/deactivate company
- Manage company settings and branding
"""
from flask import Blueprint, jsonify, request, session
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime

from app.db import companies_collection, users_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc, validate_required_fields, error_response

company_bp = Blueprint('company', __name__)


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


@company_bp.route('', methods=['GET'])
@company_bp.route('/', methods=['GET'])
@require_auth
def get_company():
    """Get current company details"""
    company_id = request.company_id
    
    if not company_id:
        return jsonify({'error': 'No company context'}), 400
    
    return _get_company_details(company_id)


@company_bp.route('/<company_id>', methods=['GET'])
def get_company_by_id(company_id):
    """Get company details by ID (for connected mode)"""
    # Try to authenticate but don't require it
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        from app.auth import decode_token
        token = auth_header[7:]
        payload = decode_token(token)
        if payload:
            request.user_id = payload.get('user_id')
            request.company_id = payload.get('company_id')
    
    # Check session
    if session.get('user_id'):
        request.user_id = session.get('user_id')
        request.company_id = session.get('company_id')
    
    return _get_company_details(company_id)


def _get_company_details(company_id):
    """Helper to get company details"""
    if not company_id or company_id == 'null' or company_id == 'undefined':
        return jsonify({'error': 'Invalid company ID'}), 400
    
    # Try local database with multiple strategies
    company = None
    try:
        # Strategy 1: Match by _id (standard)
        if ObjectId.is_valid(company_id):
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        
        # Strategy 2: Match by companyId (if not found by _id)
        if not company:
            # Try matching companyId as ObjectId
            if ObjectId.is_valid(company_id):
                company = companies_collection.find_one({'companyId': ObjectId(company_id)})
            
            # Strategy 3: Match by companyId as string
            if not company:
                company = companies_collection.find_one({'companyId': company_id})
                
    except Exception as e:
        print(f"[Company] Lookup error: {e}")
        # Fallback to simple string match
        company = companies_collection.find_one({'companyId': company_id})
    
    if company:
        return jsonify({
            'company': convert_objectids({
                '_id': company.get('_id'),
                'name': company.get('companyName') or company.get('name'),
                'logo': company.get('logo'),
                'email': company.get('email'),
                'phone': company.get('phone'),
                'address': company.get('address'),
                'website': company.get('website'),
                'industry': company.get('industry'),
                'timezone': company.get('timezone', 'Asia/Kolkata'),
                'settings': company.get('settings', {}),
                'connected': bool(session.get('platform_token')),
                'createdAt': company.get('createdAt'),
                'status': company.get('status', 'active')
            })
        })
    
    # For connected mode, return placeholder if company not in local DB
    if session.get('platform_token'):
        return jsonify({
            'company': {
                '_id': company_id,
                'name': session.get('company_name', 'Connected Company'),
                'logo': session.get('company_logo'),
                'connected': True
            }
        })
    
    # Try to fetch from platform if client is available
    try:
        from app.services.platform_client import platform_client
        if platform_client:
            company_data = platform_client.make_request(f'/companies/{company_id}')
            if company_data:
                return jsonify({
                    'company': {
                        '_id': company_id,
                        'name': company_data.get('name') or company_data.get('companyName'),
                        'logo': company_data.get('logo'),
                        'connected': True
                    }
                })
    except Exception as e:
        print(f"[Company] Platform fetch failed: {e}")
    
    return jsonify({'error': 'Company not found'}), 404


@company_bp.route('/', methods=['POST'])
@company_bp.route('', methods=['POST'])
def create_company():
    """
    Create a new company.
    
    For standalone VMS, this creates a company in the local database.
    Requires adminSecret for security.
    
    Request Body:
        companyName (required): Company name
        adminSecret (required): Admin secret key
        email (optional): Company contact email
        phone (optional): Company phone
        address (optional): Company address
        website (optional): Company website
        industry (optional): Industry category
        timezone (optional): Company timezone (default: Asia/Kolkata)
        logo (optional): Company logo URL
    """
    try:
        data = request.json or {}
        
        # Validate required fields
        if not data.get('companyName'):
            return error_response('Company name is required', 400)
        
        # Verify admin secret
        admin_secret = data.get('adminSecret')
        if admin_secret != '112233445566778899':
            return error_response('Invalid admin secret', 403)
        
        # Check if company name already exists
        existing = companies_collection.find_one({
            '$or': [
                {'companyName': data['companyName']},
                {'name': data['companyName']}
            ]
        })
        if existing:
            return error_response('Company with this name already exists', 409)
        
        # Create company document
        company_doc = {
            '_id': ObjectId(),
            'companyName': data['companyName'],
            'name': data['companyName'],  # Alias for compatibility
            'email': data.get('email'),
            'phone': data.get('phone'),
            'address': data.get('address'),
            'website': data.get('website'),
            'industry': data.get('industry'),
            'timezone': data.get('timezone', 'Asia/Kolkata'),
            'logo': data.get('logo'),
            'status': 'active',
            'settings': {
                'requireApproval': False,
                'autoCheckoutHours': 8,
                'badgeTemplate': 'default',
                'notifications': {
                    'email': True,
                    'sms': False,
                    'whatsapp': False
                },
                'visitorTypes': ['guest', 'vendor', 'contractor', 'interview', 'vip']
            },
            'createdAt': get_current_utc(),
            'updatedAt': get_current_utc()
        }
        
        companies_collection.insert_one(company_doc)
        
        return jsonify({
            'message': 'Company created successfully',
            'company': convert_objectids(company_doc)
        }), 201
        
    except Exception as e:
        print(f"Error creating company: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@company_bp.route('/', methods=['PATCH'])
@company_bp.route('', methods=['PATCH'])
@require_company_access
def update_company():
    """
    Update company details.
    
    Request Body (all optional):
        companyName, email, phone, address, website, industry, timezone, logo, settings
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or request.company_id
        
        if not company_id:
            return error_response('Company ID is required', 400)
        
        # Find company
        try:
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        except:
            company = companies_collection.find_one({'companyId': company_id})
        
        if not company:
            return error_response('Company not found', 404)
        
        # Build update fields
        update_fields = {}
        allowed_fields = ['companyName', 'name', 'email', 'phone', 'address', 
                          'website', 'industry', 'timezone', 'logo']
        
        for field in allowed_fields:
            if field in data:
                update_fields[field] = data[field]
                # Keep both name and companyName in sync
                if field == 'companyName':
                    update_fields['name'] = data[field]
                elif field == 'name':
                    update_fields['companyName'] = data[field]
        
        # Handle settings update (merge, don't replace)
        if 'settings' in data and isinstance(data['settings'], dict):
            current_settings = company.get('settings', {})
            # Deep merge settings
            for key, value in data['settings'].items():
                if isinstance(value, dict) and isinstance(current_settings.get(key), dict):
                    current_settings[key].update(value)
                else:
                    current_settings[key] = value
            update_fields['settings'] = current_settings
        
        if not update_fields:
            return error_response('No fields to update', 400)
        
        update_fields['updatedAt'] = get_current_utc()
        
        companies_collection.update_one(
            {'_id': company['_id']},
            {'$set': update_fields}
        )
        
        updated_company = companies_collection.find_one({'_id': company['_id']})
        
        return jsonify({
            'message': 'Company updated successfully',
            'company': convert_objectids(updated_company)
        }), 200
        
    except Exception as e:
        print(f"Error updating company: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@company_bp.route('/<company_id>', methods=['DELETE'])
@require_auth
def delete_company(company_id):
    """
    Deactivate a company (soft delete).
    
    Companies are not hard deleted for audit purposes.
    Requires super admin or company admin with admin secret.
    """
    try:
        data = request.json or {}
        admin_secret = data.get('adminSecret')
        
        # Verify admin secret for delete operations
        if admin_secret != '112233445566778899':
            return error_response('Admin secret required for deletion', 403)
        
        # Find company
        try:
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        except:
            return error_response('Invalid company ID', 400)
        
        if not company:
            return error_response('Company not found', 404)
        
        # Soft delete - set status to inactive
        companies_collection.update_one(
            {'_id': ObjectId(company_id)},
            {'$set': {
                'status': 'inactive',
                'deactivatedAt': get_current_utc(),
                'deactivatedBy': getattr(request, 'user_id', 'admin')
            }}
        )
        
        return jsonify({
            'message': 'Company deactivated successfully'
        }), 200
        
    except Exception as e:
        print(f"Error deleting company: {e}")
        return error_response(str(e), 500)


@company_bp.route('/settings', methods=['GET'])
@require_company_access
def get_company_settings():
    """Get company VMS settings"""
    try:
        company_id = request.args.get('companyId')
        
        # Find company
        try:
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        except:
            company = companies_collection.find_one({'companyId': company_id})
        
        if not company:
            # Return defaults if company not found
            return jsonify({
                'settings': {
                    'requireApproval': False,
                    'autoCheckoutHours': 8,
                    'badgeTemplate': 'default',
                    'notifications': {
                        'email': True,
                        'sms': False,
                        'whatsapp': False
                    },
                    'visitorTypes': ['guest', 'vendor', 'contractor', 'interview', 'vip']
                }
            }), 200
        
        return jsonify({
            'settings': company.get('settings', {})
        }), 200
        
    except Exception as e:
        print(f"Error getting settings: {e}")
        return error_response(str(e), 500)


@company_bp.route('/settings', methods=['PATCH'])
@require_company_access
def update_company_settings():
    """Update company VMS settings"""
    try:
        data = request.json or {}
        company_id = data.get('companyId')
        
        if not company_id:
            return error_response('Company ID is required', 400)
        
        settings = data.get('settings', {})
        if not settings:
            return error_response('Settings object is required', 400)
        
        # Find company
        try:
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        except:
            company = companies_collection.find_one({'companyId': company_id})
        
        if not company:
            return error_response('Company not found', 404)
        
        # Merge settings
        current_settings = company.get('settings', {})
        for key, value in settings.items():
            if isinstance(value, dict) and isinstance(current_settings.get(key), dict):
                current_settings[key].update(value)
            else:
                current_settings[key] = value
        
        companies_collection.update_one(
            {'_id': company['_id']},
            {'$set': {
                'settings': current_settings,
                'updatedAt': get_current_utc()
            }}
        )
        
        return jsonify({
            'message': 'Settings updated successfully',
            'settings': current_settings
        }), 200
        
    except Exception as e:
        print(f"Error updating settings: {e}")
        return error_response(str(e), 500)


@company_bp.route('/stats', methods=['GET'])
@require_company_access  
def get_company_stats():
    """Get company statistics for dashboard"""
    try:
        company_id = request.args.get('companyId')
        
        from app.db import visitor_collection, employees_collection, visit_collection, devices_collection
        
        # Build query with both ObjectId and string formats
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        # Count various entities
        visitor_count = visitor_collection.count_documents(query)
        employee_count = employees_collection.count_documents(query)
        
        # Active visits today
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        visits_today = visit_collection.count_documents({
            **query,
            'expectedArrival': {'$gte': today_start}
        })
        
        # Checked in visitors
        checked_in = visit_collection.count_documents({
            **query,
            'status': 'checked_in'
        })
        
        # Device count
        device_count = devices_collection.count_documents(query)
        
        # User count
        user_count = users_collection.count_documents(query)
        
        return jsonify({
            'stats': {
                'visitors': visitor_count,
                'employees': employee_count,
                'visitsToday': visits_today,
                'checkedIn': checked_in,
                'devices': device_count,
                'users': user_count
            }
        }), 200
        
    except Exception as e:
        print(f"Error getting stats: {e}")
        return error_response(str(e), 500)
