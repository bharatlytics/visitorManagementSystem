"""
API Keys Management API

Manage API keys for programmatic access:
- Create/revoke API keys
- Scope-based permissions
- Usage tracking
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timezone

from app.db import get_db
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc
from app.services.rate_limiter import create_api_key, revoke_api_key, rate_limiter

api_keys_bp = Blueprint('api_keys', __name__)


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


# Available scopes
API_SCOPES = [
    'read:visitors',
    'write:visitors',
    'read:visits',
    'write:visits',
    'read:employees',
    'write:employees',
    'read:analytics',
    'read:audit',
    'admin',
    '*'  # Full access
]


@api_keys_bp.route('/scopes', methods=['GET'])
@require_company_access
def list_available_scopes():
    """List available API key scopes"""
    return jsonify({
        'scopes': API_SCOPES,
        'description': {
            'read:visitors': 'Read visitor data',
            'write:visitors': 'Create/update/delete visitors',
            'read:visits': 'Read visit data',
            'write:visits': 'Create/update visits, check-in/out',
            'read:employees': 'Read employee data',
            'write:employees': 'Create/update employees',
            'read:analytics': 'Access analytics endpoints',
            'read:audit': 'Access audit logs',
            'admin': 'Full administrative access',
            '*': 'Full access to all endpoints'
        }
    }), 200


@api_keys_bp.route('/', methods=['GET'])
@require_company_access
def list_api_keys():
    """List all API keys for a company"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        api_keys = db['api_keys']
        
        keys = list(api_keys.find({'companyId': company_id}))
        
        # Remove sensitive data
        for key in keys:
            key.pop('keyHash', None)
        
        return jsonify({
            'apiKeys': convert_objectids(keys),
            'count': len(keys)
        }), 200
        
    except Exception as e:
        print(f"Error listing API keys: {e}")
        return jsonify({'error': str(e)}), 500


@api_keys_bp.route('/', methods=['POST'])
@require_company_access
def create_key():
    """
    Create a new API key.
    
    Request Body:
        companyId (required): Company ObjectId
        name (required): Friendly name for the key
        scopes (optional): Array of scopes (default: ['*'])
        rateLimitOverride (optional): Custom rate limits
    
    Returns:
        - keyId: API key ID
        - rawKey: The actual API key (ONLY SHOWN ONCE)
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400
        
        # Validate scopes
        scopes = data.get('scopes', ['*'])
        invalid_scopes = [s for s in scopes if s not in API_SCOPES]
        if invalid_scopes:
            return jsonify({'error': f'Invalid scopes: {invalid_scopes}'}), 400
        
        key_doc = create_api_key(
            company_id=company_id,
            name=data['name'],
            scopes=scopes,
            rate_limit_override=data.get('rateLimitOverride'),
            created_by=getattr(request, 'user_id', 'system')
        )
        
        return jsonify({
            'message': 'API key created',
            'keyId': str(key_doc['_id']),
            'name': key_doc['name'],
            'keyPrefix': key_doc['keyPrefix'],
            'rawKey': key_doc['rawKey'],
            'scopes': key_doc['scopes'],
            'warning': 'Store this key securely. It will NOT be shown again.'
        }), 201
        
    except Exception as e:
        print(f"Error creating API key: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@api_keys_bp.route('/<key_id>', methods=['GET'])
@require_company_access
def get_api_key(key_id):
    """Get API key details (not the key itself)"""
    try:
        db = get_db()
        api_keys = db['api_keys']
        
        key = api_keys.find_one({'_id': ObjectId(key_id)})
        if not key:
            return jsonify({'error': 'API key not found'}), 404
        
        key.pop('keyHash', None)
        
        return jsonify(convert_objectids(key)), 200
        
    except Exception as e:
        print(f"Error getting API key: {e}")
        return jsonify({'error': str(e)}), 500


@api_keys_bp.route('/<key_id>/revoke', methods=['POST'])
@require_company_access
def revoke_key(key_id):
    """Revoke an API key"""
    try:
        success = revoke_api_key(key_id)
        
        if not success:
            return jsonify({'error': 'API key not found'}), 404
        
        return jsonify({'message': 'API key revoked'}), 200
        
    except Exception as e:
        print(f"Error revoking API key: {e}")
        return jsonify({'error': str(e)}), 500


@api_keys_bp.route('/<key_id>/usage', methods=['GET'])
@require_company_access
def get_key_usage(key_id):
    """Get usage statistics for an API key"""
    try:
        db = get_db()
        api_keys = db['api_keys']
        
        key = api_keys.find_one({'_id': ObjectId(key_id)})
        if not key:
            return jsonify({'error': 'API key not found'}), 404
        
        # Get rate limit usage
        identifier = f"key:{key['keyPrefix'].replace('...', '')}"
        usage = rate_limiter.get_usage(identifier)
        
        return jsonify({
            'keyId': key_id,
            'name': key.get('name'),
            'usageCount': key.get('usageCount', 0),
            'lastUsed': key.get('lastUsed'),
            'currentRateLimits': usage
        }), 200
        
    except Exception as e:
        print(f"Error getting key usage: {e}")
        return jsonify({'error': str(e)}), 500
