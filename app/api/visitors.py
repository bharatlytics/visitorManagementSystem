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
from app.auth import require_auth

visitor_bp = Blueprint('visitor', __name__)


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
@require_auth
def list_visitors():
    """List all visitors for a company"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required.', 400)

        visitors = list(visitor_collection.find({'companyId': ObjectId(company_id)}))
        
        # Convert all ObjectIds recursively
        visitors = convert_objectids(visitors)

        return jsonify({'visitors': visitors}), 200
    except Exception as e:
        print(f"Error listing visitors: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/visits', methods=['GET'])
@require_auth
def list_visits():
    """List all visits for a company"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required.', 400)

        query = {'companyId': ObjectId(company_id)}
        
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
@require_auth
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
        host_employee = None
        try:
            host_employee = employee_collection.find_one({
                '_id': ObjectId(data['hostEmployeeId']),
                'companyId': ObjectId(data['companyId']),
                'status': 'active',
                'blacklisted': False
            })
        except (InvalidId, TypeError):
            host_employee = employee_collection.find_one({
                'employeeId': data['hostEmployeeId'],
                'companyId': ObjectId(data['companyId']),
                'status': 'active',
                'blacklisted': False
            })
        
        if not host_employee:
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
                if position not in request.files:
                    return error_response(f'Visitor face image for {position} position is required.', 400)
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
        
        # Build and insert visitor document
        visitor_doc = build_visitor_doc(data, image_dict, {}, document_dict)
        result = visitor_collection.insert_one(visitor_doc)
        visitor_id = result.inserted_id
        
        if not visitor_id:
            return error_response('Failed to register visitor.', 500)
        
        # Enqueue embedding jobs only if images provided
        embeddings_dict = {}
        if has_images:
            for model in Config.ALLOWED_MODELS:
                job = {
                    "employeeId": ObjectId(host_employee['_id']),
                    "companyId": ObjectId(data['companyId']),
                    "visitorId": visitor_id,
                    "model": model,
                    "status": "queued",
                    "createdAt": get_current_utc(),
                    "params": {}
                }
                embedding_jobs_collection.insert_one(job)
                embeddings_dict[model] = {'status': 'queued', 'queuedAt': get_current_utc()}
        
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
                
                emb_entry = {
                    'embeddingId': str(emb_id),
                    'model': embedding_version,
                    'status': 'done',
                    'finishedAt': get_current_utc()
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
        
        return jsonify({
            'message': 'Visitor registration successful',
            '_id': str(visitor_id),
            'embeddingStatus': {k: v.get('status', 'unknown') for k, v in embeddings_dict.items()}
        }), 201
    except Exception as e:
        print(f"Error in register_visitor: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@visitor_bp.route('/update', methods=['PATCH'])
@require_auth
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
@require_auth
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
@require_auth
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
@require_auth
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
        host_obj_id = ObjectId(data['hostEmployeeId'])
        
        # Fetch host employee details
        host_employee = employee_collection.find_one({'_id': host_obj_id})
        if not host_employee:
            return error_response('Host employee not found.', 404)
        
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
@require_auth
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

        return jsonify({
            'message': 'Check-in successful',
            'visitId': visit_id
        }), 200

    except Exception as e:
        print(f"Error in check_in: {e}")
        return error_response(str(e), 500)


@visitor_bp.route('/visits/<visitId>/check-out', methods=['POST'])
@require_auth
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

        return jsonify({
            'message': 'Check-out successful',
            'visitId': visit_id
        }), 200

    except Exception as e:
        print(f"Error in check_out: {e}")
        return error_response(str(e), 500)


# Alias blueprint name for compatibility
visitors_bp = visitor_bp
