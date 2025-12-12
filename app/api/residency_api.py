"""
Residency API
Handles Data Residency v3 operations:
- Federated queries from platform (when mode=app)
- Sync triggers (when mode=platform)
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime

from app.db import visitor_collection, db
from app.config import Config
from app.services.integration_helper import integration_client
from app.utils import format_datetime

residency_bp = Blueprint('residency', __name__)


def verify_platform_token(token: str) -> bool:
    """Verify the request is from the platform"""
    # In production, implement proper token verification
    # For now, check if token exists and is non-empty
    if not token:
        return False
    
    # TODO: Implement JWT verification or signature check
    # The platform signs requests with its private key
    return True


@residency_bp.route('/query/visitors', methods=['POST'])
def handle_federated_query():
    """
    Handle federated query from platform.
    
    Platform calls this endpoint when:
    - Residency mode is 'app' (federated)
    - Other apps request visitor data
    
    Request format:
    {
        "filters": {"status": "active"},
        "fields": ["name", "phone", "email"],
        "limit": 100,
        "offset": 0,
        "companyId": "company_123"
    }
    """
    # Verify request is from platform
    platform_token = request.headers.get('X-Platform-Token')
    if not verify_platform_token(platform_token):
        return jsonify({'error': 'Unauthorized - Invalid platform token'}), 401
    
    query_params = request.json or {}
    
    # Extract query parameters
    filters = query_params.get('filters', {})
    fields = query_params.get('fields', [])
    limit = min(query_params.get('limit', 100), 500)  # Cap at 500
    offset = query_params.get('offset', 0)
    company_id = query_params.get('companyId')
    
    if not company_id:
        return jsonify({'error': 'companyId is required'}), 400
    
    # Build MongoDB query
    mongo_query = {}
    
    # Handle companyId (both ObjectId and string)
    try:
        company_oid = ObjectId(company_id)
        mongo_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
    except:
        mongo_query['companyId'] = company_id
    
    # Apply filters
    if filters.get('status'):
        mongo_query['status'] = filters['status']
    if filters.get('blacklisted') is not None:
        mongo_query['blacklisted'] = filters['blacklisted']
    if filters.get('visitorType'):
        mongo_query['visitorType'] = filters['visitorType']
    if filters.get('ids'):
        # Filter by specific IDs
        try:
            mongo_query['_id'] = {'$in': [ObjectId(id) for id in filters['ids']]}
        except:
            pass
    
    # Query database
    cursor = visitor_collection.find(mongo_query).skip(offset).limit(limit)
    total = visitor_collection.count_documents(mongo_query)
    
    # Build response with only requested fields
    result = []
    for visitor in cursor:
        record = {'id': str(visitor['_id'])}
        
        # Map internal fields to standard field names
        field_mapping = {
            'name': 'visitorName',
            'phone': 'phone',
            'email': 'email',
            'photo': 'visitorImages',  # Will need special handling
            'company': 'organization',
            'embedding': 'visitorEmbeddings'
        }
        
        for field in fields:
            internal_field = field_mapping.get(field, field)
            
            # Special handling for embedding field
            if field == 'embedding' and 'visitorEmbeddings' in visitor:
                embeddings = visitor['visitorEmbeddings']
                normalized_embeddings = {}
                
                if isinstance(embeddings, dict):
                    for model, emb_data in embeddings.items():
                        if isinstance(emb_data, dict) and emb_data.get('status') == 'done':
                            normalized_embeddings[model] = {
                                'embeddingId': str(emb_data.get('embeddingId', '')),
                                'status': emb_data.get('status'),
                                'model': model
                            }
                
                if normalized_embeddings:
                    record['embedding'] = normalized_embeddings
                continue
            
            if internal_field in visitor:
                value = visitor[internal_field]
                
                # Handle ObjectId
                if isinstance(value, ObjectId):
                    value = str(value)
                # Handle datetime
                elif isinstance(value, datetime):
                    value = format_datetime(value)
                # Handle dict with ObjectIds
                elif isinstance(value, dict):
                    value = {k: str(v) if isinstance(v, ObjectId) else v 
                             for k, v in value.items()}
                
                record[field] = value
        
        result.append(record)
    
    return jsonify({
        'actors': result,
        'count': len(result),
        'total': total,
        'offset': offset,
        'limit': limit
    })


@residency_bp.route('/sync/visitors', methods=['POST'])
def trigger_sync():
    """
    Trigger visitor data sync to platform.
    
    Called to sync visitor data when residency mode is 'platform'.
    Can be triggered manually or by platform webhook.
    
    Request format:
    {
        "mode": "full" | "incremental",
        "since": "2024-01-01T00:00:00Z"  # For incremental
    }
    """
    data = request.json or {}
    sync_mode = data.get('mode', 'incremental')
    since = data.get('since')
    
    # Get company ID from installation
    installation = db['installations'].find_one()
    if not installation:
        return jsonify({'error': 'No installation found'}), 400
    
    company_id = installation.get('company_id')
    
    # Check residency config
    config = integration_client.get_residency_config('visitor')
    if config['mode'] != 'platform':
        return jsonify({
            'error': 'Sync not required',
            'message': 'Residency mode is not platform',
            'currentMode': config['mode']
        }), 400
    
    # Query visitors to sync
    mongo_query = {}
    try:
        company_oid = ObjectId(company_id)
        mongo_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
    except:
        mongo_query['companyId'] = company_id
    
    if sync_mode == 'incremental' and since:
        try:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            mongo_query['lastUpdated'] = {'$gte': since_dt}
        except:
            pass
    
    visitors = list(visitor_collection.find(mongo_query))
    
    # Prepare batch for sync
    sync_batch = []
    for visitor in visitors:
        sync_data = {
            'type': 'visitor',
            'id': str(visitor['_id']),
            'data': {
                'name': visitor.get('visitorName'),
                'phone': visitor.get('phone'),
                'email': visitor.get('email'),
                'company': visitor.get('organization'),
            },
            'operation': 'upsert'
        }
        
        # Include photo reference if available
        if visitor.get('visitorImages'):
            images = visitor['visitorImages']
            # Use center image as primary
            if images.get('center'):
                sync_data['data']['photo'] = str(images['center'])
        
        # Include embedding if available
        if visitor.get('visitorEmbeddings'):
            embeddings = visitor['visitorEmbeddings']
            # Get first available embedding
            for model, emb_data in embeddings.items():
                if emb_data.get('status') == 'done':
                    sync_data['data']['embedding'] = {
                        'model': model,
                        'id': emb_data.get('embeddingId')
                    }
                    break
        
        sync_batch.append(sync_data)
    
    # Perform batch sync
    if sync_batch:
        result = integration_client.sync_actors_batch(sync_batch)
    else:
        result = {'synced': 0, 'failed': 0}
    
    # Update sync status
    if result.get('failed', 0) == 0:
        integration_client.update_sync_status('actor_visitor', 'synced')
    else:
        integration_client.update_sync_status('actor_visitor', 'stale')
    
    return jsonify({
        'message': 'Sync completed',
        'mode': sync_mode,
        'total': len(visitors),
        'synced': result.get('synced', 0),
        'failed': result.get('failed', 0)
    })


@residency_bp.route('/sync/visitors/<visitor_id>', methods=['POST'])
def sync_single_visitor(visitor_id):
    """
    Sync a single visitor to platform.
    Called after visitor updates when in platform mode.
    """
    # Check residency mode first
    if not integration_client.is_platform_mode('visitor'):
        return jsonify({'message': 'Not in platform mode, skip sync'}), 200
    
    # Get visitor
    try:
        visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
    except:
        return jsonify({'error': 'Invalid visitor ID'}), 400
    
    if not visitor:
        return jsonify({'error': 'Visitor not found'}), 404
    
    # Prepare sync data
    sync_data = {
        'type': 'visitor',
        'id': str(visitor['_id']),
        'data': {
            'name': visitor.get('visitorName'),
            'phone': visitor.get('phone'),
            'email': visitor.get('email'),
            'company': visitor.get('organization'),
        },
        'operation': 'upsert'
    }
    
    # Sync to platform
    success = integration_client.sync_actor(sync_data)
    
    if success:
        return jsonify({'message': 'Visitor synced successfully'})
    else:
        return jsonify({'error': 'Sync failed'}), 500
