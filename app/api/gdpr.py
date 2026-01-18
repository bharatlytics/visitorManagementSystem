"""
GDPR Compliance API

Endpoints for GDPR and privacy compliance:
- Data export (right to access)
- Data deletion (right to be forgotten)
- Consent management
"""
from flask import Blueprint, request, jsonify, Response
from bson import ObjectId
from datetime import datetime, timezone
import json
import io

from app.db import get_db, visitor_collection, visit_collection, visitor_image_fs, visitor_embedding_fs
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc
from app.services.audit_logger import log_data_export, log_data_purge

gdpr_bp = Blueprint('gdpr', __name__)


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


@gdpr_bp.route('/export/<visitor_id>', methods=['GET'])
@require_company_access
def export_visitor_data(visitor_id):
    """
    Export all data for a visitor (GDPR right to access).
    
    Path Parameters:
        visitor_id: Visitor ObjectId
    
    Query Parameters:
        format (optional): json or csv (default: json)
        includeVisits (optional): Include visit history (default: true)
        includeImages (optional): Include images as base64 (default: false)
    
    Returns:
        Complete visitor data export
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        export_format = request.args.get('format', 'json')
        include_visits = request.args.get('includeVisits', 'true').lower() == 'true'
        include_images = request.args.get('includeImages', 'false').lower() == 'true'
        
        # Get visitor
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return jsonify({'error': 'Visitor not found'}), 404
        
        export_data = {
            'exportedAt': get_current_utc().isoformat(),
            'exportType': 'GDPR_DATA_ACCESS',
            'visitor': convert_objectids(visitor)
        }
        
        # Get visits
        if include_visits:
            visits = list(visit_collection.find({'visitorId': ObjectId(visitor_id)}))
            export_data['visits'] = convert_objectids(visits)
            export_data['visitCount'] = len(visits)
        
        # Get images
        if include_images and visitor.get('visitorImages'):
            images = {}
            for position, image_id in visitor.get('visitorImages', {}).items():
                if image_id:
                    try:
                        import base64
                        file_data = visitor_image_fs.get(ObjectId(image_id))
                        image_bytes = file_data.read()
                        images[position] = base64.b64encode(image_bytes).decode('utf-8')
                    except:
                        pass
            export_data['images'] = images
        
        # Get audit trail
        db = get_db()
        audit_logs = list(db['audit_logs'].find({
            'entityType': 'visitor',
            'entityId': visitor_id
        }).sort('timestamp', 1))
        export_data['auditTrail'] = convert_objectids(audit_logs)
        
        # Log the export
        log_data_export(
            export_type='data_access',
            entity_type='visitor',
            entity_id=visitor_id,
            company_id=company_id,
            user_id=getattr(request, 'user_id', None)
        )
        
        if export_format == 'json':
            return Response(
                json.dumps(export_data, indent=2),
                mimetype='application/json',
                headers={'Content-Disposition': f'attachment; filename=visitor_export_{visitor_id}.json'}
            )
        else:
            # Simple text format for non-JSON
            return jsonify(export_data), 200
        
    except Exception as e:
        print(f"Error exporting visitor data: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@gdpr_bp.route('/deletion-request', methods=['POST'])
@require_company_access
def create_deletion_request():
    """
    Create a data deletion request (GDPR right to be forgotten).
    
    Request Body:
        companyId (required): Company ObjectId
        visitorId (required): Visitor to delete
        reason (required): Reason for deletion request
        requestedBy (optional): Who is requesting
        email (optional): Email for confirmation
    
    Returns:
        Deletion request ID and status
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        visitor_id = data.get('visitorId')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        if not visitor_id:
            return jsonify({'error': 'Visitor ID is required'}), 400
        
        if not data.get('reason'):
            return jsonify({'error': 'Reason is required'}), 400
        
        # Verify visitor exists
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return jsonify({'error': 'Visitor not found'}), 404
        
        db = get_db()
        deletion_requests = db['gdpr_deletion_requests']
        
        # Check for existing pending request
        existing = deletion_requests.find_one({
            'visitorId': ObjectId(visitor_id),
            'status': 'pending'
        })
        
        if existing:
            return jsonify({
                'error': 'Deletion request already pending',
                'requestId': str(existing['_id'])
            }), 409
        
        request_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'visitorId': ObjectId(visitor_id),
            'visitorName': visitor.get('visitorName'),
            'visitorEmail': visitor.get('email'),
            'visitorPhone': visitor.get('phone'),
            'reason': data['reason'],
            'requestedBy': data.get('requestedBy') or getattr(request, 'user_id', 'visitor'),
            'contactEmail': data.get('email'),
            'status': 'pending',  # pending, approved, completed, rejected
            'createdAt': get_current_utc(),
            'processedAt': None,
            'processedBy': None
        }
        
        deletion_requests.insert_one(request_doc)
        
        return jsonify({
            'message': 'Deletion request created',
            'requestId': str(request_doc['_id']),
            'status': 'pending',
            'note': 'Request will be processed within 30 days as per GDPR requirements'
        }), 201
        
    except Exception as e:
        print(f"Error creating deletion request: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@gdpr_bp.route('/purge/<visitor_id>', methods=['DELETE'])
@require_company_access
def purge_visitor_data(visitor_id):
    """
    Permanently delete all visitor data (GDPR right to be forgotten).
    
    This action is IRREVERSIBLE. It will:
    1. Delete visitor record
    2. Delete all visit records
    3. Delete all images
    4. Delete all embeddings
    5. Anonymize audit logs
    
    Request Body:
        confirmation (required): Must be "PERMANENTLY DELETE"
        reason (required): Reason for purge
    """
    try:
        data = request.json or {}
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if data.get('confirmation') != 'PERMANENTLY DELETE':
            return jsonify({'error': 'Confirmation text must be "PERMANENTLY DELETE"'}), 400
        
        if not data.get('reason'):
            return jsonify({'error': 'Reason is required'}), 400
        
        # Get visitor before deletion
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
        if not visitor:
            return jsonify({'error': 'Visitor not found'}), 404
        
        deleted_items = {
            'visitor': False,
            'visits': 0,
            'images': 0,
            'embeddings': 0,
            'auditLogs': 0
        }
        
        # Delete images
        if visitor.get('visitorImages'):
            for position, image_id in visitor['visitorImages'].items():
                if image_id:
                    try:
                        visitor_image_fs.delete(ObjectId(image_id))
                        deleted_items['images'] += 1
                    except:
                        pass
        
        # Delete embeddings
        if visitor.get('visitorEmbeddings'):
            for model, emb_data in visitor['visitorEmbeddings'].items():
                if isinstance(emb_data, dict) and emb_data.get('fileId'):
                    try:
                        visitor_embedding_fs.delete(ObjectId(emb_data['fileId']))
                        deleted_items['embeddings'] += 1
                    except:
                        pass
        
        # Delete visits
        visit_result = visit_collection.delete_many({'visitorId': ObjectId(visitor_id)})
        deleted_items['visits'] = visit_result.deleted_count
        
        # Anonymize audit logs (keep structure for compliance but remove PII)
        db = get_db()
        db['audit_logs'].update_many(
            {'entityType': 'visitor', 'entityId': visitor_id},
            {
                '$set': {
                    'anonymized': True,
                    'anonymizedAt': get_current_utc(),
                    'details.visitorName': '[REDACTED]',
                    'details.phone': '[REDACTED]',
                    'details.email': '[REDACTED]'
                },
                '$unset': {
                    'before': '',
                    'after': ''
                }
            }
        )
        
        # Delete visitor record
        visitor_collection.delete_one({'_id': ObjectId(visitor_id)})
        deleted_items['visitor'] = True
        
        # Update deletion request if exists
        db['gdpr_deletion_requests'].update_one(
            {'visitorId': ObjectId(visitor_id), 'status': 'pending'},
            {
                '$set': {
                    'status': 'completed',
                    'processedAt': get_current_utc(),
                    'processedBy': getattr(request, 'user_id', 'system')
                }
            }
        )
        
        # Log the purge
        log_data_purge(
            entity_type='visitor',
            entity_id=visitor_id,
            company_id=company_id,
            user_id=getattr(request, 'user_id', None),
            reason=data['reason']
        )
        
        return jsonify({
            'message': 'Visitor data permanently deleted',
            'visitorId': visitor_id,
            'deletedItems': deleted_items
        }), 200
        
    except Exception as e:
        print(f"Error purging visitor data: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@gdpr_bp.route('/deletion-requests', methods=['GET'])
@require_company_access
def list_deletion_requests():
    """
    List all deletion requests for a company.
    
    Query Parameters:
        companyId (required): Company ObjectId
        status (optional): Filter by status (pending, approved, completed, rejected)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        status = request.args.get('status')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        deletion_requests = db['gdpr_deletion_requests']
        
        query = {'companyId': company_id}
        if status:
            query['status'] = status
        
        requests_list = list(deletion_requests.find(query).sort('createdAt', -1))
        
        return jsonify({
            'requests': convert_objectids(requests_list),
            'count': len(requests_list)
        }), 200
        
    except Exception as e:
        print(f"Error listing deletion requests: {e}")
        return jsonify({'error': str(e)}), 500


@gdpr_bp.route('/consent', methods=['POST'])
@require_company_access
def record_consent():
    """
    Record visitor consent for data processing.
    
    Request Body:
        visitorId (required): Visitor ObjectId
        consentType (required): Type of consent (data_processing, marketing, biometric)
        granted (required): Whether consent was granted (true/false)
        method (optional): How consent was obtained (written, digital, verbal)
    """
    try:
        data = request.json or {}
        visitor_id = data.get('visitorId')
        consent_type = data.get('consentType')
        granted = data.get('granted')
        
        if not visitor_id:
            return jsonify({'error': 'Visitor ID is required'}), 400
        
        if not consent_type:
            return jsonify({'error': 'Consent type is required'}), 400
        
        if granted is None:
            return jsonify({'error': 'Granted status is required'}), 400
        
        # Update visitor with consent record
        consent_record = {
            'type': consent_type,
            'granted': granted,
            'method': data.get('method', 'digital'),
            'recordedAt': get_current_utc(),
            'ipAddress': request.headers.get('X-Forwarded-For', request.remote_addr)
        }
        
        visitor_collection.update_one(
            {'_id': ObjectId(visitor_id)},
            {
                '$push': {'consents': consent_record},
                '$set': {f'consent.{consent_type}': granted}
            }
        )
        
        return jsonify({
            'message': 'Consent recorded',
            'visitorId': visitor_id,
            'consentType': consent_type,
            'granted': granted
        }), 200
        
    except Exception as e:
        print(f"Error recording consent: {e}")
        return jsonify({'error': str(e)}), 500


@gdpr_bp.route('/retention/run', methods=['POST'])
@require_company_access
def run_retention_cleanup():
    """
    Run data retention cleanup.
    
    Deletes data older than configured retention periods.
    Should be run periodically via scheduler.
    """
    try:
        company_id = request.json.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Get retention settings from company settings
        db = get_db()
        settings = db['settings'].find_one({'companyId': company_id})
        
        # Default retention periods (in days)
        retention = {
            'checkedOutVisits': settings.get('retentionDays', {}).get('visits', 365),
            'deletedVisitors': settings.get('retentionDays', {}).get('deletedVisitors', 90),
            'auditLogs': settings.get('retentionDays', {}).get('auditLogs', 1095)  # 3 years
        }
        
        from datetime import timedelta
        now = get_current_utc()
        deleted_counts = {}
        
        # Delete old checked-out visits
        cutoff = now - timedelta(days=retention['checkedOutVisits'])
        result = visit_collection.delete_many({
            'companyId': company_id,
            'status': 'checked_out',
            'actualDeparture': {'$lt': cutoff}
        })
        deleted_counts['visits'] = result.deleted_count
        
        # Delete visitors marked as deleted
        cutoff = now - timedelta(days=retention['deletedVisitors'])
        result = visitor_collection.delete_many({
            'companyId': company_id,
            'status': 'deleted',
            'lastUpdated': {'$lt': cutoff}
        })
        deleted_counts['visitors'] = result.deleted_count
        
        return jsonify({
            'message': 'Retention cleanup completed',
            'deleted': deleted_counts,
            'retentionDays': retention
        }), 200
        
    except Exception as e:
        print(f"Error running retention cleanup: {e}")
        return jsonify({'error': str(e)}), 500
