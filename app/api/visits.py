"""
Visits API - Visit scheduling, check-in/check-out
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime
import qrcode
import io
import base64

from app.db import visit_collection, visitor_collection
from app.auth import require_auth, require_company_access
from app.services import get_data_provider

# Aliases for compatibility with this file
visits_collection = visit_collection
visitors_collection = visitor_collection

visits_bp = Blueprint('visits', __name__)


def convert_objectids(obj):
    if isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(i) for i in obj]
    elif isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


@visits_bp.route('', methods=['GET'])
@require_company_access
def list_visits():
    """List visits for company"""
    company_id = request.args.get('companyId') or request.company_id
    status = request.args.get('status')
    
    # Support both ObjectId and string companyId in database
    from bson.errors import InvalidId
    try:
        company_oid = ObjectId(company_id)
        company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
    except InvalidId:
        company_match = {'companyId': company_id}
    
    query = company_match.copy()
    if status:
        query['status'] = status
    
    visits = list(visits_collection.find(query).sort('expectedArrival', -1).limit(100))
    return jsonify(convert_objectids(visits))


@visits_bp.route('/<visit_id>', methods=['GET'])
@require_company_access
def get_visit(visit_id):
    """Get single visit"""
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    return jsonify(convert_objectids(visit))


@visits_bp.route('/<visit_id>', methods=['PATCH', 'PUT'])
@require_company_access
def update_visit(visit_id):
    """
    Update visit details.
    Only allows updates when visit is in 'scheduled' status.
    Cannot update after check-in has occurred.
    """
    data = request.json or {}
    
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    # Only allow updates for scheduled visits
    if visit.get('status') not in ['scheduled', 'pending']:
        return jsonify({'error': 'Cannot update visit after check-in'}), 400
    
    update_fields = {}
    
    # Allowed fields for update
    allowed_fields = [
        'purpose', 'expectedArrival', 'expectedDeparture', 'durationHours',
        'hostEmployeeId', 'locationId', 'locationName', 'notes',
        'vehicleNumber', 'vehicleType', 'driverName',
        'requiresApproval', 'approvalStatus'
    ]
    
    for field in allowed_fields:
        if field in data:
            # Parse datetime fields
            if field in ['expectedArrival', 'expectedDeparture'] and data[field]:
                if isinstance(data[field], str):
                    update_fields[field] = datetime.fromisoformat(data[field].replace('Z', '+00:00'))
                else:
                    update_fields[field] = data[field]
            else:
                update_fields[field] = data[field]
    
    # Update nested objects (assets, facilities, compliance, vehicle)
    nested_fields = ['assets', 'facilities', 'compliance', 'vehicle']
    for nested_field in nested_fields:
        if nested_field in data and isinstance(data[nested_field], dict):
            for key, value in data[nested_field].items():
                update_fields[f'{nested_field}.{key}'] = value
    
    # Update accessAreas if provided
    if 'accessAreas' in data and isinstance(data['accessAreas'], list):
        update_fields['accessAreas'] = data['accessAreas']
    
    # Update host employee name if hostEmployeeId changed
    if 'hostEmployeeId' in update_fields:
        data_provider = get_data_provider(str(visit.get('companyId')))
        host = data_provider.get_employee_by_id(update_fields['hostEmployeeId'], str(visit.get('companyId')))
        if host:
            update_fields['hostEmployeeName'] = host.get('employeeName', 'Unknown')
    
    if not update_fields:
        return jsonify({'error': 'No valid fields to update'}), 400
    
    update_fields['lastUpdated'] = datetime.utcnow()
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': update_fields}
    )
    
    # Fetch updated visit
    updated_visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    
    return jsonify({
        'message': 'Visit updated successfully',
        'visit': convert_objectids(updated_visit)
    })


@visits_bp.route('/<visit_id>', methods=['DELETE'])
@require_company_access
def delete_visit(visit_id):
    """
    Delete/cancel a visit.
    - Scheduled visits: Set status to 'cancelled'
    - Checked-in visits: Cannot be deleted (must check-out first)
    - Already completed visits: Set status to 'deleted' for audit trail
    """
    data = request.json or {}
    cancel_reason = data.get('reason', 'Cancelled by user')
    
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    current_status = visit.get('status')
    
    # Cannot delete a visit that is currently checked in
    if current_status == 'checked_in':
        return jsonify({'error': 'Cannot delete an active visit. Please check-out first.'}), 400
    
    # Determine new status based on current status
    if current_status == 'scheduled':
        new_status = 'cancelled'
    else:
        new_status = 'deleted'
    
    update_data = {
        'status': new_status,
        'cancelReason': cancel_reason,
        'cancelledAt': datetime.utcnow(),
        'lastUpdated': datetime.utcnow()
    }
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': update_data}
    )
    
    # Remove visit reference from visitor's visits array
    if visit.get('visitorId'):
        visitors_collection.update_one(
            {'_id': visit['visitorId']},
            {'$pull': {'visits': str(visit_id)}}
        )
    
    return jsonify({
        'message': f'Visit {new_status} successfully',
        'visitId': visit_id,
        'status': new_status
    })


@visits_bp.route('', methods=['POST'])
@require_company_access
def schedule_visit():
    """Schedule a new visit with enterprise fields"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    # Required fields
    required = ['visitorId', 'hostEmployeeId']
    if not all(data.get(k) for k in required):
        return jsonify({'error': f'Required: {required}'}), 400
    
    # Get visitor info
    visitor = visitors_collection.find_one({'_id': ObjectId(data['visitorId'])})
    if not visitor:
        return jsonify({'error': 'Visitor not found'}), 404
    
    # Get host employee info using DataProvider (dual-mode)
    data_provider = get_data_provider(company_id)
    host = data_provider.get_employee_by_id(data['hostEmployeeId'], company_id)
    host_name = host.get('employeeName', 'Unknown') if host else 'Unknown'
    
    # Parse datetime fields
    expected_arrival = None
    expected_departure = None
    if data.get('expectedArrival'):
        expected_arrival = datetime.fromisoformat(data['expectedArrival'].replace('Z', '+00:00')) if isinstance(data['expectedArrival'], str) else data['expectedArrival']
    if data.get('expectedDeparture'):
        expected_departure = datetime.fromisoformat(data['expectedDeparture'].replace('Z', '+00:00')) if isinstance(data['expectedDeparture'], str) else data['expectedDeparture']
    
    visit = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id),
        
        # Core
        'visitorId': ObjectId(data['visitorId']),
        'visitorName': visitor.get('visitorName'),
        'hostEmployeeId': data['hostEmployeeId'],
        'hostEmployeeName': host_name,
        'visitType': data.get('visitType', 'guest'),
        'purpose': data.get('purpose'),
        
        # Location & Device
        'locationId': data.get('locationId'),
        'locationName': data.get('locationName'),
        'deviceId': data.get('deviceId'),  # Entry device (kiosk/turnstile)
        'deviceName': data.get('deviceName'),
        
        # Schedule
        'expectedArrival': expected_arrival,
        'expectedDeparture': expected_departure,
        'durationHours': data.get('durationHours', 2),
        'recurring': data.get('recurring', False),
        'requiresApproval': data.get('requiresApproval', False),
        
        # Assets
        'assets': {
            'laptop': data.get('assets', {}).get('laptop', False),
            'camera': data.get('assets', {}).get('camera', False),
            'pendrive': data.get('assets', {}).get('pendrive', False),
            'mobile': data.get('assets', {}).get('mobile', False),
            'bag': data.get('assets', {}).get('bag', False),
            'tools': data.get('assets', {}).get('tools', False),
            'details': data.get('assetDetails', '')
        },
        
        # Facilities
        'facilities': {
            'lunchIncluded': data.get('lunchIncluded', False),
            'parkingRequired': data.get('parkingRequired', False),
            'wifiAccess': data.get('wifiAccess', False),
            'mealPreference': data.get('mealPreference', '')
        },
        'accessAreas': data.get('accessAreas', []),
        
        # Vehicle
        'vehicle': {
            'number': data.get('vehicleNumber', ''),
            'type': data.get('vehicleType', ''),
            'driverName': data.get('driverName', '')
        },
        
        # Compliance
        'compliance': {
            'ndaRequired': data.get('ndaRequired', False),
            'ndaSigned': False,
            'safetyBriefingRequired': data.get('safetyBriefing', False),
            'safetyBriefingCompleted': False,
            'escortRequired': data.get('escortRequired', False),
            'idVerified': data.get('idVerified', False)
        },
        
        # Status & Tracking
        'status': 'scheduled',
        'approvalStatus': 'pending' if data.get('requiresApproval') else 'approved',
        'notes': data.get('notes', ''),
        
        # Check-in/out tracking
        'checkInDeviceId': None,
        'checkOutDeviceId': None,
        'checkInMethod': None,  # face, qr, manual
        'checkOutMethod': None,
        
        # Timestamps
        'actualArrival': None,
        'actualDeparture': None,
        'createdAt': datetime.utcnow(),
        'lastUpdated': datetime.utcnow()
    }
    
    visits_collection.insert_one(visit)
    
    return jsonify({
        'id': str(visit['_id']),
        'message': 'Visit scheduled'
    }), 201


@visits_bp.route('/<visit_id>/check-in', methods=['POST'])
@require_company_access
def check_in(visit_id):
    """Check in a visitor with device and method tracking"""
    data = request.json or {}
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    if visit.get('status') == 'checked_in':
        return jsonify({'error': 'Already checked in'}), 400
    
    update_data = {
        'status': 'checked_in',
        'actualArrival': datetime.utcnow(),
        'checkInDeviceId': data.get('deviceId'),
        'checkInDeviceName': data.get('deviceName'),
        'checkInMethod': data.get('method', 'manual'),  # face, qr, manual
        'lastUpdated': datetime.utcnow()
    }
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': update_data}
    )
    
    return jsonify({
        'message': 'Checked in successfully',
        'checkInTime': update_data['actualArrival'].isoformat(),
        'method': update_data['checkInMethod']
    })


@visits_bp.route('/<visit_id>/check-out', methods=['POST'])
@require_company_access
def check_out(visit_id):
    """Check out a visitor with device and method tracking"""
    data = request.json or {}
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    if visit.get('status') != 'checked_in':
        return jsonify({'error': 'Not checked in'}), 400
    
    actual_departure = datetime.utcnow()
    duration_minutes = None
    if visit.get('actualArrival'):
        duration = actual_departure - visit['actualArrival']
        duration_minutes = int(duration.total_seconds() / 60)
    
    update_data = {
        'status': 'checked_out',
        'actualDeparture': actual_departure,
        'checkOutDeviceId': data.get('deviceId'),
        'checkOutDeviceName': data.get('deviceName'),
        'checkOutMethod': data.get('method', 'manual'),
        'durationMinutes': duration_minutes,
        'lastUpdated': datetime.utcnow()
    }
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': update_data}
    )
    
    return jsonify({
        'message': 'Checked out successfully',
        'checkOutTime': actual_departure.isoformat(),
        'durationMinutes': duration_minutes,
        'method': update_data['checkOutMethod']
    })


@visits_bp.route('/<visit_id>/qr', methods=['GET'])
def get_visit_qr(visit_id):
    """Generate QR code for visit"""
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    qr = qrcode.QRCode(box_size=10, border=2)
    qr.add_data(str(visit_id))
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return buffer.getvalue(), 200, {'Content-Type': 'image/png'}
