"""
VMS Sync Pull API

This module exposes endpoints for the Platform to pull data from VMS.
Platform controls when to pull - VMS just provides the data.

Endpoints:
- GET /api/sync/pull/employees/<id> - Pull employee data
- GET /api/sync/pull/visitors/<id> - Pull visitor data
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
import jwt
import os
import base64

from app.db import (
    employee_collection, visitor_collection,
    employee_image_fs, visitor_image_fs
)
from app.config import Config

sync_pull_bp = Blueprint('sync_pull', __name__, url_prefix='/api/sync/pull')

# Platform secret for verifying sync tokens
PLATFORM_SECRET = os.getenv('PLATFORM_SECRET', 'bharatlytics-platform-secret-2024')


def verify_platform_sync_request():
    """Verify that request comes from Platform for sync"""
    if not request.headers.get('X-Sync-Request'):
        return False, 'Missing X-Sync-Request header'
    
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False, 'Missing Authorization header'
    
    token = auth_header.replace('Bearer ', '')
    
    try:
        payload = jwt.decode(
            token, 
            PLATFORM_SECRET, 
            algorithms=['HS256'],
            audience='vms_app_v1'
        )
        
        if payload.get('iss') != 'bharatlytics-platform':
            return False, 'Invalid issuer'
        
        if payload.get('type') != 'sync_pull':
            return False, 'Invalid token type'
        
        return True, {'company_id': payload.get('company_id')}
        
    except jwt.ExpiredSignatureError:
        return False, 'Token expired'
    except jwt.InvalidTokenError as e:
        return False, f'Invalid token: {str(e)}'


def get_image_base64(fs, image_id):
    """Get image from GridFS as base64"""
    try:
        if not image_id:
            return None
        if not isinstance(image_id, ObjectId):
            image_id = ObjectId(str(image_id))
        file_data = fs.get(image_id)
        image_bytes = file_data.read()
        return f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
    except Exception as e:
        print(f"[SyncPull] Error reading image: {e}")
        return None


@sync_pull_bp.route('/employees/<employee_id>', methods=['GET'])
def pull_employee(employee_id):
    """
    Platform calls this to pull employee data for sync.
    Returns full employee data including images as base64.
    """
    # Verify platform request
    is_valid, result = verify_platform_sync_request()
    if not is_valid:
        return jsonify({'error': result}), 401
    
    try:
        employee = employee_collection.find_one({'_id': ObjectId(employee_id)})
    except InvalidId:
        return jsonify({'error': 'Invalid employee ID'}), 400
    
    if not employee:
        return jsonify({'error': 'Employee not found'}), 404
    
    # Build response with images
    images = employee.get('employeeImages', {})
    photo_base64 = None
    for position in ['front', 'center', 'left', 'right']:
        if position in images and images[position]:
            photo_base64 = get_image_base64(employee_image_fs, images[position])
            if photo_base64:
                break
    
    response = {
        'id': str(employee['_id']),
        'attributes': {
            'name': employee.get('employeeName'),
            'email': employee.get('email') or employee.get('employeeEmail'),
            'phone': employee.get('phone') or employee.get('employeeMobile'),
            'employeeId': employee.get('employeeId'),
            'department': employee.get('department'),
            'designation': employee.get('designation') or employee.get('employeeDesignation'),
            'photo': photo_base64
        },
        'status': employee.get('status', 'active'),
        'blacklisted': employee.get('blacklisted', False),
        'companyId': str(employee.get('companyId')),
        'hasPhoto': bool(photo_base64),
        'syncedFrom': 'vms_app_v1'
    }
    
    return jsonify(response)


@sync_pull_bp.route('/visitors/<visitor_id>', methods=['GET'])
def pull_visitor(visitor_id):
    """
    Platform calls this to pull visitor data for sync.
    Note: By default, visitors stay in VMS (federated).
    This endpoint is for cases where platform needs to cache visitor data.
    """
    # Verify platform request
    is_valid, result = verify_platform_sync_request()
    if not is_valid:
        return jsonify({'error': result}), 401
    
    try:
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
    except InvalidId:
        return jsonify({'error': 'Invalid visitor ID'}), 400
    
    if not visitor:
        return jsonify({'error': 'Visitor not found'}), 404
    
    # Build response with images
    images = visitor.get('visitorImages', {})
    photo_base64 = None
    for position in ['center', 'front', 'left', 'right']:
        if position in images and images[position]:
            photo_base64 = get_image_base64(visitor_image_fs, images[position])
            if photo_base64:
                break
    
    response = {
        'id': str(visitor['_id']),
        'attributes': {
            'name': visitor.get('visitorName'),
            'email': visitor.get('email'),
            'phone': visitor.get('phone'),
            'organization': visitor.get('organization'),
            'visitorType': visitor.get('visitorType'),
            'photo': photo_base64
        },
        'status': visitor.get('status', 'active'),
        'blacklisted': visitor.get('blacklisted', False),
        'companyId': str(visitor.get('companyId')),
        'hasPhoto': bool(photo_base64),
        'syncedFrom': 'vms_app_v1'
    }
    
    return jsonify(response)


@sync_pull_bp.route('/health', methods=['GET'])
def health():
    """Health check for sync endpoints"""
    return jsonify({
        'status': 'healthy',
        'app': 'vms_app_v1',
        'endpoints': ['/employees/<id>', '/visitors/<id>']
    })
