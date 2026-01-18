"""
Pre-Registration Portal API

Allows hosts to invite visitors ahead of time with self-service registration.
Features:
- Host sends invite with unique token
- Visitor receives email with QR code
- Visitor completes their own details before arrival
- Automatic visit scheduling on completion
"""
from flask import Blueprint, request, jsonify, url_for
from bson import ObjectId
from datetime import datetime, timedelta, timezone
import secrets
import hashlib

from app.db import visit_collection, visitor_collection, employee_collection, get_db
from app.auth import require_auth, require_company_access
from app.utils import (
    validate_required_fields, error_response, validate_email_format,
    validate_phone_format, get_current_utc, parse_datetime
)

preregistration_bp = Blueprint('preregistration', __name__)


def generate_invite_token():
    """Generate a secure unique invitation token"""
    return secrets.token_urlsafe(32)


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


@preregistration_bp.route('/invite', methods=['POST'])
@require_company_access
def create_invite():
    """
    Create a pre-registration invite for a visitor.
    
    Host creates an invite with expected visit details.
    Visitor receives email/SMS with a link to complete registration.
    
    Request Body:
        companyId (required): Company ObjectId
        hostEmployeeId (required): Host employee ID
        visitorEmail (optional): Visitor's email for invite
        visitorPhone (optional): Visitor's phone for SMS invite
        visitorName (optional): Pre-fill visitor name if known
        expectedArrival (required): ISO datetime
        expectedDeparture (optional): ISO datetime
        purpose (optional): Visit purpose
        locationId (optional): Location/zone
        requiresApproval (optional): If visit needs approval chain
        visitType (optional): guest, vendor, contractor, etc.
        notes (optional): Notes for visitor
        expiresIn (optional): Hours until invite expires (default: 72)
    
    Returns:
        - inviteToken: Unique token for visitor
        - inviteUrl: Full URL for visitor to complete registration
        - qrCodeUrl: URL to QR code image
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        host_employee_id = data.get('hostEmployeeId')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        if not host_employee_id:
            return jsonify({'error': 'Host employee ID is required'}), 400
        if not data.get('expectedArrival'):
            return jsonify({'error': 'Expected arrival date is required'}), 400
        
        # Get host employee details
        host = None
        try:
            host = employee_collection.find_one({'_id': ObjectId(host_employee_id)})
        except:
            host = employee_collection.find_one({'employeeId': host_employee_id})
        
        if not host:
            return jsonify({'error': 'Host employee not found'}), 404
        
        # Generate invite token
        invite_token = generate_invite_token()
        expires_in_hours = data.get('expiresIn', 72)
        
        # Parse dates
        expected_arrival = parse_datetime(data['expectedArrival'])
        expected_departure = None
        if data.get('expectedDeparture'):
            expected_departure = parse_datetime(data['expectedDeparture'])
        
        # Create invite document
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        invite_doc = {
            '_id': ObjectId(),
            'token': invite_token,
            'tokenHash': hashlib.sha256(invite_token.encode()).hexdigest(),
            'companyId': company_id,
            'hostEmployeeId': host_employee_id,
            'hostEmployeeName': host.get('employeeName'),
            'hostEmployeeEmail': host.get('email'),
            'visitorEmail': data.get('visitorEmail'),
            'visitorPhone': data.get('visitorPhone'),
            'visitorName': data.get('visitorName', ''),
            'expectedArrival': expected_arrival,
            'expectedDeparture': expected_departure,
            'purpose': data.get('purpose', ''),
            'visitType': data.get('visitType', 'guest'),
            'locationId': data.get('locationId'),
            'locationName': data.get('locationName'),
            'requiresApproval': data.get('requiresApproval', False),
            'notes': data.get('notes', ''),
            'status': 'pending',  # pending, completed, expired, cancelled
            'createdAt': get_current_utc(),
            'expiresAt': get_current_utc() + timedelta(hours=expires_in_hours),
            'createdBy': getattr(request, 'user_id', host_employee_id),
            'completedAt': None,
            'visitorId': None,
            'visitId': None
        }
        
        invites_collection.insert_one(invite_doc)
        
        # Build invite URL (frontend should handle this route)
        base_url = request.url_root.rstrip('/')
        invite_url = f"{base_url}/visitor-registration/{invite_token}"
        qr_code_url = f"{base_url}/api/preregistration/{invite_token}/qr"
        
        # TODO: Send email/SMS to visitor
        # For now, just return the invite details
        
        return jsonify({
            'message': 'Invite created successfully',
            'inviteId': str(invite_doc['_id']),
            'inviteToken': invite_token,
            'inviteUrl': invite_url,
            'qrCodeUrl': qr_code_url,
            'expiresAt': invite_doc['expiresAt'].isoformat(),
            'hostName': host.get('employeeName'),
            'expectedArrival': expected_arrival.isoformat()
        }), 201
        
    except Exception as e:
        print(f"Error creating invite: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@preregistration_bp.route('/<token>', methods=['GET'])
def get_invite_details(token):
    """
    Get pre-registration invite details.
    
    This is a PUBLIC endpoint - no auth required.
    Visitors use this to see invite details before completing registration.
    
    Returns:
        - hostName, hostEmail
        - expectedArrival, expectedDeparture
        - purpose, locationName
        - visitorName (if pre-filled)
        - status (pending, completed, expired)
    """
    try:
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        # Find by token (not hash - public access)
        invite = invites_collection.find_one({'token': token})
        
        if not invite:
            return jsonify({'error': 'Invite not found'}), 404
        
        # Check if expired
        if invite['expiresAt'] < get_current_utc():
            invites_collection.update_one(
                {'_id': invite['_id']},
                {'$set': {'status': 'expired'}}
            )
            return jsonify({'error': 'This invite has expired'}), 410
        
        if invite['status'] == 'completed':
            return jsonify({
                'error': 'This invite has already been used',
                'visitId': str(invite.get('visitId'))
            }), 400
        
        if invite['status'] == 'cancelled':
            return jsonify({'error': 'This invite has been cancelled'}), 400
        
        # Return invite details (exclude sensitive data)
        return jsonify({
            'valid': True,
            'hostName': invite.get('hostEmployeeName'),
            'hostEmail': invite.get('hostEmployeeEmail'),
            'expectedArrival': invite.get('expectedArrival'),
            'expectedDeparture': invite.get('expectedDeparture'),
            'purpose': invite.get('purpose'),
            'visitType': invite.get('visitType'),
            'locationName': invite.get('locationName'),
            'visitorName': invite.get('visitorName'),
            'visitorEmail': invite.get('visitorEmail'),
            'visitorPhone': invite.get('visitorPhone'),
            'notes': invite.get('notes'),
            'expiresAt': invite.get('expiresAt')
        }), 200
        
    except Exception as e:
        print(f"Error getting invite: {e}")
        return jsonify({'error': str(e)}), 500


@preregistration_bp.route('/<token>/submit', methods=['POST'])
def submit_registration(token):
    """
    Complete pre-registration by visitor.
    
    This is a PUBLIC endpoint - no auth required.
    Visitor fills in their details and submits.
    Creates visitor record and schedules visit automatically.
    
    Request Body:
        visitorName (required): Full name
        phone (required): Phone number
        email (optional): Email address
        organization (optional): Company/organization name
        idType (optional): ID document type
        idNumber (optional): ID document number
    
    Returns:
        - visitorId: Created visitor ID
        - visitId: Scheduled visit ID
        - qrCode: QR code for check-in
    """
    try:
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        invite = invites_collection.find_one({'token': token})
        
        if not invite:
            return jsonify({'error': 'Invite not found'}), 404
        
        if invite['expiresAt'] < get_current_utc():
            return jsonify({'error': 'This invite has expired'}), 410
        
        if invite['status'] != 'pending':
            return jsonify({'error': f'This invite is {invite["status"]}'}), 400
        
        data = request.json or {}
        
        # Validate required fields
        if not data.get('visitorName'):
            return jsonify({'error': 'Visitor name is required'}), 400
        if not data.get('phone'):
            return jsonify({'error': 'Phone number is required'}), 400
        
        # Validate phone format
        if not validate_phone_format(data['phone']):
            return jsonify({'error': 'Invalid phone number format'}), 400
        
        # Validate email if provided
        if data.get('email') and not validate_email_format(data['email']):
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Check for existing visitor with same phone
        company_id = invite['companyId']
        existing_visitor = visitor_collection.find_one({
            'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
            'phone': data['phone']
        })
        
        if existing_visitor:
            visitor_id = existing_visitor['_id']
            # Update visitor details if changed
            update_fields = {}
            if data.get('visitorName') and data['visitorName'] != existing_visitor.get('visitorName'):
                update_fields['visitorName'] = data['visitorName']
            if data.get('email') and data['email'] != existing_visitor.get('email'):
                update_fields['email'] = data['email']
            if data.get('organization'):
                update_fields['organization'] = data['organization']
            
            if update_fields:
                update_fields['lastUpdated'] = get_current_utc()
                visitor_collection.update_one(
                    {'_id': visitor_id},
                    {'$set': update_fields}
                )
        else:
            # Create new visitor
            visitor_doc = {
                '_id': ObjectId(),
                'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
                'visitorName': data['visitorName'],
                'phone': data['phone'],
                'email': data.get('email', ''),
                'organization': data.get('organization', ''),
                'visitorType': invite.get('visitType', 'guest'),
                'idType': data.get('idType', ''),
                'idNumber': data.get('idNumber', ''),
                'status': 'active',
                'blacklisted': False,
                'createdAt': get_current_utc(),
                'lastUpdated': get_current_utc(),
                'registrationMethod': 'preregistration',
                'visitorImages': {},
                'visitorEmbeddings': {}
            }
            
            visitor_collection.insert_one(visitor_doc)
            visitor_id = visitor_doc['_id']
        
        # Create visit
        visit_doc = {
            '_id': ObjectId(),
            'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
            'visitorId': visitor_id,
            'visitorName': data['visitorName'],
            'hostEmployeeId': invite['hostEmployeeId'],
            'hostEmployeeName': invite.get('hostEmployeeName'),
            'purpose': invite.get('purpose', ''),
            'visitType': invite.get('visitType', 'guest'),
            'expectedArrival': invite['expectedArrival'],
            'expectedDeparture': invite.get('expectedDeparture'),
            'locationId': invite.get('locationId'),
            'locationName': invite.get('locationName'),
            'preregistrationId': invite['_id'],
            'status': 'scheduled',
            'approvalStatus': 'pending' if invite.get('requiresApproval') else 'approved',
            'createdAt': get_current_utc(),
            'lastUpdated': get_current_utc(),
            'registrationMethod': 'preregistration'
        }
        
        visit_collection.insert_one(visit_doc)
        
        # Update invite status
        invites_collection.update_one(
            {'_id': invite['_id']},
            {
                '$set': {
                    'status': 'completed',
                    'completedAt': get_current_utc(),
                    'visitorId': visitor_id,
                    'visitId': visit_doc['_id']
                }
            }
        )
        
        # Update visitor's visits array
        visitor_collection.update_one(
            {'_id': visitor_id},
            {'$push': {'visits': str(visit_doc['_id'])}}
        )
        
        # TODO: Send confirmation email to visitor
        # TODO: Notify host that visitor has registered
        
        return jsonify({
            'message': 'Registration completed successfully',
            'visitorId': str(visitor_id),
            'visitId': str(visit_doc['_id']),
            'qrCode': str(visit_doc['_id']),
            'hostName': invite.get('hostEmployeeName'),
            'expectedArrival': invite['expectedArrival'].isoformat() if invite.get('expectedArrival') else None,
            'status': 'scheduled'
        }), 201
        
    except Exception as e:
        print(f"Error submitting registration: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@preregistration_bp.route('/<token>/qr', methods=['GET'])
def get_invite_qr(token):
    """Generate QR code for invite URL"""
    try:
        import qrcode
        import io
        from flask import Response
        
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        invite = invites_collection.find_one({'token': token})
        if not invite:
            return jsonify({'error': 'Invite not found'}), 404
        
        # Generate QR code with invite URL
        base_url = request.url_root.rstrip('/')
        invite_url = f"{base_url}/visitor-registration/{token}"
        
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(invite_url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        
        return Response(
            buffer.getvalue(),
            mimetype='image/png',
            headers={'Content-Disposition': f'inline; filename=invite_{token[:8]}.png'}
        )
        
    except Exception as e:
        print(f"Error generating QR: {e}")
        return jsonify({'error': str(e)}), 500


@preregistration_bp.route('/list', methods=['GET'])
@require_company_access
def list_invites():
    """
    List pre-registration invites for a company.
    
    Query Parameters:
        companyId (required): Company ObjectId
        status (optional): Filter by status (pending, completed, expired)
        hostEmployeeId (optional): Filter by host
        limit (optional): Number of records (default: 50)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        status = request.args.get('status')
        host_id = request.args.get('hostEmployeeId')
        limit = int(request.args.get('limit', 50))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        query = {'companyId': company_id}
        if status:
            query['status'] = status
        if host_id:
            query['hostEmployeeId'] = host_id
        
        invites = list(invites_collection.find(query).sort('createdAt', -1).limit(limit))
        
        # Remove token from response (security)
        for invite in invites:
            invite.pop('token', None)
            invite.pop('tokenHash', None)
        
        return jsonify({
            'invites': convert_objectids(invites),
            'count': len(invites)
        }), 200
        
    except Exception as e:
        print(f"Error listing invites: {e}")
        return jsonify({'error': str(e)}), 500


@preregistration_bp.route('/<invite_id>/cancel', methods=['POST'])
@require_company_access
def cancel_invite(invite_id):
    """Cancel a pending invite"""
    try:
        db = get_db()
        invites_collection = db['preregistration_invites']
        
        result = invites_collection.update_one(
            {
                '_id': ObjectId(invite_id),
                'status': 'pending'
            },
            {
                '$set': {
                    'status': 'cancelled',
                    'cancelledAt': get_current_utc()
                }
            }
        )
        
        if result.matched_count == 0:
            return jsonify({'error': 'Invite not found or already processed'}), 404
        
        return jsonify({'message': 'Invite cancelled successfully'}), 200
        
    except Exception as e:
        print(f"Error cancelling invite: {e}")
        return jsonify({'error': str(e)}), 500
