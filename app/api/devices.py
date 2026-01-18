"""
Device Management API

Enterprise-grade device management for VMS:
- Register and track check-in devices (kiosks, tablets, desktops)
- Link devices to locations/zones
- Monitor device health via heartbeat
- Track online/offline status
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timedelta

from app.db import get_db
from app.auth import require_company_access
from app.utils import get_current_utc, validate_required_fields, error_response

devices_bp = Blueprint('devices', __name__)


def get_devices_collection():
    """Get the devices collection"""
    return get_db()['devices']


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


@devices_bp.route('/', methods=['GET'])
@require_company_access
def list_devices():
    """
    List all devices for a company.
    
    Query Parameters:
        companyId (required): Company ObjectId
        locationId (optional): Filter by location
        status (optional): Filter by status (active, inactive, maintenance)
        deviceType (optional): Filter by type (kiosk, tablet, desktop, mobile)
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        devices_collection = get_devices_collection()
        
        # Build query
        query = {'companyId': company_id}
        
        location_id = request.args.get('locationId')
        if location_id:
            query['locationId'] = location_id
        
        status = request.args.get('status')
        if status:
            query['status'] = status
        
        device_type = request.args.get('deviceType')
        if device_type:
            query['deviceType'] = device_type
        
        devices = list(devices_collection.find(query).sort('registeredAt', -1))
        
        # Check online status based on last heartbeat
        now = get_current_utc()
        offline_threshold = timedelta(minutes=5)  # Offline if no heartbeat in 5 min
        
        for device in devices:
            last_seen = device.get('lastSeen')
            if last_seen:
                if isinstance(last_seen, str):
                    last_seen = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
                device['isOnline'] = (now - last_seen) < offline_threshold
            else:
                device['isOnline'] = False
        
        return jsonify({
            'devices': convert_objectids(devices),
            'count': len(devices)
        }), 200
        
    except Exception as e:
        print(f"Error listing devices: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@devices_bp.route('/register', methods=['POST'])
@require_company_access
def register_device():
    """
    Register a new device.
    
    Request Body:
        companyId (required): Company ObjectId
        deviceName (required): Human-readable device name
        deviceType (required): kiosk, tablet, desktop, mobile
        locationId (optional): Location/zone this device is at
        locationName (optional): Location name for display
        features (optional): { faceRecognition, badgePrinting, qrScanning }
    """
    try:
        data = request.json or {}
        
        required_fields = ['companyId', 'deviceName', 'deviceType']
        valid, msg = validate_required_fields(data, required_fields)
        if not valid:
            return error_response(msg, 400)
        
        devices_collection = get_devices_collection()
        
        # Generate unique device ID
        import uuid
        device_id = str(uuid.uuid4())[:8].upper()
        
        # Check for duplicate device name
        existing = devices_collection.find_one({
            'companyId': data['companyId'],
            'deviceName': data['deviceName']
        })
        if existing:
            return error_response('Device with this name already exists', 409)
        
        device_doc = {
            '_id': ObjectId(),
            'companyId': data['companyId'],
            'deviceId': f"VMS-{device_id}",
            'deviceName': data['deviceName'],
            'deviceType': data['deviceType'],
            'locationId': data.get('locationId'),
            'locationName': data.get('locationName'),
            'status': 'active',
            'lastSeen': None,
            'ipAddress': request.remote_addr,
            'userAgent': request.headers.get('User-Agent', ''),
            'osVersion': data.get('osVersion'),
            'appVersion': data.get('appVersion', '1.0.0'),
            'features': {
                'faceRecognition': data.get('features', {}).get('faceRecognition', False),
                'badgePrinting': data.get('features', {}).get('badgePrinting', False),
                'qrScanning': data.get('features', {}).get('qrScanning', True)
            },
            'settings': data.get('settings', {}),
            'registeredAt': get_current_utc(),
            'registeredBy': getattr(request, 'user_id', 'system'),
            'updatedAt': get_current_utc()
        }
        
        devices_collection.insert_one(device_doc)
        
        return jsonify({
            'message': 'Device registered successfully',
            'device': convert_objectids(device_doc)
        }), 201
        
    except Exception as e:
        print(f"Error registering device: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@devices_bp.route('/<device_id>', methods=['GET'])
@require_company_access
def get_device(device_id):
    """Get a single device by ID"""
    try:
        devices_collection = get_devices_collection()
        
        device = devices_collection.find_one({'_id': ObjectId(device_id)})
        if not device:
            return error_response('Device not found', 404)
        
        # Check online status
        now = get_current_utc()
        last_seen = device.get('lastSeen')
        if last_seen:
            if isinstance(last_seen, str):
                last_seen = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
            device['isOnline'] = (now - last_seen) < timedelta(minutes=5)
        else:
            device['isOnline'] = False
        
        return jsonify({
            'device': convert_objectids(device)
        }), 200
        
    except InvalidId:
        return error_response('Invalid device ID', 400)
    except Exception as e:
        print(f"Error getting device: {e}")
        return error_response(str(e), 500)


@devices_bp.route('/<device_id>', methods=['PATCH'])
@require_company_access
def update_device(device_id):
    """
    Update device details.
    
    Request Body (all optional):
        deviceName, deviceType, locationId, locationName, status, features, settings
    """
    try:
        data = request.json or {}
        devices_collection = get_devices_collection()
        
        device = devices_collection.find_one({'_id': ObjectId(device_id)})
        if not device:
            return error_response('Device not found', 404)
        
        # Build update
        update_fields = {}
        allowed_fields = ['deviceName', 'deviceType', 'locationId', 'locationName', 
                          'status', 'features', 'settings', 'osVersion', 'appVersion']
        
        for field in allowed_fields:
            if field in data:
                update_fields[field] = data[field]
        
        update_fields['updatedAt'] = get_current_utc()
        
        devices_collection.update_one(
            {'_id': ObjectId(device_id)},
            {'$set': update_fields}
        )
        
        updated_device = devices_collection.find_one({'_id': ObjectId(device_id)})
        
        return jsonify({
            'message': 'Device updated successfully',
            'device': convert_objectids(updated_device)
        }), 200
        
    except InvalidId:
        return error_response('Invalid device ID', 400)
    except Exception as e:
        print(f"Error updating device: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@devices_bp.route('/<device_id>', methods=['DELETE'])
@require_company_access
def delete_device(device_id):
    """Delete a device"""
    try:
        devices_collection = get_devices_collection()
        
        result = devices_collection.delete_one({'_id': ObjectId(device_id)})
        
        if result.deleted_count == 0:
            return error_response('Device not found', 404)
        
        return jsonify({
            'message': 'Device deleted successfully'
        }), 200
        
    except InvalidId:
        return error_response('Invalid device ID', 400)
    except Exception as e:
        print(f"Error deleting device: {e}")
        return error_response(str(e), 500)


@devices_bp.route('/<device_id>/heartbeat', methods=['POST'])
def device_heartbeat(device_id):
    """
    Device heartbeat - called periodically by devices to report status.
    
    Request Body (optional):
        ipAddress: Current IP
        status: Device status
        metrics: { cpu, memory, disk, etc. }
    """
    try:
        data = request.json or {}
        devices_collection = get_devices_collection()
        
        device = devices_collection.find_one({'_id': ObjectId(device_id)})
        if not device:
            return error_response('Device not found', 404)
        
        update_fields = {
            'lastSeen': get_current_utc(),
            'ipAddress': data.get('ipAddress') or request.remote_addr
        }
        
        if 'status' in data:
            update_fields['status'] = data['status']
        
        if 'metrics' in data:
            update_fields['metrics'] = data['metrics']
        
        if 'appVersion' in data:
            update_fields['appVersion'] = data['appVersion']
        
        devices_collection.update_one(
            {'_id': ObjectId(device_id)},
            {'$set': update_fields}
        )
        
        return jsonify({
            'message': 'Heartbeat received',
            'serverTime': get_current_utc().isoformat()
        }), 200
        
    except InvalidId:
        return error_response('Invalid device ID', 400)
    except Exception as e:
        print(f"Error processing heartbeat: {e}")
        return error_response(str(e), 500)


@devices_bp.route('/stats', methods=['GET'])
@require_company_access
def get_device_stats():
    """
    Get device statistics for dashboard.
    
    Query Parameters:
        companyId (required): Company ObjectId
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        devices_collection = get_devices_collection()
        
        # Get all devices for company
        devices = list(devices_collection.find({'companyId': company_id}))
        
        now = get_current_utc()
        offline_threshold = timedelta(minutes=5)
        
        total = len(devices)
        online = 0
        offline = 0
        maintenance = 0
        by_type = {}
        by_location = {}
        
        for device in devices:
            # Count by status
            if device.get('status') == 'maintenance':
                maintenance += 1
            else:
                last_seen = device.get('lastSeen')
                if last_seen:
                    if isinstance(last_seen, str):
                        last_seen = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
                    if (now - last_seen) < offline_threshold:
                        online += 1
                    else:
                        offline += 1
                else:
                    offline += 1
            
            # Count by type
            device_type = device.get('deviceType', 'unknown')
            by_type[device_type] = by_type.get(device_type, 0) + 1
            
            # Count by location
            location = device.get('locationName', 'Unassigned')
            by_location[location] = by_location.get(location, 0) + 1
        
        return jsonify({
            'stats': {
                'total': total,
                'online': online,
                'offline': offline,
                'maintenance': maintenance,
                'byType': by_type,
                'byLocation': by_location
            }
        }), 200
        
    except Exception as e:
        print(f"Error getting device stats: {e}")
        return error_response(str(e), 500)


# Device activation endpoint (for first-time device setup)
@devices_bp.route('/activate', methods=['POST'])
def activate_device():
    """
    Activate a device using an activation code.
    Called when device is first set up.
    
    Request Body:
        activationCode (required): Code from admin
        deviceInfo (required): { name, type, os }
    """
    try:
        data = request.json or {}
        
        activation_code = data.get('activationCode')
        device_info = data.get('deviceInfo', {})
        
        if not activation_code:
            return error_response('Activation code required', 400)
        
        devices_collection = get_devices_collection()
        db = get_db()
        activations = db['device_activations']
        
        # Find pending activation
        activation = activations.find_one({
            'code': activation_code,
            'status': 'pending',
            'expiresAt': {'$gt': get_current_utc()}
        })
        
        if not activation:
            return error_response('Invalid or expired activation code', 400)
        
        # Register the device
        import uuid
        device_id = str(uuid.uuid4())[:8].upper()
        
        device_doc = {
            '_id': ObjectId(),
            'companyId': activation['companyId'],
            'deviceId': f"VMS-{device_id}",
            'deviceName': device_info.get('name', f"Device-{device_id}"),
            'deviceType': device_info.get('type', 'kiosk'),
            'locationId': activation.get('locationId'),
            'locationName': activation.get('locationName'),
            'status': 'active',
            'lastSeen': get_current_utc(),
            'ipAddress': request.remote_addr,
            'userAgent': request.headers.get('User-Agent', ''),
            'osVersion': device_info.get('os'),
            'appVersion': device_info.get('appVersion', '1.0.0'),
            'features': {
                'faceRecognition': True,
                'badgePrinting': False,
                'qrScanning': True
            },
            'activationId': activation['_id'],
            'registeredAt': get_current_utc(),
            'registeredBy': 'activation'
        }
        
        devices_collection.insert_one(device_doc)
        
        # Mark activation as used
        activations.update_one(
            {'_id': activation['_id']},
            {'$set': {
                'status': 'used',
                'usedAt': get_current_utc(),
                'deviceId': device_doc['_id']
            }}
        )
        
        return jsonify({
            'message': 'Device activated successfully',
            'device': convert_objectids(device_doc)
        }), 201
        
    except Exception as e:
        print(f"Error activating device: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@devices_bp.route('/activation-codes', methods=['POST'])
@require_company_access
def create_activation_code():
    """
    Create a device activation code.
    Admin uses this to generate a code that devices use to activate.
    
    Request Body:
        companyId (required): Company ObjectId
        locationId (optional): Pre-assign to location
        locationName (optional): Location name
        expiresIn (optional): Hours until expiry (default: 24)
    """
    try:
        data = request.json or {}
        
        company_id = data.get('companyId')
        if not company_id:
            return error_response('Company ID required', 400)
        
        db = get_db()
        activations = db['device_activations']
        
        # Generate activation code
        import random
        import string
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        
        expires_hours = data.get('expiresIn', 24)
        
        activation_doc = {
            '_id': ObjectId(),
            'code': code,
            'companyId': company_id,
            'locationId': data.get('locationId'),
            'locationName': data.get('locationName'),
            'status': 'pending',
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'admin'),
            'expiresAt': get_current_utc() + timedelta(hours=expires_hours)
        }
        
        activations.insert_one(activation_doc)
        
        return jsonify({
            'message': 'Activation code created',
            'code': code,
            'expiresAt': activation_doc['expiresAt'].isoformat()
        }), 201
        
    except Exception as e:
        print(f"Error creating activation code: {e}")
        return error_response(str(e), 500)
