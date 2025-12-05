"""
Visits API - Visit scheduling, check-in/check-out
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime
import qrcode
import io
import base64

from app.db import visits_collection, visitors_collection
from app.auth import require_auth
from app.services import get_data_provider

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
@require_auth
def list_visits():
    """List visits for company"""
    company_id = request.args.get('companyId') or request.company_id
    status = request.args.get('status')
    
    query = {'companyId': ObjectId(company_id)}
    if status:
        query['status'] = status
    
    visits = list(visits_collection.find(query).sort('expectedArrival', -1).limit(100))
    return jsonify(convert_objectids(visits))


@visits_bp.route('/<visit_id>', methods=['GET'])
@require_auth
def get_visit(visit_id):
    """Get single visit"""
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    return jsonify(convert_objectids(visit))


@visits_bp.route('', methods=['POST'])
@require_auth
def schedule_visit():
    """Schedule a new visit"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    # Required fields
    required = ['visitorId', 'hostEmployeeId', 'expectedArrival']
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
    
    visit = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id),
        'visitorId': ObjectId(data['visitorId']),
        'visitorName': visitor.get('visitorName'),
        'hostEmployeeId': data['hostEmployeeId'],
        'hostEmployeeName': host_name,
        'purpose': data.get('purpose'),
        'expectedArrival': datetime.fromisoformat(data['expectedArrival'].replace('Z', '+00:00')) if isinstance(data['expectedArrival'], str) else data['expectedArrival'],
        'expectedDeparture': data.get('expectedDeparture'),
        'accessAreas': data.get('accessAreas', []),
        'status': 'scheduled',
        'createdAt': datetime.utcnow(),
        'lastUpdated': datetime.utcnow()
    }
    
    visits_collection.insert_one(visit)
    
    return jsonify({
        'id': str(visit['_id']),
        'message': 'Visit scheduled'
    }), 201


@visits_bp.route('/<visit_id>/check-in', methods=['POST'])
@require_auth
def check_in(visit_id):
    """Check in a visitor"""
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    if visit.get('status') == 'checked_in':
        return jsonify({'error': 'Already checked in'}), 400
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': {
            'status': 'checked_in',
            'actualArrival': datetime.utcnow(),
            'lastUpdated': datetime.utcnow()
        }}
    )
    
    return jsonify({'message': 'Checked in successfully'})


@visits_bp.route('/<visit_id>/check-out', methods=['POST'])
@require_auth
def check_out(visit_id):
    """Check out a visitor"""
    visit = visits_collection.find_one({'_id': ObjectId(visit_id)})
    if not visit:
        return jsonify({'error': 'Visit not found'}), 404
    
    if visit.get('status') != 'checked_in':
        return jsonify({'error': 'Not checked in'}), 400
    
    visits_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {'$set': {
            'status': 'checked_out',
            'actualDeparture': datetime.utcnow(),
            'lastUpdated': datetime.utcnow()
        }}
    )
    
    return jsonify({'message': 'Checked out successfully'})


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
