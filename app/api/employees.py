"""
Enterprise Employee Management API

Full CRUD operations for employees with data residency support:
- If residency is 'platform': Sync to/from platform
- If residency is 'app': Store locally in VMS

Per the manifest, VMS has 'write' access to employees and can produce employee data.
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime
import requests

from app.auth import require_auth, require_company_access
from app.services import get_data_provider
from app.db import (
    employees_collection, employee_image_fs, employee_embedding_fs,
    embedding_jobs_collection
)
from app.config import Config
from app.utils import (
    validate_required_fields, error_response, validate_email_format,
    validate_phone_format, get_current_utc
)
from app.services.integration_helper import integration_client

employees_bp = Blueprint('employees', __name__)


def convert_objectids(obj):
    """Convert ObjectIds to strings recursively"""
    if isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(item) for item in obj]
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def get_residency_mode(company_id):
    """Get employee data residency mode from platform installation mapping"""
    from flask import session
    data_provider = get_data_provider(company_id)
    config = data_provider._get_full_mapping_config('employee')
    return config.get('mode', 'app')  # Default to 'app' if not configured


def sync_employee_to_platform(employee_data, company_id, include_images=True):
    """
    Sync employee to platform actors collection.
    
    If include_images=True, reads images from GridFS and includes as base64
    so platform's actor_embedding_worker can generate embeddings.
    """
    from flask import session
    import base64
    
    try:
        platform_token = session.get('platform_token')
        
        # Build base attributes
        attributes = {
            'name': employee_data.get('employeeName'),
            'employeeName': employee_data.get('employeeName'),
            'email': employee_data.get('email'),
            'phone': employee_data.get('phone'),
            'department': employee_data.get('department'),
            'designation': employee_data.get('designation'),
            'employeeId': employee_data.get('employeeId'),
        }
        
        # Include images as base64 for platform embedding generation
        photo_data = None
        if include_images and employee_data.get('employeeImages'):
            images = employee_data.get('employeeImages', {})
            # Priority: center > front > left (best for face recognition)
            for position in ['center', 'front', 'left', 'right', 'side']:
                if position in images and images[position]:
                    try:
                        image_id = images[position]
                        from bson import ObjectId
                        if not isinstance(image_id, ObjectId):
                            image_id = ObjectId(image_id)
                        
                        file_data = employee_image_fs.get(image_id)
                        image_bytes = file_data.read()
                        photo_data = base64.b64encode(image_bytes).decode('utf-8')
                        print(f"[sync_to_platform] Included {position} image ({len(image_bytes)} bytes)")
                        break
                    except Exception as e:
                        print(f"[sync_to_platform] Error reading {position} image: {e}")
                        continue
        
        if photo_data:
            attributes['photo'] = f"data:image/jpeg;base64,{photo_data}"
        
        # Build actor payload
        actor_data = {
            'companyId': str(company_id),
            'actorType': 'employee',
            'attributes': attributes,
            'sourceAppId': 'vms_app_v1',
            'sourceActorId': str(employee_data.get('_id')),
            'status': 'active',
            'metadata': {
                'hasPhoto': bool(photo_data),
                'sourceApp': 'vms_app_v1',
                'syncedAt': datetime.utcnow().isoformat()
            }
        }
        
        if not platform_token:
            print("[sync_to_platform] No platform token, using integration API")
            from app.services.integration_helper import integration_client
            return integration_client.sync_actor({
                'type': 'employee',
                'id': str(employee_data.get('_id')),
                'data': attributes,
                'operation': 'upsert'
            })
        
        # Direct platform API call
        headers = {
            'Authorization': f'Bearer {platform_token}',
            'Content-Type': 'application/json',
            'X-App-Id': 'vms_app_v1',
            'X-Source-App': 'vms_app_v1'
        }
        
        response = requests.post(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            headers=headers,
            json=actor_data,
            timeout=30  # Longer timeout for image data
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            print(f"[sync_to_platform] Employee synced: {employee_data.get('employeeName')} (photo: {bool(photo_data)})")
            return {
                'success': True,
                'actorId': result.get('_id') or result.get('actorId'),
                'hasPhoto': bool(photo_data)
            }
        else:
            print(f"[sync_to_platform] Failed: {response.status_code} - {response.text[:200]}")
            return {'success': False, 'error': response.text[:200]}
            
    except Exception as e:
        print(f"[sync_to_platform] Error: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@employees_bp.route('', methods=['GET'])
@require_company_access
def list_employees():
    """
    List employees - respects data residency:
    - 'platform' mode: Fetch from platform
    - 'app' mode: Fetch from local VMS database
    """
    company_id = request.args.get('companyId') or request.company_id
    print(f"[API/employees] GET /employees?companyId={company_id}")
    
    data_provider = get_data_provider(company_id)
    employees = data_provider.get_employees(company_id)
    
    print(f"[API/employees] Got {len(employees)} employees")
    return jsonify(convert_objectids(employees))


@employees_bp.route('/<employee_id>', methods=['GET'])
@require_company_access
def get_employee(employee_id):
    """Get single employee by ID"""
    company_id = request.args.get('companyId') or request.company_id
    
    data_provider = get_data_provider(company_id)
    employee = data_provider.get_employee_by_id(employee_id, company_id)
    
    if not employee:
        return jsonify({'error': 'Employee not found'}), 404
    
    return jsonify(convert_objectids(employee))


@employees_bp.route('', methods=['POST'])
@require_company_access
def create_employee():
    """
    Create employee with data residency support:
    - If 'platform' mode: Create in platform, cache locally
    - If 'app' mode: Create locally, sync to platform for federation
    """
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    # Validate required fields
    if not data.get('employeeName'):
        return jsonify({'error': 'employeeName is required'}), 400
    
    residency_mode = get_residency_mode(company_id)
    print(f"[API/employees] Creating employee, residency={residency_mode}")
    
    # Build employee document
    employee = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
        'employeeName': data.get('employeeName'),
        'email': data.get('email'),
        'phone': data.get('phone'),
        'department': data.get('department'),
        'designation': data.get('designation'),
        'employeeId': data.get('employeeId') or data.get('code'),
        'status': 'active',
        'blacklisted': False,
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow(),
        'sourceApp': 'vms_app_v1'
    }
    
    # Always store locally for fast access
    employees_collection.insert_one(employee)
    print(f"[API/employees] Created local employee: {employee['_id']}")
    
    # If platform mode, also sync to platform
    if residency_mode == 'platform':
        sync_success = sync_employee_to_platform(employee, company_id)
        if not sync_success:
            print("[API/employees] Warning: Platform sync failed, but local copy created")
    
    # Publish event for cross-app integration
    try:
        from app.services.integration_helper import integration_client
        integration_client.publish_event('employee.registered', {
            'employeeId': str(employee['_id']),
            'name': employee.get('employeeName'),
            'companyId': str(company_id),
            'department': employee.get('department'),
            'sourceApp': 'vms_app_v1'
        })
    except Exception as e:
        print(f"Failed to publish employee.registered event: {e}")
    
    return jsonify({
        '_id': str(employee['_id']),
        'employeeName': employee['employeeName'],
        'message': 'Employee created',
        'residencyMode': residency_mode,
        'syncedToPlatform': residency_mode == 'platform'
    }), 201


@employees_bp.route('/register', methods=['POST'])
@require_company_access
def register_employee():
    """
    Register employee with face images - matches faceRecognitionServer format.
    
    Accepts multipart/form-data with:
    - companyId (required)
    - employeeId (required) - unique employee code
    - employeeName (required)
    - employeeEmail (optional)
    - employeeMobile (optional)
    - employeeDesignation (optional)
    - department (optional)
    - front/side OR left/right/center - face images
    """
    try:
        # Validate required fields
        required_fields = ['companyId', 'employeeId', 'employeeName']
        valid, msg = validate_required_fields(request.form, required_fields)
        if not valid:
            return error_response(msg, 400)
        
        data = {field: request.form[field] for field in required_fields}
        
        # Optional fields
        optional_fields = [
            'employeeEmail', 'employeeMobile', 'employeeDesignation',
            'department', 'gender', 'joiningDate', 'employeeReportingId',
            'status', 'designation'
        ]
        data.update({k: request.form[k] for k in optional_fields if k in request.form})
        
        company_id = data['companyId']
        
        # Validate email if provided
        if data.get('employeeEmail'):
            if not validate_email_format(data['employeeEmail']):
                return error_response('Invalid email format.', 400)
        
        # Validate phone if provided
        if data.get('employeeMobile'):
            if not validate_phone_format(data['employeeMobile']):
                return error_response('Invalid phone number format.', 400)
        
        # Check for duplicate employeeId
        existing = employees_collection.find_one({
            'employeeId': data['employeeId'],
            'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id
        })
        if existing:
            return error_response(f"Employee with ID {data['employeeId']} already exists.", 409)
        
        # Process face images (support both naming conventions)
        face_positions_v1 = ['front', 'side']  # faceRecognitionServer format
        face_positions_v2 = ['left', 'right', 'center']  # VMS visitor format
        
        has_images = (
            any(pos in request.files and request.files[pos] for pos in face_positions_v1) or
            any(pos in request.files and request.files[pos] for pos in face_positions_v2)
        )
        
        image_dict = {}
        if has_images:
            for position in face_positions_v1 + face_positions_v2:
                if position in request.files:
                    face_image = request.files[position]
                    if face_image.filename:
                        image_id = employee_image_fs.put(
                            face_image.stream,
                            filename=f"{company_id}_{data['employeeId']}_{position}.jpg",
                            metadata={
                                'companyId': company_id,
                                'employeeId': data['employeeId'],
                                'type': f'face_{position}',
                                'timestamp': get_current_utc()
                            }
                        )
                        image_dict[position] = image_id
        
        # Build employee document
        employee = {
            '_id': ObjectId(),
            'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
            'employeeId': data['employeeId'],
            'employeeName': data['employeeName'],
            'email': data.get('employeeEmail'),
            'phone': data.get('employeeMobile'),
            'department': data.get('department'),
            'designation': data.get('employeeDesignation') or data.get('designation'),
            'gender': data.get('gender'),
            'joiningDate': data.get('joiningDate'),
            'employeeReportingId': data.get('employeeReportingId'),
            'status': data.get('status', 'active'),
            'blacklisted': False,
            'employeeImages': image_dict,
            'employeeEmbeddings': {},
            'createdAt': get_current_utc(),
            'updatedAt': get_current_utc(),
            'sourceApp': 'vms_app_v1'
        }
        
        # Insert employee
        employees_collection.insert_one(employee)
        employee_id = employee['_id']
        
        # Queue embedding jobs if images provided
        embeddings_dict = {}
        if has_images:
            for model in Config.ALLOWED_MODELS:
                job = {
                    'employeeId': employee_id,
                    'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
                    'model': model,
                    'status': 'queued',
                    'createdAt': get_current_utc(),
                    'params': {}
                }
                embedding_jobs_collection.insert_one(job)
                embeddings_dict[model] = {'status': 'queued', 'queuedAt': get_current_utc()}
            
            employees_collection.update_one(
                {'_id': employee_id},
                {'$set': {'employeeEmbeddings': embeddings_dict}}
            )
        
        # Handle pre-computed embedding upload
        embedding_attached = request.form.get('embeddingAttached', 'false').lower() == 'true'
        embedding_version = request.form.get('embeddingVersion')
        if embedding_attached and 'embedding' in request.files:
            if embedding_version and embedding_version in Config.ALLOWED_MODELS:
                embedding_file = request.files['embedding']
                try:
                    file_content = embedding_file.read()
                    emb_id = employee_embedding_fs.put(
                        file_content,
                        filename=f"{company_id}_{data['employeeId']}_{embedding_version}.npy",
                        metadata={
                            'companyId': company_id,
                            'employeeId': str(employee_id),
                            'model': embedding_version,
                            'type': 'embedding',
                            'timestamp': get_current_utc()
                        }
                    )
                    
                    emb_entry = {
                        'embeddingId': str(emb_id),
                        'model': embedding_version,
                        'status': 'done',
                        'finishedAt': get_current_utc()
                    }
                    embeddings_dict[embedding_version] = emb_entry
                    
                    employees_collection.update_one(
                        {'_id': employee_id},
                        {'$set': {f'employeeEmbeddings.{embedding_version}': emb_entry}}
                    )
                except Exception as e:
                    print(f"Error storing embedding: {e}")
        
        # Sync to platform as employee actor (always sync when images present)
        residency_mode = get_residency_mode(company_id)
        platform_sync_result = None
        if has_images or residency_mode == 'platform':
            # Sync with images so platform embedding worker can process
            platform_sync_result = sync_employee_to_platform(employee, company_id, include_images=has_images)
            print(f"[register_employee] Platform sync result: {platform_sync_result}")
        
        # Publish event
        integration_client.publish_event('employee.registered', {
            'employeeId': str(employee_id),
            'employeeCode': data['employeeId'],
            'name': data['employeeName'],
            'companyId': str(company_id),
            'department': data.get('department'),
            'hasBiometric': has_images,
            'sourceApp': 'vms_app_v1'
        })
        
        return jsonify({
            'message': 'Employee registration successful',
            '_id': str(employee_id),
            'employeeId': data['employeeId'],
            'employeeName': data['employeeName'],
            'embeddingStatus': {k: v.get('status', 'unknown') for k, v in embeddings_dict.items()},
            'hasBiometric': has_images,
            'residencyMode': residency_mode,
            'platformSync': {
                'synced': platform_sync_result.get('success', False) if platform_sync_result else False,
                'actorId': platform_sync_result.get('actorId') if platform_sync_result else None,
                'hasPhoto': platform_sync_result.get('hasPhoto', False) if platform_sync_result else False
            } if platform_sync_result else None
        }), 201
        
    except Exception as e:
        print(f"Error in register_employee: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@employees_bp.route('/<employee_id>', methods=['PUT', 'PATCH'])
@require_company_access
def update_employee(employee_id):
    """Update employee with data residency support"""
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    # Find existing employee
    try:
        query = {'_id': ObjectId(employee_id)}
    except InvalidId:
        query = {'employeeId': employee_id}
    
    employee = employees_collection.find_one(query)
    if not employee:
        return jsonify({'error': 'Employee not found'}), 404
    
    # Build update
    update_fields = {}
    allowed_fields = ['employeeName', 'email', 'phone', 'department', 'designation', 'employeeId', 'status']
    
    for field in allowed_fields:
        if field in data:
            update_fields[field] = data[field]
    
    if not update_fields:
        return jsonify({'error': 'No fields to update'}), 400
    
    update_fields['updatedAt'] = datetime.utcnow()
    
    employees_collection.update_one(query, {'$set': update_fields})
    
    # Sync to platform if in platform mode
    residency_mode = get_residency_mode(company_id)
    if residency_mode == 'platform':
        updated = employees_collection.find_one(query)
        sync_employee_to_platform(updated, company_id)
    
    return jsonify({
        '_id': str(employee['_id']),
        'message': 'Employee updated',
        'residencyMode': residency_mode
    })


@employees_bp.route('/<employee_id>', methods=['DELETE'])
@require_company_access
def delete_employee(employee_id):
    """Soft delete employee"""
    company_id = request.args.get('companyId') or request.company_id
    
    try:
        query = {'_id': ObjectId(employee_id)}
    except InvalidId:
        query = {'employeeId': employee_id}
    
    result = employees_collection.update_one(
        query,
        {'$set': {'status': 'deleted', 'deletedAt': datetime.utcnow()}}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Employee not found'}), 404
    
    return jsonify({'message': 'Employee deleted'})


@employees_bp.route('/<employee_id>/blacklist', methods=['POST'])
@require_company_access
def blacklist_employee(employee_id):
    """Blacklist an employee"""
    data = request.json or {}
    reason = data.get('reason', 'No reason provided')
    
    try:
        query = {'_id': ObjectId(employee_id)}
    except InvalidId:
        query = {'employeeId': employee_id}
    
    result = employees_collection.update_one(
        query,
        {'$set': {
            'blacklisted': True,
            'blacklistReason': reason,
            'blacklistedAt': datetime.utcnow()
        }}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Employee not found'}), 404
    
    return jsonify({'message': 'Employee blacklisted'})


@employees_bp.route('/<employee_id>/unblacklist', methods=['POST'])
@require_company_access
def unblacklist_employee(employee_id):
    """Remove employee from blacklist"""
    try:
        query = {'_id': ObjectId(employee_id)}
    except InvalidId:
        query = {'employeeId': employee_id}
    
    result = employees_collection.update_one(
        query,
        {'$set': {
            'blacklisted': False,
            'blacklistReason': None
        }}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Employee not found'}), 404
    
    return jsonify({'message': 'Employee unblacklisted'})


@employees_bp.route('/sync-from-platform', methods=['POST'])
@require_company_access
def sync_from_platform():
    """
    Manually sync employees from platform to local VMS database.
    Useful for offline capability or initial setup.
    """
    company_id = request.json.get('companyId') or request.company_id
    
    data_provider = get_data_provider(company_id)
    
    # Force fetch from platform
    from app.services.platform_client import platform_client
    platform_employees = platform_client.get_actors_by_type(company_id, 'employee')
    
    synced = 0
    for emp in platform_employees:
        # Upsert to local DB
        employees_collection.update_one(
            {'$or': [
                {'_id': ObjectId(emp['_id'])} if ObjectId.is_valid(emp.get('_id', '')) else {'employeeId': emp.get('employeeId')},
                {'employeeId': emp.get('employeeId')}
            ]},
            {'$set': {
                'employeeName': emp.get('employeeName') or emp.get('name'),
                'email': emp.get('email'),
                'phone': emp.get('phone'),
                'department': emp.get('department'),
                'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
                'status': 'active',
                'syncedFromPlatform': True,
                'lastSyncAt': datetime.utcnow()
            }},
            upsert=True
        )
        synced += 1
    
    return jsonify({
        'message': f'Synced {synced} employees from platform',
        'count': synced
    })
