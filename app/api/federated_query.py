"""
Federated Query API for VMS

This module exposes endpoints for the Bharatlytics Platform to query
VMS data when data residency is set to "App (Federated)".

Endpoints:
- GET /api/query/visitors - Query visitor data
- GET /api/query/employees - Query employee data

These endpoints are called by the Platform's federated query service
when another app (e.g., People Tracking) requests data that VMS owns.

Authentication:
- Expects X-Platform-Request header
- Verifies Platform service token
"""

from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime
import jwt
import os
import base64

from app.db import (
    visitor_collection, employee_collection, 
    visitor_embedding_fs, visitor_image_fs,
    employee_image_fs, employee_embedding_fs
)
from app.utils import format_datetime

# Blueprint for federated query endpoints
federated_query_bp = Blueprint('federated_query', __name__, url_prefix='/api/query')

# Platform secret for verifying tokens (should match platform's PLATFORM_SECRET)
PLATFORM_SECRET = os.getenv('PLATFORM_SECRET', 'bharatlytics-platform-secret-2024')


def verify_platform_request():
    """
    Verify that the request comes from the Bharatlytics Platform.
    
    Checks:
    1. X-Platform-Request header is present
    2. Bearer token is valid Platform service token
    
    Returns:
        (is_valid, context_dict or error_message)
    """
    # Check for platform header
    if not request.headers.get('X-Platform-Request'):
        return False, 'Missing X-Platform-Request header'
    
    # Check for auth token
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False, 'Missing or invalid Authorization header'
    
    token = auth_header.replace('Bearer ', '')
    
    try:
        # Add leeway to handle clock skew between Platform and VMS
        # PyJWT 2.x: leeway is a direct parameter (in seconds)
        # Also specify expected audience to pass PyJWT 2.x audience validation
        from datetime import timedelta
        payload = jwt.decode(
            token, 
            PLATFORM_SECRET, 
            algorithms=['HS256'], 
            leeway=timedelta(seconds=60),
            audience='vms_app_v1'  # This VMS app's expected audience
        )
        
        # Verify it's a platform-issued federated query token
        if payload.get('iss') != 'bharatlytics-platform':
            return False, 'Invalid token issuer'
        
        if payload.get('type') != 'federated_query':
            return False, 'Invalid token type'
        
        return True, {
            'company_id': payload.get('company_id'),
            'requesting_app': payload.get('sub'),
            'target_app': payload.get('aud')
        }
    except jwt.ExpiredSignatureError:
        print(f"[FEDERATED] Token expired - Token: {token[:50]}...")
        return False, 'Token expired'
    except jwt.InvalidTokenError as e:
        print(f"[FEDERATED] Invalid token: {e}")
        return False, f'Invalid token: {str(e)}'


def convert_objectids(obj):
    """Recursively convert all ObjectId instances to strings"""
    if isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(item) for item in obj]
    elif isinstance(obj, datetime):
        return format_datetime(obj)
    elif isinstance(obj, bytes):
        # Skip binary data like embeddings
        return None
    else:
        return obj


@federated_query_bp.route('/visitors', methods=['GET'])
def query_visitors():
    """
    Federated query endpoint for visitor data.
    
    Called by the Platform when another app needs visitor data
    and residency is set to "App (Federated)".
    
    Query params:
    - companyId: Required - Company ID
    - status: Optional - Filter by status (active, pending, etc.)
    - limit: Optional - Max results (default 100)
    - offset: Optional - Pagination offset (default 0)
    - fields: Optional - Comma-separated list of fields to return
    - includeEmbeddings: Optional - Include embedding IDs (default false)
    
    Returns:
    {
        "data": [...],
        "count": N,
        "source": "vms_app_v1",
        "dataType": "visitor"
    }
    """
    # Verify platform request
    is_valid, result = verify_platform_request()
    if not is_valid:
        return jsonify({'error': result}), 401
    
    ctx = result
    company_id = request.args.get('companyId') or ctx.get('company_id')
    
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    # Parse query parameters
    status = request.args.get('status')
    limit = min(int(request.args.get('limit', 100)), 1000)  # Cap at 1000
    offset = int(request.args.get('offset', 0))
    fields = request.args.get('fields', '').split(',') if request.args.get('fields') else None
    include_embeddings = request.args.get('includeEmbeddings', 'false').lower() == 'true'
    include_images = request.args.get('includeImages', 'false').lower() == 'true'
    
    try:
        # Build query
        try:
            company_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        if status:
            query['status'] = status
        
        # Build projection (fields to return)
        projection = None
        if fields and fields[0]:  # Check if fields list is not empty
            projection = {f: 1 for f in fields}
            projection['_id'] = 1  # Always include ID
            projection['companyId'] = 1
        
        # Query visitors
        cursor = visitor_collection.find(query, projection).skip(offset).limit(limit)
        visitors = list(cursor)
        
        # Get total count
        total_count = visitor_collection.count_documents(query)
        
        # Process visitors
        processed = []
        for visitor in visitors:
            visitor_dict = convert_objectids(visitor)
            
            # Handle embeddings
            if include_embeddings and 'visitorEmbeddings' in visitor:
                # Include embedding metadata but not raw data
                embeddings = visitor.get('visitorEmbeddings', {})
                visitor_dict['embeddings'] = {}
                for model, emb_data in embeddings.items():
                    if isinstance(emb_data, dict):
                        visitor_dict['embeddings'][model] = {
                            'status': emb_data.get('status'),
                            'embeddingId': str(emb_data.get('embeddingId')) if emb_data.get('embeddingId') else None
                        }
            elif 'visitorEmbeddings' in visitor_dict:
                # Remove raw embedding data if not requested
                del visitor_dict['visitorEmbeddings']
            
            # Map VMS fields to platform actor format
            processed_visitor = {
                'id': visitor_dict.get('_id'),
                'actorType': 'visitor',
                'name': visitor_dict.get('visitorName'),
                'phone': visitor_dict.get('phone'),
                'email': visitor_dict.get('email'),
                'status': visitor_dict.get('status', 'active'),
                'blacklisted': visitor_dict.get('blacklisted', False),
                'companyId': company_id,
                'metadata': {
                    'organization': visitor_dict.get('organization'),
                    'idType': visitor_dict.get('idType'),
                    'idNumber': visitor_dict.get('idNumber'),
                    'visitorType': visitor_dict.get('visitorType')
                }
            }
            
            # Include images as base64 if requested
            if include_images:
                images = visitor.get('visitorImages', {})
                photo_base64 = None
                for position in ['center', 'front', 'left', 'right']:
                    if position in images and images[position]:
                        try:
                            image_id = images[position]
                            if not isinstance(image_id, ObjectId):
                                image_id = ObjectId(str(image_id))
                            file_data = visitor_image_fs.get(image_id)
                            image_bytes = file_data.read()
                            photo_base64 = f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
                            print(f"[FederatedQuery] Included {position} image for visitor {visitor_dict.get('_id')}")
                            break
                        except Exception as e:
                            print(f"[FederatedQuery] Error reading image: {e}")
                            continue
                
                if photo_base64:
                    processed_visitor['photo'] = photo_base64
                    processed_visitor['hasPhoto'] = True
                else:
                    processed_visitor['hasPhoto'] = False
            else:
                # Just include image IDs, not full data
                processed_visitor['photoId'] = str(visitor.get('visitorImages', {}).get('center', '')) or None
                processed_visitor['hasPhoto'] = bool(visitor.get('visitorImages'))
            
            # Add embeddings if requested (with model info)
            if include_embeddings and 'embeddings' in visitor_dict:
                processed_visitor['embeddings'] = visitor_dict['embeddings']
                processed_visitor['embeddingModels'] = list(visitor_dict['embeddings'].keys())
            
            processed.append(processed_visitor)
        
        return jsonify({
            'data': processed,
            'count': len(processed),
            'totalCount': total_count,
            'source': 'vms_app_v1',
            'dataType': 'visitor',
            'offset': offset,
            'limit': limit
        })
        
    except Exception as e:
        print(f"Error in query_visitors: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@federated_query_bp.route('/employees', methods=['GET'])
def query_employees():
    """
    Federated query endpoint for employee data.
    
    Query params:
    - companyId: Required - Company ID  
    - status: Optional - Filter by status
    - limit: Optional - Max results
    - offset: Optional - Pagination offset
    
    Returns:
    {
        "data": [...],
        "count": N,
        "source": "vms_app_v1",
        "dataType": "employee"
    }
    """
    # Verify platform request
    is_valid, result = verify_platform_request()
    if not is_valid:
        return jsonify({'error': result}), 401
    
    ctx = result
    company_id = request.args.get('companyId') or ctx.get('company_id')
    
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    status = request.args.get('status')
    limit = min(int(request.args.get('limit', 100)), 1000)
    offset = int(request.args.get('offset', 0))
    include_embeddings = request.args.get('includeEmbeddings', 'false').lower() == 'true'
    include_images = request.args.get('includeImages', 'false').lower() == 'true'
    
    try:
        # Build query
        try:
            company_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        if status:
            query['status'] = status
        
        # Query employees
        employees = list(employee_collection.find(query).skip(offset).limit(limit))
        total_count = employee_collection.count_documents(query)
        
        # Process employees
        processed = []
        for emp in employees:
            emp_dict = convert_objectids(emp)
            
            processed_emp = {
                'id': emp_dict.get('_id'),
                'actorType': 'employee',
                'name': emp_dict.get('employeeName'),
                # Handle both field naming conventions
                'phone': emp_dict.get('phone') or emp_dict.get('employeePhone'),
                'email': emp_dict.get('email') or emp_dict.get('employeeEmail'),
                'status': emp_dict.get('status', 'active'),
                'blacklisted': emp_dict.get('blacklisted', False),
                'companyId': company_id,
                'metadata': {
                    'employeeId': emp_dict.get('employeeId'),
                    'department': emp_dict.get('department'),
                    'designation': emp_dict.get('designation')
                }
            }
            
            # Handle embeddings - normalize format for cross-app consumption
            if include_embeddings and 'employeeEmbeddings' in emp_dict:
                embeddings = emp_dict.get('employeeEmbeddings', {})
                processed_emp['embeddings'] = {}
                for model, emb_data in embeddings.items():
                    if isinstance(emb_data, dict):
                        processed_emp['embeddings'][model] = {
                            'status': emb_data.get('status'),
                            'embeddingId': str(emb_data.get('embeddingId')) if emb_data.get('embeddingId') else None
                        }
            
            processed.append(processed_emp)

        
        return jsonify({
            'data': processed,
            'count': len(processed),
            'totalCount': total_count,
            'source': 'vms_app_v1',
            'dataType': 'employee',
            'offset': offset,
            'limit': limit
        })
        
    except Exception as e:
        print(f"Error in query_employees: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@federated_query_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for verifying federated connectivity"""
    return jsonify({
        'status': 'healthy',
        'app': 'vms_app_v1',
        'endpoints': ['/api/query/visitors', '/api/query/employees', '/api/federation/actors']
    })


# ============================================
# Unified Federation Endpoint for Platform Routing
# ============================================

@federated_query_bp.route('/federation/actors', methods=['GET'])
def federation_actors():
    """
    Unified federation endpoint for actors.
    
    This endpoint is called by the Platform when routing
    federated requests based on installationMappings.residencyMode.
    
    Query params:
    - companyId: Required
    - actorType: Required (visitor, employee)
    - limit: Optional
    
    Routes internally to the appropriate handler.
    """
    actor_type = request.args.get('actorType')
    
    if not actor_type:
        return jsonify({'error': 'actorType is required'}), 400
    
    # Route to appropriate handler
    if actor_type == 'visitor':
        return query_visitors_for_federation()
    elif actor_type == 'employee':
        return query_employees_for_federation()
    else:
        return jsonify({
            'error': f'Actor type {actor_type} not supported by VMS',
            'supportedTypes': ['visitor', 'employee']
        }), 400


def query_visitors_for_federation():
    """Internal handler for federated visitor queries"""
    # Relaxed auth check - just verify it's from Platform
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing Authorization header'}), 401
    
    # Get parameters
    company_id = request.args.get('companyId')
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    limit = min(int(request.args.get('limit', 100)), 1000)
    offset = int(request.args.get('offset', 0))
    status = request.args.get('status')
    
    try:
        # Build query
        try:
            company_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        if status:
            query['status'] = status
        else:
            query['status'] = {'$ne': 'archived'}
        
        # Query visitors
        visitors = list(visitor_collection.find(query).skip(offset).limit(limit))
        
        # Format for Platform consumption
        results = []
        for visitor in visitors:
            results.append({
                '_id': str(visitor.get('_id')),
                'actorType': 'visitor',
                'name': visitor.get('visitorName'),
                'phone': visitor.get('phone'),
                'email': visitor.get('email'),
                'status': visitor.get('status', 'active'),
                'companyId': str(company_id),
                'sourceApp': 'vms_app_v1',
                'attributes': {
                    'visitorName': visitor.get('visitorName'),
                    'phone': visitor.get('phone'),
                    'email': visitor.get('email'),
                    'organization': visitor.get('organization'),
                    'visitorType': visitor.get('visitorType'),
                    'idType': visitor.get('idType'),
                    'idNumber': visitor.get('idNumber')
                },
                'actorEmbeddings': convert_objectids(visitor.get('visitorEmbeddings', {}))
            })
        
        print(f"[federation] Returning {len(results)} visitors for company {company_id}")
        return jsonify(results)
        
    except Exception as e:
        print(f"[federation] Error: {e}")
        return jsonify({'error': str(e)}), 500


def query_employees_for_federation():
    """Internal handler for federated employee queries"""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing Authorization header'}), 401
    
    company_id = request.args.get('companyId')
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    limit = min(int(request.args.get('limit', 100)), 1000)
    offset = int(request.args.get('offset', 0))
    
    try:
        try:
            company_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        query['status'] = {'$ne': 'archived'}
        
        employees = list(employee_collection.find(query).skip(offset).limit(limit))
        
        results = []
        for emp in employees:
            results.append({
                '_id': str(emp.get('_id')),
                'actorType': 'employee',
                'name': emp.get('employeeName'),
                'phone': emp.get('phone') or emp.get('employeePhone'),
                'email': emp.get('email') or emp.get('employeeEmail'),
                'status': emp.get('status', 'active'),
                'companyId': str(company_id),
                'sourceApp': 'vms_app_v1',
                'attributes': {
                    'employeeName': emp.get('employeeName'),
                    'employeeId': emp.get('employeeId'),
                    'department': emp.get('department'),
                    'designation': emp.get('designation'),
                    'email': emp.get('email') or emp.get('employeeEmail'),
                    'phone': emp.get('phone') or emp.get('employeePhone')
                },
                'actorEmbeddings': convert_objectids(emp.get('employeeEmbeddings', {}))
            })
        
        print(f"[federation] Returning {len(results)} employees for company {company_id}")
        return jsonify(results)
        
    except Exception as e:
        print(f"[federation] Error: {e}")
        return jsonify({'error': str(e)}), 500
