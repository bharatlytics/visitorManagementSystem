"""
Access Control Integration API

Integration with physical access control systems:
- Grant/revoke temporary access
- Door event handling
- Zone access management
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta, timezone

from app.db import get_db, visit_collection, visitor_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc
from app.services.audit_logger import log_action

access_control_bp = Blueprint('access_control', __name__)


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


@access_control_bp.route('/grant', methods=['POST'])
@require_company_access
def grant_access():
    """
    Grant temporary access to a visitor.
    
    Issues a temporary access credential for the visitor.
    
    Request Body:
        visitId (required): Visit ObjectId
        zones (optional): Array of zone IDs visitor can access
        credentialType (optional): card, qr, mobile (default: qr)
        validFrom (optional): When access starts (default: now)
        validUntil (optional): When access expires (default: expected departure + 1hr)
    
    Returns:
        - accessId: Unique access credential ID
        - credentialType: Type of credential issued
        - zones: Authorized zones
        - validUntil: Expiry time
    """
    try:
        data = request.json or {}
        visit_id = data.get('visitId')
        
        if not visit_id:
            return jsonify({'error': 'Visit ID is required'}), 400
        
        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return jsonify({'error': 'Visit not found'}), 404
        
        if visit.get('status') not in ['scheduled', 'checked_in']:
            return jsonify({'error': 'Visit must be scheduled or checked-in to grant access'}), 400
        
        db = get_db()
        access_credentials = db['access_credentials']
        
        now = get_current_utc()
        
        # Get or default zones
        zones = data.get('zones') or visit.get('accessAreas') or ['main_lobby']
        
        # Calculate validity
        valid_from = now
        if data.get('validFrom'):
            valid_from = datetime.fromisoformat(data['validFrom'].replace('Z', '+00:00'))
        
        valid_until = now + timedelta(hours=8)  # Default 8 hours
        if data.get('validUntil'):
            valid_until = datetime.fromisoformat(data['validUntil'].replace('Z', '+00:00'))
        elif visit.get('expectedDeparture'):
            valid_until = visit['expectedDeparture'] + timedelta(hours=1)  # 1hr buffer
        
        credential_type = data.get('credentialType', 'qr')
        
        # Generate credential
        import secrets
        credential_code = secrets.token_hex(16)
        
        credential_doc = {
            '_id': ObjectId(),
            'visitId': ObjectId(visit_id),
            'visitorId': visit.get('visitorId'),
            'visitorName': visit.get('visitorName'),
            'companyId': visit.get('companyId'),
            'credentialType': credential_type,
            'credentialCode': credential_code,
            'zones': zones,
            'validFrom': valid_from,
            'validUntil': valid_until,
            'status': 'active',
            'createdAt': now,
            'createdBy': getattr(request, 'user_id', 'system'),
            'usageCount': 0,
            'lastUsed': None
        }
        
        access_credentials.insert_one(credential_doc)
        
        # Update visit with access info
        visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {
                '$set': {
                    'accessCredentialId': credential_doc['_id'],
                    'accessZones': zones,
                    'accessValidUntil': valid_until
                }
            }
        )
        
        # Audit log
        log_action(
            action='access.granted',
            entity_type='access_credential',
            entity_id=credential_doc['_id'],
            company_id=str(visit.get('companyId')),
            user_id=getattr(request, 'user_id', None),
            details={
                'visitId': visit_id,
                'visitorName': visit.get('visitorName'),
                'zones': zones,
                'validUntil': valid_until.isoformat()
            }
        )
        
        return jsonify({
            'message': 'Access granted',
            'accessId': str(credential_doc['_id']),
            'credentialCode': credential_code,
            'credentialType': credential_type,
            'zones': zones,
            'validFrom': valid_from.isoformat(),
            'validUntil': valid_until.isoformat()
        }), 201
        
    except Exception as e:
        print(f"Error granting access: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@access_control_bp.route('/revoke', methods=['POST'])
@require_company_access
def revoke_access():
    """
    Revoke visitor's access.
    
    Request Body:
        visitId (required): Visit ObjectId
        reason (optional): Reason for revocation
    """
    try:
        data = request.json or {}
        visit_id = data.get('visitId')
        reason = data.get('reason', 'Manual revocation')
        
        if not visit_id:
            return jsonify({'error': 'Visit ID is required'}), 400
        
        db = get_db()
        access_credentials = db['access_credentials']
        
        # Revoke all active credentials for this visit
        result = access_credentials.update_many(
            {'visitId': ObjectId(visit_id), 'status': 'active'},
            {
                '$set': {
                    'status': 'revoked',
                    'revokedAt': get_current_utc(),
                    'revokedBy': getattr(request, 'user_id', 'system'),
                    'revocationReason': reason
                }
            }
        )
        
        # Update visit
        visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {'$set': {'accessRevoked': True, 'accessRevokedAt': get_current_utc()}}
        )
        
        return jsonify({
            'message': 'Access revoked',
            'visitId': visit_id,
            'credentialsRevoked': result.modified_count
        }), 200
        
    except Exception as e:
        print(f"Error revoking access: {e}")
        return jsonify({'error': str(e)}), 500


@access_control_bp.route('/verify', methods=['POST'])
@require_company_access
def verify_access():
    """
    Verify if visitor has access to a zone.
    
    Called by access control hardware when visitor scans credential.
    
    Request Body:
        credentialCode (required): The credential code
        zoneId (required): Zone being accessed
        doorId (optional): Specific door ID
    
    Returns:
        - authorized: Boolean
        - visitorName: If authorized
        - reason: If not authorized
    """
    try:
        data = request.json or {}
        credential_code = data.get('credentialCode')
        zone_id = data.get('zoneId')
        door_id = data.get('doorId')
        
        if not credential_code:
            return jsonify({'error': 'Credential code is required'}), 400
        
        if not zone_id:
            return jsonify({'error': 'Zone ID is required'}), 400
        
        db = get_db()
        access_credentials = db['access_credentials']
        
        # Find credential
        credential = access_credentials.find_one({'credentialCode': credential_code})
        
        if not credential:
            return jsonify({
                'authorized': False,
                'reason': 'Invalid credential'
            }), 200
        
        if credential['status'] != 'active':
            return jsonify({
                'authorized': False,
                'reason': f'Credential is {credential["status"]}'
            }), 200
        
        now = get_current_utc()
        
        # Check validity period
        if now < credential['validFrom']:
            return jsonify({
                'authorized': False,
                'reason': 'Credential not yet valid'
            }), 200
        
        if now > credential['validUntil']:
            return jsonify({
                'authorized': False,
                'reason': 'Credential expired'
            }), 200
        
        # Check zone authorization
        if zone_id not in credential['zones'] and 'all' not in credential['zones']:
            return jsonify({
                'authorized': False,
                'reason': 'Not authorized for this zone'
            }), 200
        
        # Update usage
        access_credentials.update_one(
            {'_id': credential['_id']},
            {
                '$inc': {'usageCount': 1},
                '$set': {'lastUsed': now, 'lastUsedZone': zone_id, 'lastUsedDoor': door_id}
            }
        )
        
        # Log access event
        access_events = db['access_events']
        access_events.insert_one({
            '_id': ObjectId(),
            'credentialId': credential['_id'],
            'visitId': credential['visitId'],
            'visitorId': credential['visitorId'],
            'visitorName': credential['visitorName'],
            'zoneId': zone_id,
            'doorId': door_id,
            'eventType': 'access_granted',
            'timestamp': now
        })
        
        return jsonify({
            'authorized': True,
            'visitorId': str(credential['visitorId']),
            'visitorName': credential['visitorName'],
            'zones': credential['zones'],
            'validUntil': credential['validUntil'].isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error verifying access: {e}")
        return jsonify({'error': str(e)}), 500


@access_control_bp.route('/zones', methods=['GET'])
@require_company_access
def get_access_zones():
    """Get available access zones for a company"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        zones_collection = db['access_zones']
        
        zones = list(zones_collection.find({'companyId': company_id, 'active': True}))
        
        if not zones:
            # Return default zones
            zones = [
                {'id': 'main_lobby', 'name': 'Main Lobby', 'level': 'unrestricted'},
                {'id': 'meeting_rooms', 'name': 'Meeting Rooms', 'level': 'visitor'},
                {'id': 'cafeteria', 'name': 'Cafeteria', 'level': 'unrestricted'},
                {'id': 'office_floor', 'name': 'Office Floor', 'level': 'escorted'}
            ]
        
        return jsonify({
            'zones': convert_objectids(zones),
            'count': len(zones)
        }), 200
        
    except Exception as e:
        print(f"Error getting zones: {e}")
        return jsonify({'error': str(e)}), 500


@access_control_bp.route('/door-event', methods=['POST'])
@require_company_access
def receive_door_event():
    """
    Receive door open/close events from access control hardware.
    
    Request Body:
        doorId (required): Door identifier
        eventType (required): door_opened, door_closed, door_forced, door_held
        credentialCode (optional): If triggered by credential
        timestamp (optional): Event timestamp
    """
    try:
        data = request.json or {}
        door_id = data.get('doorId')
        event_type = data.get('eventType')
        
        if not door_id or not event_type:
            return jsonify({'error': 'doorId and eventType are required'}), 400
        
        db = get_db()
        door_events = db['door_events']
        
        event_doc = {
            '_id': ObjectId(),
            'doorId': door_id,
            'eventType': event_type,
            'credentialCode': data.get('credentialCode'),
            'timestamp': datetime.fromisoformat(data['timestamp'].replace('Z', '+00:00')) if data.get('timestamp') else get_current_utc(),
            'receivedAt': get_current_utc()
        }
        
        door_events.insert_one(event_doc)
        
        # Alert on security events
        if event_type in ['door_forced', 'door_held']:
            log_action(
                action=f'security.{event_type}',
                entity_type='door',
                entity_id=door_id,
                company_id=request.args.get('companyId') or getattr(request, 'company_id', ''),
                details={'doorId': door_id, 'eventType': event_type},
                severity='warning'
            )
        
        return jsonify({
            'message': 'Event recorded',
            'eventId': str(event_doc['_id'])
        }), 200
        
    except Exception as e:
        print(f"Error recording door event: {e}")
        return jsonify({'error': str(e)}), 500


@access_control_bp.route('/active-credentials', methods=['GET'])
@require_company_access
def get_active_credentials():
    """Get all currently active access credentials"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        access_credentials = db['access_credentials']
        
        now = get_current_utc()
        
        credentials = list(access_credentials.find({
            'companyId': company_id,
            'status': 'active',
            'validFrom': {'$lte': now},
            'validUntil': {'$gt': now}
        }))
        
        return jsonify({
            'credentials': convert_objectids(credentials),
            'count': len(credentials)
        }), 200
        
    except Exception as e:
        print(f"Error getting active credentials: {e}")
        return jsonify({'error': str(e)}), 500
