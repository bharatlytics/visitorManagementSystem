"""
Webhooks API
Handles platform lifecycle events (install, uninstall).
"""
import json
import os
from flask import Blueprint, request, jsonify
from app.db import db
from app.services.integration_helper import integration_client
from app.config import Config

webhooks_bp = Blueprint('webhooks', __name__)

@webhooks_bp.route('/install', methods=['POST'])
def handle_install():
    """
    Handle app installation webhook.
    Receives client_id and client_secret from the platform.
    """
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
        
    company_id = data.get('company_id')
    installation_id = data.get('installation_id')
    credentials = data.get('credentials', {})
    
    if not company_id or not credentials:
        return jsonify({'error': 'Missing required fields'}), 400
        
    # Store installation details securely
    # In a real app, encrypt the client_secret
    installation_doc = {
        'company_id': company_id,
        'installation_id': installation_id,
        'app_id': data.get('app_id') or credentials.get('app_id'),  # Platform-generated app ID
        'client_id': credentials.get('client_id'),
        'client_secret': credentials.get('client_secret'),
        'status': 'active',
        'installed_at': data.get('timestamp')
    }
    
    print(f"[Webhook/Install] Storing installation: app_id={installation_doc.get('app_id')}, company_id={company_id}")
    
    # Update or insert
    db['installations'].update_one(
        {'company_id': company_id},
        {'$set': installation_doc},
        upsert=True
    )
    
    # Initialize/Verify connection
    try:
        integration_client.initialize(
            client_id=credentials.get('client_id'),
            client_secret=credentials.get('client_secret'),
            company_id=company_id
        )
        # Register schemas immediately upon install
        integration_client.register_schemas()
        
        # Register data contract with the platform for dashboard integration
        _register_data_contract()
        
    except Exception as e:
        print(f"Warning: Failed to initialize integration on install: {e}")
    
    print(f"✅ App installed for company {company_id}")
    return jsonify({'status': 'success', 'message': 'Installation completed'})


def _register_data_contract():
    """
    Register VMS data contract with the platform.
    This enables VMS metrics to appear in Custom Dashboards.
    """
    try:
        # Load manifest to get data exchange config
        manifest_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'manifest.json')
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
        
        # Build data contract from manifest
        data_contract = {
            'appId': manifest.get('appId', 'vms_app_v1'),
            'appName': manifest.get('name', 'Visitor Management System'),
            'category': manifest.get('category', 'operations'),
            'industries': ['healthcare', 'corporate', 'manufacturing', 'education'],
            'consumes': {
                'actors': {
                    'types': [a['actorType'] for a in manifest.get('requiredActors', [])],
                    'usage': 'Link visitors to hosts and manage visitor data'
                },
                'entities': {
                    'types': [e['entityType'] for e in manifest.get('requiredEntities', [])],
                    'usage': 'Assign visits to locations'
                }
            },
            'produces': manifest.get('dataExchange', {}).get('produces', {})
        }
        
        # Register with platform
        headers = integration_client._get_auth_headers()
        import requests
        response = requests.post(
            f"{Config.PLATFORM_API_URL}/bharatlytics/integration/v1/registry/contracts",
            headers=headers,
            json=data_contract,
            timeout=10
        )
        
        if response.status_code in [200, 201]:
            print("✅ Data contract registered with platform")
        else:
            print(f"Warning: Failed to register data contract: {response.text}")
            
    except Exception as e:
        print(f"Warning: Could not register data contract: {e}")


@webhooks_bp.route('/uninstall', methods=['POST'])
def handle_uninstall():
    """
    Handle app uninstallation webhook.
    """
    data = request.json
    company_id = data.get('company_id')
    
    if not company_id:
        return jsonify({'error': 'Missing company_id'}), 400
        
    # Remove credentials
    db['installations'].delete_one({'company_id': company_id})
    
    print(f"🗑️ App uninstalled for company {company_id}")
    return jsonify({'status': 'success', 'message': 'Uninstallation completed'})


@webhooks_bp.route('/residency-change', methods=['POST'])
def handle_residency_change():
    """
    Handle residency mode change from platform.
    
    Called when company changes residency mode (platform ↔ app).
    
    Request format:
    {
        "dataType": "actor_visitor",
        "oldMode": "app",
        "newMode": "platform",
        "company_id": "company_123"
    }
    """
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    data_type = data.get('dataType')
    old_mode = data.get('oldMode')
    new_mode = data.get('newMode')
    company_id = data.get('company_id')
    
    if not all([data_type, new_mode, company_id]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    print(f"📦 Residency change: {data_type} {old_mode} → {new_mode} for company {company_id}")
    
    if new_mode == 'platform':
        # Company wants data synced to platform
        # Schedule a full sync job
        try:
            # Trigger sync in background
            # In production, use Celery or similar task queue
            from threading import Thread
            from app.api.residency_api import trigger_sync
            
            def background_sync():
                # Create app context for background thread
                from flask import current_app
                with current_app.app_context():
                    # Perform full sync
                    integration_client.update_sync_status(data_type, 'pending_migration')
                    # Actual sync will be handled by residency_api
            
            # Note: In production, use proper task queue instead of threading
            print(f"🔄 Scheduling full sync for {data_type}")
            
        except Exception as e:
            print(f"Error scheduling sync: {e}")
        
    elif new_mode == 'app':
        # Company wants federated queries
        # Ensure our query endpoint is ready
        print(f"📡 Switching to federated mode for {data_type}")
    
    return jsonify({
        'status': 'acknowledged',
        'dataType': data_type,
        'newMode': new_mode
    })


@webhooks_bp.route('/data-update', methods=['POST'])
def handle_data_update():
    """
    Handle data update notifications from platform.
    
    Called when platform data changes that the app should know about.
    """
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    update_type = data.get('type')
    entity_type = data.get('entityType')
    
    print(f"📥 Data update received: {update_type} for {entity_type}")
    
    # Handle different update types
    # - actor_updated: An actor was modified
    # - entity_updated: An entity was modified
    # - mapping_changed: Data mapping was updated
    
    return jsonify({'status': 'received'})

