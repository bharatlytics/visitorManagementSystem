"""
Entities API - Uses DataProvider for dual-mode support
Entry points, zones, etc.
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId

from app.auth import require_auth
from app.services import get_data_provider
from app.db import entities_collection

entities_bp = Blueprint('entities', __name__)


@entities_bp.route('', methods=['GET'])
@require_auth
def list_entities():
    """List entities - from platform or local DB based on mode"""
    company_id = request.args.get('companyId') or request.company_id
    entity_type = request.args.get('type')
    print(f"[API/entities] GET /entities?companyId={company_id}&type={entity_type}")
    
    types = [entity_type] if entity_type else None
    
    data_provider = get_data_provider(company_id)
    print(f"[API/entities] data_provider.is_connected = {data_provider.is_connected}")
    
    entities = data_provider.get_entities(company_id, types)
    print(f"[API/entities] Got {len(entities)} entities")
    
    # Convert ObjectIds to strings
    result = []
    for ent in entities:
        ent_dict = dict(ent) if hasattr(ent, 'items') else ent
        if '_id' in ent_dict and isinstance(ent_dict['_id'], ObjectId):
            ent_dict['_id'] = str(ent_dict['_id'])
        if 'companyId' in ent_dict and isinstance(ent_dict['companyId'], ObjectId):
            ent_dict['companyId'] = str(ent_dict['companyId'])
        result.append(ent_dict)
    
    return jsonify(result)


@entities_bp.route('/<entity_id>', methods=['GET'])
@require_auth
def get_entity(entity_id):
    """Get single entity"""
    company_id = request.args.get('companyId') or request.company_id
    
    data_provider = get_data_provider(company_id)
    entities = data_provider.get_entities(company_id)
    
    for ent in entities:
        if str(ent.get('_id')) == entity_id:
            if '_id' in ent and isinstance(ent['_id'], ObjectId):
                ent['_id'] = str(ent['_id'])
            return jsonify(ent)
    
    return jsonify({'error': 'Entity not found'}), 404


# Standalone mode only - create entities
@entities_bp.route('', methods=['POST'])
@require_auth
def create_entity():
    """Create entity (standalone mode only)"""
    from app.config import Config
    if Config.is_connected_mode():
        return jsonify({'error': 'Cannot create entities in connected mode'}), 400
    
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    entity = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id),
        'name': data.get('name'),
        'type': data.get('type', 'gate'),  # gate, reception, zone, etc.
        'metadata': data.get('metadata', {})
    }
    
    entities_collection.insert_one(entity)
    
    return jsonify({
        'id': str(entity['_id']),
        'message': 'Entity created'
    }), 201
