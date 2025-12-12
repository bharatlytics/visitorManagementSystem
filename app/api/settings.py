"""
VMS Settings API - Full Enterprise Configuration
Includes: Auto-checkout, Devices, Locations, Notifications, Visitor Types, Workflows
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime

from app.db import settings_collection, devices_collection, locations_collection
from app.auth import require_auth

settings_bp = Blueprint('vms_settings', __name__)

# Default settings
DEFAULT_SETTINGS = {
    'autoCheckoutHours': 8,
    'requireVisitorName': True,
    'notifications': {
        'email': True,
        'sms': False,
        'whatsapp': False
    },
    'visitorTypes': ['guest', 'vendor', 'contractor', 'interview', 'vip'],
    'requireApproval': False,
    'badgeTemplate': 'default'
}


def get_company_settings(company_id):
    """Get settings for a company, creating defaults if needed"""
    try:
        company_oid = ObjectId(company_id)
    except:
        company_oid = company_id
    
    settings = settings_collection.find_one({
        '$or': [{'companyId': company_oid}, {'companyId': company_id}]
    })
    
    if not settings:
        settings = {
            '_id': ObjectId(),
            'companyId': company_id,
            **DEFAULT_SETTINGS,
            'createdAt': datetime.utcnow(),
            'updatedAt': datetime.utcnow()
        }
        settings_collection.insert_one(settings)
    
    return settings


@settings_bp.route('', methods=['GET'])
@require_auth
def get_settings():
    """Get company VMS settings"""
    company_id = request.args.get('companyId') or request.company_id
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    settings = get_company_settings(company_id)
    
    # Get devices for this company
    try:
        company_oid = ObjectId(company_id)
        devices = list(devices_collection.find({
            '$or': [{'companyId': company_oid}, {'companyId': company_id}]
        }))
        for d in devices:
            d['_id'] = str(d['_id'])
            d['companyId'] = str(d.get('companyId', ''))
            if d.get('entityId'):
                d['entityId'] = str(d['entityId'])
    except:
        devices = []
    
    return jsonify({
        'companyId': str(settings.get('companyId')),
        'autoCheckoutHours': settings.get('autoCheckoutHours', DEFAULT_SETTINGS['autoCheckoutHours']),
        'requireVisitorName': settings.get('requireVisitorName', DEFAULT_SETTINGS['requireVisitorName']),
        'notifications': settings.get('notifications', DEFAULT_SETTINGS['notifications']),
        'visitorTypes': settings.get('visitorTypes', DEFAULT_SETTINGS['visitorTypes']),
        'requireApproval': settings.get('requireApproval', DEFAULT_SETTINGS['requireApproval']),
        'badgeTemplate': settings.get('badgeTemplate', DEFAULT_SETTINGS['badgeTemplate']),
        'devices': devices,
        'updatedAt': settings.get('updatedAt', datetime.utcnow()).isoformat() if settings.get('updatedAt') else None
    })


@settings_bp.route('', methods=['PUT'])
@require_auth
def update_settings():
    """Update company VMS settings"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    # Build update
    update_data = {'updatedAt': datetime.utcnow()}
    
    # Auto-checkout hours
    if 'autoCheckoutHours' in data:
        try:
            hours = int(data['autoCheckoutHours'])
            if 1 <= hours <= 48:
                update_data['autoCheckoutHours'] = hours
        except (ValueError, TypeError):
            pass
    
    # Boolean fields
    if 'requireVisitorName' in data:
        update_data['requireVisitorName'] = bool(data['requireVisitorName'])
    if 'requireApproval' in data:
        update_data['requireApproval'] = bool(data['requireApproval'])
    
    # Notifications
    if 'notifications' in data and isinstance(data['notifications'], dict):
        update_data['notifications'] = {
            'email': bool(data['notifications'].get('email', True)),
            'sms': bool(data['notifications'].get('sms', False)),
            'whatsapp': bool(data['notifications'].get('whatsapp', False))
        }
    
    # Visitor types
    if 'visitorTypes' in data and isinstance(data['visitorTypes'], list):
        update_data['visitorTypes'] = data['visitorTypes']
    
    # Badge template
    if 'badgeTemplate' in data:
        update_data['badgeTemplate'] = str(data['badgeTemplate'])
    
    # Ensure settings exist
    get_company_settings(company_id)
    
    # Update
    try:
        company_oid = ObjectId(company_id)
        query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
    except:
        query = {'companyId': company_id}
    
    settings_collection.update_one(query, {'$set': update_data})
    
    return jsonify({
        'message': 'Settings updated successfully'
    })


# =====================================
# Device Management Endpoints
# =====================================

@settings_bp.route('/devices', methods=['GET'])
@require_auth
def list_devices():
    """List all devices for a company"""
    company_id = request.args.get('companyId') or request.company_id
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    try:
        company_oid = ObjectId(company_id)
        devices = list(devices_collection.find({
            '$or': [{'companyId': company_oid}, {'companyId': company_id}]
        }))
        for d in devices:
            d['_id'] = str(d['_id'])
            d['companyId'] = str(d.get('companyId', ''))
            if d.get('entityId'):
                d['entityId'] = str(d['entityId'])
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    return jsonify(devices)


@settings_bp.route('/devices', methods=['POST'])
@require_auth
def create_device():
    """Create a new device"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    if not data.get('name'):
        return jsonify({'error': 'Device name required'}), 400
    
    device = {
        '_id': ObjectId(),
        'companyId': company_id,
        'name': data['name'],
        'type': data.get('type', 'kiosk'),  # kiosk, tablet, turnstile
        'entityId': data.get('entityId'),
        'entityName': data.get('entityName', ''),
        'mode': data.get('mode', 'both'),  # checkin, checkout, both
        'status': 'active',
        'lastSeen': None,
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow()
    }
    
    devices_collection.insert_one(device)
    
    return jsonify({
        'id': str(device['_id']),
        'message': 'Device created successfully'
    }), 201


@settings_bp.route('/devices/<device_id>', methods=['PUT'])
@require_auth
def update_device(device_id):
    """Update a device"""
    data = request.json or {}
    
    update_data = {'updatedAt': datetime.utcnow()}
    
    if 'name' in data:
        update_data['name'] = data['name']
    if 'type' in data:
        update_data['type'] = data['type']
    if 'entityId' in data:
        update_data['entityId'] = data['entityId']
    if 'entityName' in data:
        update_data['entityName'] = data['entityName']
    if 'mode' in data:
        update_data['mode'] = data['mode']
    if 'status' in data:
        update_data['status'] = data['status']
    
    result = devices_collection.update_one(
        {'_id': ObjectId(device_id)},
        {'$set': update_data}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Device not found'}), 404
    
    return jsonify({'message': 'Device updated successfully'})


@settings_bp.route('/devices/<device_id>', methods=['DELETE'])
@require_auth
def delete_device(device_id):
    """Delete a device"""
    result = devices_collection.delete_one({'_id': ObjectId(device_id)})
    
    if result.deleted_count == 0:
        return jsonify({'error': 'Device not found'}), 404
    
    return jsonify({'message': 'Device deleted successfully'})


# =====================================
# Location Management (VMS Domain)
# =====================================

@settings_bp.route('/locations', methods=['GET'])
@require_auth
def list_locations():
    """List all VMS locations for a company"""
    company_id = request.args.get('companyId') or request.company_id
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    try:
        company_oid = ObjectId(company_id)
        locations = list(locations_collection.find({
            '$or': [{'companyId': company_oid}, {'companyId': company_id}]
        }))
        for loc in locations:
            loc['_id'] = str(loc['_id'])
            loc['companyId'] = str(loc.get('companyId', ''))
            if loc.get('platformEntityId'):
                loc['platformEntityId'] = str(loc['platformEntityId'])
    except Exception as err:
        return jsonify({'error': str(err)}), 500
    
    return jsonify(locations)


@settings_bp.route('/locations', methods=['POST'])
@require_auth
def create_location():
    """Create a new VMS location"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    if not data.get('name'):
        return jsonify({'error': 'Location name required'}), 400
    
    location = {
        '_id': ObjectId(),
        'companyId': company_id,
        'name': data['name'],
        'type': data.get('type', 'gate'),  # gate, reception, floor, building
        'address': data.get('address', ''),
        'timezone': data.get('timezone', 'Asia/Kolkata'),
        'platformEntityId': data.get('platformEntityId'),  # For platform mapping
        'status': 'active',
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow()
    }
    
    locations_collection.insert_one(location)
    
    return jsonify({
        'id': str(location['_id']),
        'message': 'Location created successfully'
    }), 201


@settings_bp.route('/locations/<location_id>', methods=['PUT'])
@require_auth
def update_location(location_id):
    """Update a VMS location"""
    data = request.json or {}
    
    update_data = {'updatedAt': datetime.utcnow()}
    
    for field in ['name', 'type', 'address', 'timezone', 'platformEntityId', 'status']:
        if field in data:
            update_data[field] = data[field]
    
    result = locations_collection.update_one(
        {'_id': ObjectId(location_id)},
        {'$set': update_data}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Location not found'}), 404
    
    return jsonify({'message': 'Location updated successfully'})


@settings_bp.route('/locations/<location_id>', methods=['DELETE'])
@require_auth
def delete_location(location_id):
    """Delete a VMS location"""
    # Check if any devices use this location
    device_count = devices_collection.count_documents({'locationId': location_id})
    if device_count > 0:
        return jsonify({
            'error': f'Cannot delete: {device_count} device(s) at this location'
        }), 400
    
    result = locations_collection.delete_one({'_id': ObjectId(location_id)})
    
    if result.deleted_count == 0:
        return jsonify({'error': 'Location not found'}), 404
    
    return jsonify({'message': 'Location deleted successfully'})

