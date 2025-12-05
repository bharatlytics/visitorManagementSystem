"""
Visitors API - Core VMS functionality
Handles visitor registration, listing, updates
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime

from app.db import visitors_collection, visitor_image_fs
from app.auth import require_auth

visitors_bp = Blueprint('visitors', __name__)


def convert_objectids(obj):
    """Recursively convert ObjectId to string"""
    if isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(i) for i in obj]
    elif isinstance(obj, ObjectId):
        return str(obj)
    return obj


@visitors_bp.route('', methods=['GET'])
@require_auth
def list_visitors():
    """List all visitors for company"""
    company_id = request.args.get('companyId') or request.company_id
    
    visitors = list(visitors_collection.find({'companyId': ObjectId(company_id)}).sort('createdAt', -1))
    return jsonify(convert_objectids(visitors))


@visitors_bp.route('/<visitor_id>', methods=['GET'])
@require_auth
def get_visitor(visitor_id):
    """Get single visitor"""
    visitor = visitors_collection.find_one({'_id': ObjectId(visitor_id)})
    if not visitor:
        return jsonify({'error': 'Visitor not found'}), 404
    return jsonify(convert_objectids(visitor))


@visitors_bp.route('', methods=['POST'])
@require_auth
def register_visitor():
    """Register a new visitor"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    # Required fields
    if not data.get('visitorName'):
        return jsonify({'error': 'Visitor name required'}), 400
    
    visitor = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id),
        'visitorName': data['visitorName'],
        'visitorEmail': data.get('visitorEmail'),
        'visitorPhone': data.get('visitorPhone'),
        'visitorCompany': data.get('visitorCompany'),
        'visitorType': data.get('visitorType', 'general'),
        'idType': data.get('idType'),
        'idNumber': data.get('idNumber'),
        'status': 'active',
        'isBlacklisted': False,
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow()
    }
    
    visitors_collection.insert_one(visitor)
    
    return jsonify({
        'id': str(visitor['_id']),
        'message': 'Visitor registered successfully'
    }), 201


@visitors_bp.route('/<visitor_id>', methods=['PUT', 'PATCH'])
@require_auth
def update_visitor(visitor_id):
    """Update visitor"""
    data = request.json or {}
    
    # Remove protected fields
    data.pop('_id', None)
    data.pop('companyId', None)
    data['updatedAt'] = datetime.utcnow()
    
    result = visitors_collection.update_one(
        {'_id': ObjectId(visitor_id)},
        {'$set': data}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Visitor not found'}), 404
    
    return jsonify({'message': 'Visitor updated'})


@visitors_bp.route('/<visitor_id>/blacklist', methods=['POST'])
@require_auth
def blacklist_visitor(visitor_id):
    """Blacklist a visitor"""
    data = request.json or {}
    
    visitors_collection.update_one(
        {'_id': ObjectId(visitor_id)},
        {'$set': {
            'isBlacklisted': True,
            'blacklistReason': data.get('reason'),
            'blacklistedAt': datetime.utcnow()
        }}
    )
    
    return jsonify({'message': 'Visitor blacklisted'})


@visitors_bp.route('/<visitor_id>/unblacklist', methods=['POST'])
@require_auth
def unblacklist_visitor(visitor_id):
    """Remove visitor from blacklist"""
    visitors_collection.update_one(
        {'_id': ObjectId(visitor_id)},
        {'$set': {
            'isBlacklisted': False,
            'blacklistReason': None,
            'blacklistedAt': None
        }}
    )
    
    return jsonify({'message': 'Visitor removed from blacklist'})


@visitors_bp.route('/<visitor_id>', methods=['DELETE'])
@require_auth
def delete_visitor(visitor_id):
    """Delete visitor"""
    result = visitors_collection.delete_one({'_id': ObjectId(visitor_id)})
    
    if result.deleted_count == 0:
        return jsonify({'error': 'Visitor not found'}), 404
    
    return jsonify({'message': 'Visitor deleted'})
