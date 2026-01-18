"""
Visitors API - Full VMS functionality
Handles visitor registration, listing, updates, visits, and images
"""
from flask import Blueprint, request, jsonify, Response
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timedelta, timezone
import qrcode
import io
import functools

from app.db import (
    visitor_collection, visitor_image_fs, visitor_embedding_fs, 
    visit_collection, embedding_jobs_collection, employee_collection
)
from app.models import build_visitor_doc, build_visit_doc
from app.utils import (
    validate_required_fields, error_response, validate_email_format,
    validate_phone_format, parse_datetime, format_datetime, get_current_utc
)
from app.config import Config
from app.auth import require_auth, require_company_access
from app.services.integration_helper import integration_client
import requests
import base64

visitor_bp = Blueprint('visitor', __name__)


def sync_visitor_to_platform(visitor_data, company_id, include_images=True):
    """
    Sync visitor to platform actors collection with images.
    Platform's actor_embedding_worker will auto-generate embeddings.
    """
    from flask import session
    
    try:
        platform_token = session.get('platform_token')
        
        # Build attributes
        attributes = {
            'name': visitor_data.get('visitorName'),
            'visitorName': visitor_data.get('visitorName'),
            'email': visitor_data.get('email'),
            'phone': visitor_data.get('phone'),
            'organization': visitor_data.get('organization'),
            'visitorType': visitor_data.get('visitorType', 'guest'),
        }
        
        # Include image as base64
        photo_data = None
        if include_images and visitor_data.get('visitorImages'):
            images = visitor_data.get('visitorImages', {})
            for position in ['center', 'front', 'left', 'right']:
                if position in images and images[position]:
                    try:
                        image_id = images[position]
                        if not isinstance(image_id, ObjectId):
                            image_id = ObjectId(image_id)
                        
                        file_data = visitor_image_fs.get(image_id)
                        image_bytes = file_data.read()
                        photo_data = base64.b64encode(image_bytes).decode('utf-8')
                        print(f"[sync_visitor] Included {position} image ({len(image_bytes)} bytes)")
                        break
                    except Exception as e:
                        print(f"[sync_visitor] Error reading {position} image: {e}")
                        continue
        
        if photo_data:
            attributes['photo'] = f"data:image/jpeg;base64,{photo_data}"
        
        actor_data = {
            'companyId': str(company_id),
            'actorType': 'visitor',
            'attributes': attributes,
            'sourceAppId': 'vms_app_v1',
            'sourceActorId': str(visitor_data.get('_id')),
            'status': 'active',
            'metadata': {
                'hasPhoto': bool(photo_data),
                'sourceApp': 'vms_app_v1'
            }
        }
        
        if not platform_token:
            print("[sync_visitor] No platform token")
            return {'success': False, 'error': 'No platform token'}
        
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
            timeout=30
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            print(f"[sync_visitor] Synced: {visitor_data.get('visitorName')} (photo: {bool(photo_data)})")
            return {
                'success': True,
                'actorId': result.get('_id') or result.get('actorId'),
                'hasPhoto': bool(photo_data)
            }
        else:
            print(f"[sync_visitor] Failed: {response.status_code}")
            return {'success': False, 'error': response.text[:200]}
            
    except Exception as e:
        print(f"[sync_visitor] Error: {e}")
        return {'success': False, 'error': str(e)}


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
    else:
        return obj


@visitor_bp.route('/', methods=['GET'])
@require_company_access
def list_visitors():
    """List all visitors for a company"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required.', 400)

        # Query with both string and ObjectId to handle inconsistent data
        try:
            company_oid = ObjectId(company_id)
            # Match either ObjectId or string version of companyId
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            # If not valid ObjectId, just use string
            query = {'companyId': company_id}
        
        print(f"[Visitors] Querying with: {query}")  # Debug
        visitors = list(visitor_collection.find(query))
        print(f"[Visitors] Found {len(visitors)} visitors")  # Debug
        
        # Convert all ObjectIds recursively
        visitors = convert_objectids(visitors)
        
        # Add downloadUrl to embeddings
        from app.utils import format_embedding_response
        base_url = request.url_root.rstrip('/')
        
        for visitor in visitors:
            if 'visitorEmbeddings' in visitor and visitor['visitorEmbeddings']:
                # Format embeddings with download URLs
                visitor['visitorEmbeddings'] = format_embedding_response(
                    visitor['visitorEmbeddings'],
                    'visitor',
                    base_url
                )

        return jsonify({'visitors': visitors}), 200
    except Exception as e:
        print(f"Error listing visitors: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/<visitor_id>', methods=['GET'])
@require_company_access
def get_visitor(visitor_id):
    """Get a single visitor by ID"""
    try:
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return error_response('Visitor not found', 404)
        
        # Convert ObjectIds
        visitor = convert_objectids(visitor)
        
        # Add downloadUrl to embeddings
        from app.utils import format_embedding_response
        base_url = request.url_root.rstrip('/')
        
        if 'visitorEmbeddings' in visitor and visitor['visitorEmbeddings']:
            visitor['visitorEmbeddings'] = format_embedding_response(
                visitor['visitorEmbeddings'],
                'visitor',
                base_url
            )
        
        return jsonify({'visitor': visitor}), 200
    except InvalidId:
        return error_response('Invalid visitor ID format', 400)
    except Exception as e:
        print(f"Error getting visitor: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/visits', methods=['GET'])
@require_company_access
def list_visits():
    """List all visits for a company"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required.', 400)

        # Support both ObjectId and string companyId in database
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except InvalidId:
            company_match = {'companyId': company_id}
        
        query = company_match.copy()
        
        visitor_id = request.args.get('visitorId')
        if visitor_id:
            query['visitorId'] = ObjectId(visitor_id)

        visits = list(visit_collection.find(query).sort('expectedArrival', -1))
        
        # Convert ObjectIds to strings and dates to ISO format
        for visit in visits:
            for key, value in list(visit.items()):
                if isinstance(value, ObjectId):
                    visit[key] = str(value)
                elif isinstance(value, list):
                    visit[key] = [str(v) if isinstance(v, ObjectId) else v for v in value]
                elif isinstance(value, dict):
                    for nested_key, nested_value in list(value.items()):
                        if isinstance(nested_value, ObjectId):
                            value[nested_key] = str(nested_value)
            
            # Convert dates to ISO format
            for date_field in ['expectedArrival', 'expectedDeparture', 'actualArrival', 'actualDeparture', 'createdAt', 'lastUpdated']:
                if date_field in visit and visit[date_field]:
                    try:
                        visit[date_field] = format_datetime(visit[date_field])
                    except:
                        pass

        return jsonify({'visits': visits}), 200
    except Exception as e:
        print(f"Error listing visits: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/images/<image_id>', methods=['GET'])
def serve_visitor_image(image_id):
    """Serve a visitor image from GridFS"""
    try:
        import bson
        file = visitor_image_fs.get(bson.ObjectId(image_id))
        return Response(file.read(), mimetype='image/jpeg', headers={
            'Content-Disposition': f'inline; filename={image_id}.jpg'
        })
    except Exception as e:
        print(f"Error serving visitor image {image_id}: {e}")
        return error_response('Image not found', 404)


@visitor_bp.route('/visits/qr/<visit_id>', methods=['GET'])
def serve_visit_qr(visit_id):
    """Generate and serve QR code for a visit"""
    try:
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(visit_id)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        img_io = io.BytesIO()
        img.save(img_io, 'PNG')
        img_io.seek(0)
        
        return Response(img_io.getvalue(), mimetype='image/png', headers={
            'Content-Disposition': f'inline; filename=visit_{visit_id}.png'
        })
    except Exception as e:
        print(f"Error generating QR code for visit {visit_id}: {e}")
        return error_response('Failed to generate QR code', 500)


@visitor_bp.route('/register', methods=['POST'])
@require_company_access
def register_visitor():
    """Register a new visitor"""
    try:
        required_fields = ['companyId', 'visitorName', 'phone', 'hostEmployeeId']
        valid, msg = validate_required_fields(request.form, required_fields)
        if not valid:
            return error_response(msg, 400)

        data = {field: request.form[field] for field in required_fields}
        optional_fields = [
            'visitorType', 'idType', 'idNumber', 'email',
            'organization', 'purpose', 'status', 'blacklisted', 'blacklistReason'
        ]
        data.update({k: request.form[k] for k in optional_fields if k in request.form})
        
        # Verify host employee exists and is active
        # Use DataProvider to respect residency mode (check VMS or Platform)
        from app.services import get_data_provider
        
        host_employee = None
        company_id = data['companyId']
        host_id = data['hostEmployeeId']
        
        # First try DataProvider (residency-aware)
        data_provider = get_data_provider(company_id)
        host_employee = data_provider.get_employee_by_id(host_id, company_id)
        
        # If not found via DataProvider, try local DB as fallback
        if not host_employee:
            try:
                host_employee = employee_collection.find_one({
                    '_id': ObjectId(host_id),
                    'companyId': ObjectId(company_id),
                    'status': 'active',
                    'blacklisted': False
                })
            except (InvalidId, TypeError):
                host_employee = employee_collection.find_one({
                    'employeeId': host_id,
                    'companyId': ObjectId(company_id),
                    'status': 'active',
                    'blacklisted': False
                })
        
        # Check if employee is active and not blacklisted
        if host_employee:
            if host_employee.get('status') != 'active' or host_employee.get('blacklisted', False):
                return error_response('Host employee is not active or is blacklisted.', 400)
        else:
            return error_response('Host employee not found or not active.', 400)
        
        # Email/phone validation
        if data.get('email'):
            if not validate_email_format(data['email']):
                return error_response('Invalid email format.', 400)
        if not validate_phone_format(data['phone']):
            return error_response('Invalid phone number format.', 400)
        
        # Check if images are provided (optional for pre-registration)
        required_face_positions = ['left', 'right', 'center']
        has_images = any(pos in request.files and request.files[pos] for pos in required_face_positions)
        
        # Process visitor face images only if provided
        image_dict = {}
        document_dict = {}
        if has_images:
            for position in required_face_positions:
                if position in request.files:
                    face_image = request.files[position]
                    face_image_id = visitor_image_fs.put(
                        face_image.stream,
                        filename=f"{data['companyId']}_{position}_face.jpg",
                        metadata={
                            'companyId': data['companyId'],
                            'type': f'face_image_{position}',
                            'timestamp': get_current_utc()
                        }
                    )
                    image_dict[position] = face_image_id
        
        # Process ID documents if provided
        id_documents = ['pan_card', 'aadhar_card', 'driving_license', 'passport']
        for doc_type in id_documents:
            if doc_type in request.files:
                doc_file = request.files[doc_type]
                doc_id = visitor_image_fs.put(
                    doc_file.stream,
                    filename=f"{data['companyId']}_{doc_type}.jpg",
                    metadata={
                        'companyId': data['companyId'],
                        'type': f'{doc_type}_image',
                        'timestamp': get_current_utc()
                    }
                )
                document_dict[doc_type] = doc_id
        
        # Check for existing visitor with same phone in this company
        company_id = data['companyId']
        existing_visitor = visitor_collection.find_one({
            'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
            'phone': data['phone']
        })
        
        if existing_visitor:
            # Return existing visitor info instead of creating duplicate
            return jsonify({
                'message': 'Visitor already registered with this phone number',
                '_id': str(existing_visitor['_id']),
                'visitorId': str(existing_visitor['_id']),
                'visitorName': existing_visitor.get('visitorName'),
                'existing': True
            }), 200
        
        # Build and insert visitor document
        visitor_doc = build_visitor_doc(data, image_dict, {}, document_dict)
        
        try:
            result = visitor_collection.insert_one(visitor_doc)
            visitor_id = result.inserted_id
        except Exception as insert_error:
            # Handle duplicate key error (race condition)
            if 'duplicate key' in str(insert_error).lower():
                existing = visitor_collection.find_one({
                    'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
                    'phone': data['phone']
                })
                if existing:
                    return jsonify({
                        'message': 'Visitor already registered with this phone number',
                        '_id': str(existing['_id']),
                        'visitorId': str(existing['_id']),
                        'existing': True
                    }), 200
            raise insert_error
        
        if not visitor_id:
            return error_response('Failed to register visitor.', 500)
        
        # Enqueue embedding job only for buffalo_l (VMS worker model)
        embeddings_dict = {}
        if has_images:
            # Set buffalo_l status to queued - VMS worker will pick this up
            embeddings_dict['buffalo_l'] = {
                'status': 'queued',
                'queuedAt': get_current_utc()
            }
            # Also create a job in embedding_jobs collection for tracking
            job = {
                "companyId": ObjectId(data['companyId']),
                "visitorId": visitor_id,
                "model": "buffalo_l",
                "status": "queued",
                "createdAt": get_current_utc(),
                "params": {}
            }
            embedding_jobs_collection.insert_one(job)
        
        # Handle embedding file upload if present
        embedding_attached = request.form.get('embeddingAttached', 'false').lower() == 'true'
        embedding_version = request.form.get('embeddingVersion')
        if embedding_attached:
            if not embedding_version or 'embedding' not in request.files:
                return error_response('embeddingVersion and embedding file required when embeddingAttached is true')
            if embedding_version not in Config.ALLOWED_MODELS:
                return error_response('Embedding model not allowed.', 400)
            
            embedding_file = request.files['embedding']
            try:
                file_content = embedding_file.read()
                embedding_filename = embedding_file.filename
                
                # Store embedding in GridFS
                emb_id = visitor_embedding_fs.put(
                    file_content,
                    filename=embedding_filename,
                    metadata={
                        'companyId': data['companyId'],
                        'visitorId': str(visitor_id),
                        'model': embedding_version,
                        'type': 'embedding',
                        'timestamp': get_current_utc()
                    }
                )
                
                # Build download URL using VMS base URL
                base_url = request.url_root.rstrip('/')
                download_url = f"{base_url}/api/visitors/embeddings/{emb_id}"
                
                emb_entry = {
                    'embeddingId': emb_id,  # Keep as ObjectId (matches buffalo_l worker format)
                    'downloadUrl': download_url,  # Direct download URL for mobile clients
                    'model': embedding_version,
                    'dimensions': None,  # Unknown for uploaded embeddings
                    'createdAt': get_current_utc(),
                    'updatedAt': get_current_utc(),
                    'status': 'done',
                    'finishedAt': get_current_utc(),
                    'corrupt': False
                }
                embeddings_dict[embedding_version] = emb_entry
                
                visitor_collection.update_one(
                    {'_id': visitor_id},
                    {'$set': {f'visitorEmbeddings.{embedding_version}': emb_entry}}
                )
            except Exception as e:
                visitor_collection.update_one(
                    {'_id': visitor_id},
                    {'$set': {'status': 'incomplete', 'lastUpdated': get_current_utc()}}
                )
                return error_response(f'Error storing embedding: {e}', 400)
        
        # Update visitor document with embeddings_dict
        visitor_collection.update_one({'_id': visitor_id}, {'$set': {'visitorEmbeddings': embeddings_dict}})
        
        # NOTE: Visitors stay in VMS (residency: app) - no platform sync
        # Other apps access visitor data via federated query: /api/query/visitors
        
        # Publish Event: visitor.registered
        integration_client.publish_event('visitor.registered', {
            'visitorId': str(visitor_id),
            'name': data['visitorName'],
            'companyId': data['companyId'],
            'visitorType': data.get('visitorType', 'general')
        })

        return jsonify({
            'message': 'Visitor registration successful',
            '_id': str(visitor_id),
            'embeddingStatus': {k: v.get('status', 'unknown') for k, v in embeddings_dict.items()},
            'hasBiometric': has_images,
            'dataResidency': 'app',  # Visitor stays in VMS
            'federatedAccess': '/api/query/visitors'  # Other apps query via this
        }), 201
    except Exception as e:
        print(f"Error in register_visitor: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/update', methods=['PATCH'])
@require_company_access
def update_visitor():
    """Update visitor details"""
    try:
        data = request.form.to_dict()
        visitor_id = data.get('visitorId')
        
        if not visitor_id:
            return error_response('Visitor ID is required', 400)
            
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return error_response('Visitor not found', 404)
            
        update_fields = {}
        allowed_fields = [
            'visitorName', 'email', 'phone', 'organization', 
            'idType', 'idNumber', 'purpose', 'status'
        ]
        
        for field in allowed_fields:
            if field in data:
                update_fields[field] = data[field]
                
        # Validate email/phone if provided
        if 'email' in update_fields and update_fields['email']:
            if not validate_email_format(update_fields['email']):
                return error_response('Invalid email format', 400)
                
        if 'phone' in update_fields and update_fields['phone']:
            if not validate_phone_format(update_fields['phone']):
                return error_response('Invalid phone format', 400)
                
        if not update_fields:
            return error_response('No fields to update', 400)
            
        update_fields['lastUpdated'] = get_current_utc()
        
        visitor_collection.update_one(
            {'_id': ObjectId(visitor_id)},
            {'$set': update_fields}
        )
        
        return jsonify({'message': 'Visitor updated successfully'}), 200
        
    except Exception as e:
        print(f"Error updating visitor: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/blacklist', methods=['POST'])
@require_company_access
def blacklist_visitor():
    """Blacklist a visitor"""
    try:
        data = request.json
        visitor_id = data.get('visitorId')
        reason = data.get('reason', 'No reason provided')
        
        if not visitor_id:
            return error_response('Visitor ID is required', 400)
            
        result = visitor_collection.update_one(
            {'_id': ObjectId(visitor_id)},
            {
                '$set': {
                    'blacklisted': True,
                    'blacklistReason': reason,
                    'lastUpdated': get_current_utc()
                }
            }
        )
        
        if result.matched_count == 0:
            return error_response('Visitor not found', 404)
            
        return jsonify({'message': 'Visitor blacklisted successfully'}), 200
    except Exception as e:
        print(f"Error blacklisting visitor: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/unblacklist', methods=['POST'])
@require_company_access
def unblacklist_visitor():
    """Remove visitor from blacklist"""
    try:
        data = request.json
        visitor_id = data.get('visitorId')
        
        if not visitor_id:
            return error_response('Visitor ID is required', 400)
            
        result = visitor_collection.update_one(
            {'_id': ObjectId(visitor_id)},
            {
                '$set': {
                    'blacklisted': False,
                    'blacklistReason': '',
                    'lastUpdated': get_current_utc()
                }
            }
        )
        
        if result.matched_count == 0:
            return error_response('Visitor not found', 404)
            
        return jsonify({'message': 'Visitor unblacklisted successfully'}), 200
    except Exception as e:
        print(f"Error unblacklisting visitor: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/delete', methods=['DELETE'])
@require_company_access
def delete_visitor():
    """
    Soft delete a visitor.
    Sets status to 'deleted' rather than removing from database.
    Also cancels any scheduled visits for this visitor.
    """
    try:
        data = request.json or {}
        visitor_id = data.get('visitorId')
        
        if not visitor_id:
            return error_response('Visitor ID is required', 400)
        
        # Find the visitor
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return error_response('Visitor not found', 404)
        
        # Soft delete - set status to deleted
        result = visitor_collection.update_one(
            {'_id': ObjectId(visitor_id)},
            {
                '$set': {
                    'status': 'deleted',
                    'deletedAt': get_current_utc(),
                    'lastUpdated': get_current_utc()
                }
            }
        )
        
        if result.matched_count == 0:
            return error_response('Visitor not found', 404)
        
        # Cancel any scheduled visits for this visitor
        visit_collection.update_many(
            {
                'visitorId': ObjectId(visitor_id),
                'status': 'scheduled'
            },
            {
                '$set': {
                    'status': 'cancelled',
                    'cancelReason': 'Visitor deleted',
                    'lastUpdated': get_current_utc()
                }
            }
        )
        
        # Publish Event: visitor.deleted
        integration_client.publish_event('visitor.deleted', {
            'visitorId': visitor_id,
            'companyId': str(visitor.get('companyId')),
            'deletedAt': get_current_utc().isoformat()
        })
        
        return jsonify({'message': 'Visitor deleted successfully'}), 200
        
    except Exception as e:
        print(f"Error deleting visitor: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


def has_overlapping_visit(visitor_id, new_start, new_end):
    """Check if visitor has an overlapping visit"""
    overlap = visit_collection.find_one({
        "visitorId": ObjectId(visitor_id),
        "status": {"$in": ["scheduled", "checked_in"]},
        "$or": [
            {"expectedArrival": {"$lt": new_end}, "expectedDeparture": {"$gt": new_start}}
        ]
    })
    return overlap is not None


@visitor_bp.route('/<visitorId>/schedule-visit', methods=['POST'])
@require_company_access
def schedule_visit(visitorId):
    """Schedule a visit for a visitor"""
    if not request.is_json:
        return error_response("Request must be application/json", 415)
    
    data = request.get_json()
    try:
        required_fields = ['companyId', 'hostEmployeeId', 'expectedArrival']
        valid, msg = validate_required_fields(data, required_fields)
        if not valid:
            return error_response(msg, 400)
            
        # Parse dates to UTC
        arrival = parse_datetime(data['expectedArrival'])
        new_end = parse_datetime(data.get('expectedDeparture', data['expectedArrival']))
        
        if has_overlapping_visit(visitorId, arrival, new_end):
            return error_response('Visitor already has an overlapping visit.', 409)
            
        # Support group visits
        visitor_ids = data.get('visitorIds', [visitorId])
        visitor_obj_ids = [ObjectId(v) for v in visitor_ids]
        company_obj_id = ObjectId(data['companyId'])
        
        # Fetch host employee details using DataProvider (residency-aware)
        from app.services import get_data_provider
        
        company_id = data['companyId']
        host_id = data['hostEmployeeId']
        
        data_provider = get_data_provider(company_id)
        host_employee = data_provider.get_employee_by_id(host_id, company_id)
        
        # Fallback to local DB if not found
        if not host_employee:
            try:
                host_obj_id = ObjectId(host_id)
                host_employee = employee_collection.find_one({'_id': host_obj_id})
            except (InvalidId, TypeError):
                host_employee = employee_collection.find_one({'employeeId': host_id})
        
        if not host_employee:
            return error_response('Host employee not found.', 404)
        
        # Get ObjectId for host employee (needed for visit document)
        host_obj_id = ObjectId(host_employee.get('_id'))
        
        # Fetch visitor details (for primary visitor)
        primary_visitor_id = visitor_obj_ids[0]
        visitor = visitor_collection.find_one({'_id': primary_visitor_id})
        if not visitor:
            return error_response('Visitor not found.', 404)
        
        # Check if visitor is blacklisted
        if visitor.get('blacklisted'):
            reason = visitor.get('blacklistReason', 'No reason provided')
            return error_response(f'Visitor is blacklisted. Reason: {reason}', 403)
        
        # Determine approval
        approved = bool(data.get('approved'))
        
        # Validate enterprise fields
        vehicle_number = data.get('vehicleNumber')
        number_of_persons = data.get('numberOfPersons', 1)
        belongings = data.get('belongings', [])
        
        if not isinstance(number_of_persons, int) or number_of_persons < 1:
            return error_response('numberOfPersons must be a positive integer.', 400)
        
        if not isinstance(belongings, list):
            return error_response('belongings must be an array.', 400)
        
        # Validate Access Areas (Zones) - simplified without EntityService
        access_areas = data.get('accessAreas', [])
        validated_access_areas = []
        for area_id in access_areas:
            if ObjectId.is_valid(area_id):
                validated_access_areas.append(ObjectId(area_id))
        
        # Create visit document
        visit_doc = build_visit_doc(
            visitor_obj_ids[0] if len(visitor_obj_ids) == 1 else visitor_obj_ids,
            company_obj_id,
            host_obj_id,
            data.get('purpose', ''),
            arrival,
            new_end,
            approved=approved,
            hostEmployeeName=host_employee.get('employeeName'),
            hostEmployeeCode=host_employee.get('employeeId'),
            visitorName=visitor.get('visitorName'),
            visitorMobile=visitor.get('phone'),
            vehicleNumber=vehicle_number,
            numberOfPersons=number_of_persons,
            belongings=belongings
        )
        visit_doc['accessAreas'] = validated_access_areas
        visit_doc['visitType'] = data.get('visitType', 'single')
        
        # Add detailed fields
        visit_doc['assets'] = data.get('assets', {})
        visit_doc['facilities'] = data.get('facilities', {})
        visit_doc['vehicle'] = data.get('vehicle', {})
        visit_doc['compliance'] = data.get('compliance', {})
        visit_doc['notes'] = data.get('notes', '')
        
        result = visit_collection.insert_one(visit_doc)
        visit_id = result.inserted_id
        
        # Update each visitor's visits list
        for vid in visitor_obj_ids:
            visitor_collection.update_one(
                {'_id': vid},
                {'$push': {'visits': str(visit_id)}}
            )
            
        # Prepare response with all ObjectIds as strings
        visit_doc = visit_collection.find_one({'_id': visit_id})
        visit_dict = {}
        for key, value in visit_doc.items():
            if isinstance(value, ObjectId):
                visit_dict[key] = str(value)
            elif isinstance(value, list) and all(isinstance(item, ObjectId) for item in value):
                visit_dict[key] = [str(item) for item in value]
            elif isinstance(value, datetime):
                visit_dict[key] = format_datetime(value)
            else:
                visit_dict[key] = value
        
        # Add qrCode field (same as visit _id) and qrCodeUrl
        visit_dict['qrCode'] = visit_dict['_id']
        visit_dict['qrCodeUrl'] = f"/api/visitors/visits/qr/{visit_dict['_id']}"
        
        # Send Notifications
        try:
            from app.services.notification_service import NotificationService
            NotificationService.notify_visit_scheduled(visit_dict, visitor, host_employee)
        except Exception as e:
            print(f"Error sending notifications: {e}")
            
        # Publish Event: visit.scheduled
        integration_client.publish_event('visit.scheduled', {
            'visitId': str(visit_id),
            'visitorId': str(primary_visitor_id),
            'hostId': str(host_obj_id),
            'expectedArrival': arrival.isoformat(),
            'companyId': data['companyId']
        })
                
        return jsonify({
            'message': 'Visit scheduled successfully',
            'visit': visit_dict
        }), 201
        
    except Exception as e:
        print(f"Error in schedule_visit: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/visits/<visitId>/check-in', methods=['POST'])
@require_company_access
def check_in(visitId):
    """Check in a visitor"""
    try:
        visit_id = visitId
        data = request.json or {}
        
        if 'checkInMethod' not in data:
            return error_response('Check-in method is required.', 400)

        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return error_response('Visit not found.', 404)

        if visit['status'] != 'scheduled':
            return error_response('Visit is not in scheduled state.', 400)

        # Update visit status
        visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {
                '$set': {
                    'status': 'checked_in',
                    'checkInMethod': data['checkInMethod'],
                    'actualArrival': get_current_utc(),
                    'lastUpdated': get_current_utc()
                }
            }
        )

        # Send Notifications
        try:
            from app.services.notification_service import NotificationService
            visitor = visitor_collection.find_one({'_id': visit['visitorId']})
            host = employee_collection.find_one({'_id': visit['hostEmployeeId']})
            if visitor and host:
                NotificationService.notify_check_in(visit, visitor, host)
        except Exception as e:
            print(f"Error sending check-in notifications: {e}")

        # Publish Event: visit.checked_in
        integration_client.publish_event('visit.checked_in', {
            'visitId': str(visit_id),
            'visitorId': str(visit['visitorId']),
            'checkInTime': get_current_utc().isoformat(),
            'locationId': str(visit.get('accessAreas', ['default'])[0]) if visit.get('accessAreas') else 'default'
        })

        # Report Metrics
        try:
            # 1. Active Visitors (Count of visits with status='checked_in')
            active_count = visit_collection.count_documents({
                'companyId': visit['companyId'],
                'status': 'checked_in'
            })
            integration_client.report_metric('active_visitors', active_count, 'count', {'location': 'default'})

            # 2. Visits Today (Count of visits created today)
            start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            visits_today = visit_collection.count_documents({
                'companyId': visit['companyId'],
                'actualArrival': {'$gte': start_of_day}
            })
            integration_client.report_metric('visits_today', visits_today, 'count', {'location': 'default'})
        except Exception as e:
            print(f"Error reporting metrics: {e}")

        return jsonify({
            'message': 'Check-in successful',
            'visitId': visit_id
        }), 200

    except Exception as e:
        print(f"Error in check_in: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/visits/<visitId>/check-out', methods=['POST'])
@require_company_access
def check_out(visitId):
    """Check out a visitor"""
    try:
        visit_id = visitId
        data = request.json or {}
        
        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return error_response('Visit not found.', 404)

        if visit['status'] != 'checked_in':
            return error_response('Visit is not checked in.', 400)

        # Update visit status
        visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {
                '$set': {
                    'status': 'checked_out',
                    'actualDeparture': get_current_utc(),
                    'lastUpdated': get_current_utc()
                }
            }
        )

        # Publish Event: visit.checked_out
        integration_client.publish_event('visit.checked_out', {
            'visitId': str(visit_id),
            'visitorId': str(visit['visitorId']),
            'checkOutTime': get_current_utc().isoformat()
        })

        # Report Metrics
        try:
            # 1. Active Visitors (Decrement)
            active_count = visit_collection.count_documents({
                'companyId': visit['companyId'],
                'status': 'checked_in'
            })
            integration_client.report_metric('active_visitors', active_count, 'count', {'location': 'default'})

            # 2. Avg Visit Duration
            # Calculate duration for this visit
            arrival = visit.get('actualArrival') or visit.get('createdAt')
            if arrival:
                # Ensure arrival is datetime
                if isinstance(arrival, str):
                    arrival = parse_datetime(arrival)
                
                duration_mins = (get_current_utc() - arrival).total_seconds() / 60
                
                integration_client.report_metric('avg_visit_duration', duration_mins, 'minutes', {'visitor_type': 'general'})
        except Exception as e:
            print(f"Error reporting checkout metrics: {e}")

        return jsonify({
            'message': 'Check-out successful',
            'visitId': visit_id
        }), 200

    except Exception as e:
        print(f"Error in check_out: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/embeddings/<embedding_id>', methods=['GET'])
def serve_visitor_embedding(embedding_id):
    """
    Download visitor embedding file.
    
    Behavior depends on data residency:
    - residency=app: Serve from VMS GridFS (default for visitors)
    - residency=platform: Proxy to Platform API
    """
    try:
        from flask import session
        
        # Get companyId from query params OR from authenticated user's token (optional)
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        # Default: serve from VMS GridFS (visitors always stored locally)
        # Only check residency if companyId is provided
        residency_mode = 'app'
        if company_id:
            try:
                from app.services import get_data_provider
                data_provider = get_data_provider(company_id)
                config = data_provider._get_residency_config('visitor')
                residency_mode = config.get('mode', 'app')
            except Exception as e:
                print(f"[serve_visitor_embedding] Error getting residency config: {e}")
                residency_mode = 'app'  # Default to app
        
        print(f"[serve_visitor_embedding] embedding_id={embedding_id}, residency={residency_mode}")
        
        if residency_mode == 'platform':
            # PROXY to Platform
            # Try to get platform token from session (browser) or generate one (API/mobile)
            platform_token = session.get('platform_token')
            
            if not platform_token:
                # For API/mobile access, generate a platform token
                # The user is already authenticated (passed @require_auth)
                import jwt
                from datetime import datetime, timedelta
                
                platform_secret = Config.PLATFORM_JWT_SECRET or Config.JWT_SECRET
                payload = {
                    'sub': 'vms_app_v1',
                    'companyId': company_id,
                    'iss': 'vms',
                    'exp': datetime.utcnow() + timedelta(minutes=5)
                }
                platform_token = jwt.encode(payload, platform_secret, algorithm='HS256')
                print(f"[serve_visitor_embedding] Generated platform token for API access")
            
            # Fetch from platform
            platform_url = f"{Config.PLATFORM_API_URL}/bharatlytics/v1/actors/embeddings/{embedding_id}"
            headers = {'Authorization': f'Bearer {platform_token}'}
            
            print(f"[serve_visitor_embedding] Proxying to platform: {platform_url}")
            response = requests.get(platform_url, headers=headers, stream=True, timeout=30)
            
            if response.status_code != 200:
                print(f"[serve_visitor_embedding] Platform returned {response.status_code}: {response.text[:200]}")
                return jsonify({'error': 'Embedding not found on platform'}), 404
            
            # Stream the response back to client
            return Response(
                response.iter_content(chunk_size=8192),
                mimetype='application/octet-stream',
                headers={
                    'Content-Disposition': response.headers.get('Content-Disposition', f'attachment; filename={embedding_id}.npy'),
                    'Content-Type': 'application/octet-stream'
                }
            )
        else:
            # SERVE from VMS GridFS (default for visitors)
            print(f"[serve_visitor_embedding] Serving from VMS GridFS")
            file = visitor_embedding_fs.get(ObjectId(embedding_id))
            filename = file.filename if hasattr(file, 'filename') else f"{embedding_id}.npy"
            
            return Response(
                file.read(),
                mimetype='application/octet-stream',
                headers={
                    'Content-Disposition': f'attachment; filename={filename}',
                    'Content-Type': 'application/octet-stream'
                }
            )
    except Exception as e:
        print(f"[serve_visitor_embedding] Error serving embedding {embedding_id}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Embedding not found'}), 404


# Alias blueprint name for compatibility
visitors_bp = visitor_bp
