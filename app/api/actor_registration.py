"""
Actor Registration API - Manifest-Aware Platform CRUD

This module provides actor registration endpoints in VMS that directly
create/update/delete actors on the Bharatlytics Platform.

Key Features:
- Only syncs actor types declared in manifest
- Only includes fields allowed by manifest
- Handles biometric data (photo, embedding)
- Validates against data contract

Per manifest, VMS can produce:
- visitor: name, phone, email, photo, company, embedding
- employee: name, phone, email, photo, embedding, department, code
"""
from flask import Blueprint, request, jsonify, session
from bson import ObjectId
from datetime import datetime
import requests
import json
import os

from app.auth import require_auth
from app.config import Config

actor_registration_bp = Blueprint('actor_registration', __name__)

# Load manifest to know what we can sync
MANIFEST_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'manifest.json')


def get_manifest():
    """Load VMS manifest"""
    try:
        with open(MANIFEST_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Manifest] Failed to load: {e}")
        return {}


def get_allowed_actor_types():
    """Get actor types VMS can produce (from manifest)"""
    manifest = get_manifest()
    produces = manifest.get('dataExchange', {}).get('produces', {})
    actors = produces.get('actors', [])
    return {a['type']: a.get('fields', []) for a in actors}


def get_allowed_fields(actor_type):
    """Get fields allowed for an actor type per manifest"""
    allowed = get_allowed_actor_types()
    return allowed.get(actor_type, [])


def filter_fields(data, allowed_fields):
    """Filter data to only include manifest-allowed fields"""
    if not allowed_fields:
        return data
    return {k: v for k, v in data.items() if k in allowed_fields or k in ['name', 'status']}


def get_platform_headers():
    """Get headers for platform API calls"""
    platform_token = session.get('platform_token')
    if platform_token:
        return {
            'Authorization': f'Bearer {platform_token}',
            'Content-Type': 'application/json',
            'X-Source-App': 'vms_app_v1'
        }
    return None


def get_company_id():
    """Get current company ID from session"""
    return session.get('company_id') or request.args.get('companyId')


# ============================================
# Manifest Validation Endpoint
# ============================================

@actor_registration_bp.route('/actors/manifest', methods=['GET'])
def get_manifest_info():
    """Return what actor types VMS can sync per manifest"""
    allowed = get_allowed_actor_types()
    return jsonify({
        'appId': 'vms_app_v1',
        'canProduce': list(allowed.keys()),
        'actorFields': allowed,
        'message': 'Only these actor types can be synced to platform'
    })


# ============================================
# Employee Actor CRUD (with biometrics)
# ============================================

@actor_registration_bp.route('/actors/employee', methods=['GET'])
@require_auth
def list_employees():
    """List employees from platform"""
    company_id = get_company_id()
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400
    
    headers = get_platform_headers()
    if not headers:
        return jsonify({
            'actors': [],
            'source': 'standalone',
            'message': 'Connect via platform SSO to fetch employees'
        })
    
    try:
        response = requests.get(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            params={'companyId': company_id, 'actorType': 'employee'},
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            actors = data if isinstance(data, list) else data.get('actors', data)
            return jsonify({
                'actors': actors,
                'count': len(actors) if isinstance(actors, list) else 0,
                'source': 'platform'
            })
        else:
            return jsonify({'error': 'Platform error', 'status': response.status_code}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@actor_registration_bp.route('/actors/employee', methods=['POST'])
@require_auth
def create_employee():
    """
    Register new employee - syncs to platform with biometrics.
    
    Only fields declared in manifest are synced:
    - name, phone, email, photo, embedding, department, code
    """
    # Validate actor type is allowed
    allowed = get_allowed_actor_types()
    if 'employee' not in allowed:
        return jsonify({
            'error': 'Actor type not allowed',
            'message': 'employee is not declared in manifest dataExchange.produces'
        }), 403
    
    company_id = get_company_id()
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400
    
    data = request.json or {}
    
    # Get allowed fields from manifest
    allowed_fields = get_allowed_fields('employee')
    
    headers = get_platform_headers()
    if not headers:
        return jsonify({
            'error': 'Platform connection required',
            'message': 'Login via platform SSO to register employees'
        }), 403
    
    # Build attributes - only manifest-allowed fields
    attributes = {}
    
    # Map incoming data to allowed fields
    field_mapping = {
        'name': ['name', 'employeeName'],
        'email': ['email'],
        'phone': ['phone'],
        'department': ['department'],
        'code': ['code', 'employeeId'],
        'photo': ['photo', 'photoUrl', 'image'],
        'embedding': ['embedding', 'faceEmbedding', 'biometric']
    }
    
    for manifest_field, possible_keys in field_mapping.items():
        if manifest_field in allowed_fields:
            for key in possible_keys:
                if key in data and data[key]:
                    attributes[manifest_field] = data[key]
                    break
    
    # Ensure name is set
    if 'name' not in attributes:
        attributes['name'] = data.get('name') or data.get('employeeName')
    
    if not attributes.get('name'):
        return jsonify({'error': 'name is required'}), 400
    
    # Build actor document for platform
    actor_data = {
        'companyId': company_id,
        'actorType': 'employee',
        'status': 'active',
        'attributes': attributes,
        'sourceAppId': 'vms_app_v1',
        'sourceActorId': data.get('localId') or data.get('employeeId'),
        'createdAt': datetime.utcnow().isoformat(),
        'metadata': {
            'hasBiometric': bool(attributes.get('embedding')),
            'hasPhoto': bool(attributes.get('photo')),
            'syncedFields': list(attributes.keys())
        }
    }
    
    try:
        response = requests.post(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            json=actor_data,
            headers=headers,
            timeout=15
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            return jsonify({
                '_id': result.get('_id') or result.get('actorId'),
                'name': attributes.get('name'),
                'message': 'Employee registered on platform',
                'syncedFields': list(attributes.keys()),
                'hasBiometric': bool(attributes.get('embedding')),
                'source': 'platform'
            }), 201
        else:
            return jsonify({
                'error': 'Platform registration failed',
                'details': response.text[:200]
            }), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================
# Visitor Actor CRUD (with biometrics)
# ============================================

@actor_registration_bp.route('/actors/visitor', methods=['GET'])
@require_auth
def list_visitors():
    """List visitors from platform"""
    company_id = get_company_id()
    headers = get_platform_headers()
    
    if not headers:
        return jsonify({'actors': [], 'source': 'standalone'})
    
    try:
        response = requests.get(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            params={'companyId': company_id, 'actorType': 'visitor'},
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            actors = data if isinstance(data, list) else data.get('actors', data)
            return jsonify({'actors': actors, 'count': len(actors), 'source': 'platform'})
        else:
            return jsonify({'error': 'Platform error'}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@actor_registration_bp.route('/actors/visitor', methods=['POST'])
@require_auth
def create_visitor():
    """
    Register new visitor - syncs to platform with biometrics.
    
    Only fields declared in manifest are synced:
    - name, phone, email, photo, company, embedding
    """
    allowed = get_allowed_actor_types()
    if 'visitor' not in allowed:
        return jsonify({'error': 'Actor type not allowed'}), 403
    
    company_id = get_company_id()
    if not company_id:
        return jsonify({'error': 'companyId required'}), 400
    
    data = request.json or {}
    allowed_fields = get_allowed_fields('visitor')
    headers = get_platform_headers()
    
    if not headers:
        return jsonify({'error': 'Platform connection required'}), 403
    
    # Build attributes
    attributes = {}
    field_mapping = {
        'name': ['name', 'visitorName'],
        'email': ['email'],
        'phone': ['phone'],
        'company': ['company', 'organization', 'fromCompany'],
        'photo': ['photo', 'photoUrl', 'image'],
        'embedding': ['embedding', 'faceEmbedding']
    }
    
    for manifest_field, possible_keys in field_mapping.items():
        if manifest_field in allowed_fields:
            for key in possible_keys:
                if key in data and data[key]:
                    attributes[manifest_field] = data[key]
                    break
    
    if not attributes.get('name'):
        attributes['name'] = data.get('name') or data.get('visitorName')
    
    if not attributes.get('name'):
        return jsonify({'error': 'name is required'}), 400
    
    actor_data = {
        'companyId': company_id,
        'actorType': 'visitor',
        'status': 'active',
        'attributes': attributes,
        'sourceAppId': 'vms_app_v1',
        'sourceActorId': data.get('localId') or str(ObjectId()),
        'metadata': {
            'hasBiometric': bool(attributes.get('embedding')),
            'hasPhoto': bool(attributes.get('photo')),
            'syncedFields': list(attributes.keys())
        }
    }
    
    try:
        response = requests.post(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            json=actor_data,
            headers=headers,
            timeout=15
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            return jsonify({
                '_id': result.get('_id') or result.get('actorId'),
                'name': attributes.get('name'),
                'message': 'Visitor registered on platform',
                'syncedFields': list(attributes.keys()),
                'hasBiometric': bool(attributes.get('embedding'))
            }), 201
        else:
            return jsonify({'error': 'Registration failed'}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================
# Generic Actor CRUD (validates against manifest)
# ============================================

@actor_registration_bp.route('/actors/<actor_type>', methods=['POST'])
@require_auth
def create_actor(actor_type):
    """Create any actor type - validates against manifest"""
    allowed = get_allowed_actor_types()
    
    if actor_type not in allowed:
        return jsonify({
            'error': f'Actor type "{actor_type}" not allowed',
            'allowedTypes': list(allowed.keys()),
            'message': 'Only actor types declared in manifest.dataExchange.produces can be synced'
        }), 403
    
    company_id = get_company_id()
    data = request.json or {}
    headers = get_platform_headers()
    
    if not headers:
        return jsonify({'error': 'Platform connection required'}), 403
    
    # Filter to allowed fields
    allowed_fields = allowed.get(actor_type, [])
    attributes = filter_fields(data.get('attributes', data), allowed_fields)
    
    actor_data = {
        'companyId': company_id,
        'actorType': actor_type,
        'status': 'active',
        'attributes': attributes,
        'sourceAppId': 'vms_app_v1',
        'metadata': {'syncedFields': list(attributes.keys())}
    }
    
    try:
        response = requests.post(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors',
            json=actor_data,
            headers=headers,
            timeout=15
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            return jsonify({
                '_id': result.get('_id'),
                'actorType': actor_type,
                'syncedFields': list(attributes.keys()),
                'message': f'{actor_type} created on platform'
            }), 201
        else:
            return jsonify({'error': 'Creation failed'}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@actor_registration_bp.route('/actors/<actor_type>/<actor_id>', methods=['PATCH'])
@require_auth
def update_actor(actor_type, actor_id):
    """Update actor - validates fields against manifest"""
    allowed = get_allowed_actor_types()
    
    if actor_type not in allowed:
        return jsonify({'error': f'Actor type "{actor_type}" not allowed'}), 403
    
    data = request.json or {}
    headers = get_platform_headers()
    
    if not headers:
        return jsonify({'error': 'Platform connection required'}), 403
    
    # Filter to allowed fields
    allowed_fields = allowed.get(actor_type, [])
    attributes = filter_fields(data.get('attributes', data), allowed_fields)
    
    try:
        response = requests.patch(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors/{actor_id}',
            json={'attributes': attributes},
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            return jsonify({'_id': actor_id, 'message': f'{actor_type} updated'})
        else:
            return jsonify({'error': 'Update failed'}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@actor_registration_bp.route('/actors/<actor_type>/<actor_id>', methods=['DELETE'])
@require_auth
def delete_actor(actor_type, actor_id):
    """Delete actor"""
    headers = get_platform_headers()
    
    if not headers:
        return jsonify({'error': 'Platform connection required'}), 403
    
    try:
        response = requests.delete(
            f'{Config.PLATFORM_API_URL}/bharatlytics/v1/actors/{actor_id}',
            headers=headers,
            timeout=10
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': f'{actor_type} deleted'})
        else:
            return jsonify({'error': 'Delete failed'}), response.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

