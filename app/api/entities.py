"""
Enterprise Entities API

Supports fetching entities (locations, zones, buildings) from platform.
Per manifest, VMS requires 'location' entity for assigning visits to zones.

Features:
- Fetch locations from platform (federated)
- Cache locally for offline access
- Support for gates, reception areas, zones
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime

from app.auth import require_auth
from app.services import get_data_provider
from app.db import entities_collection

entities_bp = Blueprint('entities', __name__)


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


@entities_bp.route('', methods=['GET'])
@require_auth
def list_entities():
    """
    List entities - fetches from platform when connected.
    
    Query params:
    - companyId: Company ID
    - type: Filter by entity type (location, gate, zone, etc.)
    """
    company_id = request.args.get('companyId') or request.company_id
    entity_type = request.args.get('type')
    app_id = request.args.get('appId')  # Get appId from query params
    print(f"[API/entities] GET /entities?companyId={company_id}&type={entity_type}&appId={app_id}")
    
    # Don't use hardcoded type mapping - let data_provider handle it based on manifest
    data_provider = get_data_provider(company_id)
    print(f"[API/entities] data_provider.is_connected = {data_provider.is_connected}")
    
    # Pass None for types to let data_provider use manifest mapping
    entities = data_provider.get_entities(company_id, types=None)
    print(f"[API/entities] Got {len(entities)} entities")
    
    return jsonify(convert_objectids(entities))


@entities_bp.route('/locations', methods=['GET'])
@require_auth
def list_locations():
    """
    List locations - specifically for VMS visit scheduling.
    Maps platform entities to VMS location format.
    """
    company_id = request.args.get('companyId') or request.company_id
    
    data_provider = get_data_provider(company_id)
    
    # Get location-type entities from platform
    entities = data_provider.get_entities(company_id, ['location', 'plant', 'office', 'building'])
    
    # Also get local entities
    local_entities = list(entities_collection.find({
        'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
        'type': {'$in': ['location', 'gate', 'zone', 'reception']}
    }))
    
    # Merge and deduplicate
    all_locations = []
    seen_ids = set()
    
    for ent in entities:
        ent_id = str(ent.get('_id', ''))
        if ent_id not in seen_ids:
            all_locations.append({
                '_id': ent_id,
                'name': ent.get('name', 'Unknown Location'),
                'type': ent.get('type', 'location'),
                'source': 'platform'
            })
            seen_ids.add(ent_id)
    
    for ent in local_entities:
        ent_id = str(ent.get('_id', ''))
        if ent_id not in seen_ids:
            all_locations.append({
                '_id': ent_id,
                'name': ent.get('name', 'Unknown Location'),
                'type': ent.get('type', 'location'),
                'source': 'vms'
            })
            seen_ids.add(ent_id)
    
    return jsonify({
        'locations': all_locations,
        'count': len(all_locations)
    })


@entities_bp.route('/<entity_id>', methods=['GET'])
@require_auth
def get_entity(entity_id):
    """Get single entity by ID"""
    company_id = request.args.get('companyId') or request.company_id
    
    # Check local first
    try:
        local = entities_collection.find_one({'_id': ObjectId(entity_id)})
        if local:
            return jsonify(convert_objectids(local))
    except InvalidId:
        pass
    
    # Check platform
    data_provider = get_data_provider(company_id)
    entities = data_provider.get_entities(company_id)
    
    for ent in entities:
        if str(ent.get('_id')) == entity_id:
            return jsonify(convert_objectids(ent))
    
    return jsonify({'error': 'Entity not found'}), 404


@entities_bp.route('', methods=['POST'])
@require_auth
def create_entity():
    """
    Create local entity (gate, reception, zone).
    For VMS-specific locations that don't come from platform.
    """
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    if not data.get('name'):
        return jsonify({'error': 'name is required'}), 400
    
    entity = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
        'name': data.get('name'),
        'type': data.get('type', 'gate'),
        'metadata': data.get('metadata', {}),
        'status': 'active',
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow(),
        'sourceApp': 'vms_app_v1'
    }
    
    entities_collection.insert_one(entity)
    
    return jsonify({
        '_id': str(entity['_id']),
        'name': entity['name'],
        'type': entity['type'],
        'message': 'Entity created'
    }), 201


@entities_bp.route('/sync-from-platform', methods=['POST'])
@require_auth
def sync_from_platform():
    """
    Sync locations from platform to local VMS database.
    Useful for offline capability.
    """
    company_id = request.json.get('companyId') or request.company_id
    
    from app.services.platform_client import platform_client
    platform_entities = platform_client.get_entities(company_id, ['location', 'plant', 'office', 'building'])
    
    synced = 0
    for ent in platform_entities:
        entities_collection.update_one(
            {'_id': ObjectId(ent['_id'])} if ObjectId.is_valid(ent.get('_id', '')) else {'name': ent.get('name')},
            {'$set': {
                'name': ent.get('name'),
                'type': ent.get('type', 'location'),
                'companyId': ObjectId(company_id) if ObjectId.is_valid(company_id) else company_id,
                'syncedFromPlatform': True,
                'platformId': str(ent.get('_id')),
                'lastSyncAt': datetime.utcnow()
            }},
            upsert=True
        )
        synced += 1
    
    return jsonify({
        'message': f'Synced {synced} locations from platform',
        'count': synced
    })

