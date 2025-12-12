"""
VMS Integration Client
Handles communication with Bharatlytics Integration API v1.
"""
import requests
import time
from typing import Dict, List, Optional
from app.config import Config
from app.db import db

class IntegrationClient:
    """
    Client for Bharatlytics Integration API v1.
    Handles authentication, schema registry, and event publishing.
    """
    
    def __init__(self):
        self.base_url = f"{Config.PLATFORM_API_URL}/bharatlytics/integration/v1"
        self.client_id = None
        self.client_secret = None
        self.company_id = None
        self.access_token = None
        self.token_expiry = 0
        
        # Try to load credentials from DB if only one installation exists (Single Tenant Mode)
        self._auto_load_credentials()

    def _auto_load_credentials(self):
        """Auto-load credentials if we are in a single-tenant environment"""
        try:
            install = db['installations'].find_one()
            if install:
                self.initialize(
                    install.get('client_id'),
                    install.get('client_secret'),
                    install.get('company_id')
                )
        except Exception:
            pass

    def initialize(self, client_id, client_secret, company_id):
        """Initialize with credentials"""
        self.client_id = client_id
        self.client_secret = client_secret
        self.company_id = company_id
        self.access_token = None
        print(f"Integration Client initialized for company {company_id}")

    def _get_auth_headers(self):
        """Get headers with Bearer token"""
        if not self.access_token or time.time() > self.token_expiry:
            self._refresh_token()
            
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    def _refresh_token(self):
        """Get a new access token"""
        if not self.client_id or not self.client_secret:
            raise ValueError("Integration credentials not set")
            
        try:
            response = requests.post(f"{self.base_url}/auth/token", json={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "company_id": self.company_id
            })
            response.raise_for_status()
            data = response.json()
            self.access_token = data["access_token"]
            # Set expiry (buffer of 60s)
            self.token_expiry = time.time() + data.get("expires_in", 3600) - 60
        except Exception as e:
            print(f"Failed to refresh token: {e}")
            raise

    def register_schemas(self):
        """Register data schemas with the platform"""
        schemas = {
            "appId": "vms_app_v1",
            "schemas": [
                {
                    "name": "visit_record",
                    "version": "1.0",
                    "fields": [
                        {"name": "visitorName", "type": "string", "required": True},
                        {"name": "hostName", "type": "string"},
                        {"name": "checkInTime", "type": "datetime"}
                    ]
                }
            ],
            "events": [
                {"type": "visit.checked_in", "schema": "visit_record"},
                {"type": "visit.checked_out", "schema": "visit_record"}
            ]
        }
        
        try:
            requests.post(
                f"{self.base_url}/registry/schemas",
                headers=self._get_auth_headers(),
                json=schemas
            )
            print("✅ Schemas registered successfully")
        except Exception as e:
            print(f"⚠️ Failed to register schemas: {e}")

    def publish_event(self, event_type: str, data: Dict, actor: Dict = None):
        """Publish an event to the platform"""
        if not self.client_id:
            return  # Not configured
            
        payload = {
            "eventType": event_type,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "data": data,
            "actor": actor
        }
        
        try:
            requests.post(
                f"{self.base_url}/events",
                headers=self._get_auth_headers(),
                json=payload
            )
            print(f"📤 Published event: {event_type}")
        except Exception as e:
            print(f"Failed to publish event {event_type}: {e}")

    def report_metric(self, name: str, value: float, unit: str, dimensions: Dict = None):
        """Report a metric to the platform"""
        if not self.client_id:
            return  # Not configured
            
        payload = {
            "name": name,
            "value": value,
            "unit": unit,
            "dimensions": dimensions or {},
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
        try:
            requests.post(
                f"{self.base_url}/metrics",
                headers=self._get_auth_headers(),
                json=payload
            )
            print(f"📊 Reported metric: {name} = {value}")
        except Exception as e:
            print(f"Failed to report metric {name}: {e}")

    def get_actors(self, actor_type: str, filters: Dict = None):
        """Fetch actors from platform"""
        try:
            params = {"actorType": actor_type}
            if filters:
                params.update(filters)
            response = requests.get(
                f"{self.base_url}/actors",
                headers=self._get_auth_headers(),
                params=params
            )
            response.raise_for_status()
            return response.json().get("actors", [])
        except Exception as e:
            print(f"Failed to fetch actors: {e}")
            return []

    # ===== Data Residency v3 Methods =====
    
    def get_mapping(self) -> Dict:
        """Get current data mapping with residency configuration"""
        if not self.client_id:
            return {}
            
        try:
            response = requests.get(
                f"{self.base_url}/installations/mapping",
                headers=self._get_auth_headers(),
                params={"companyId": self.company_id}
            )
            response.raise_for_status()
            return response.json().get("mapping", {})
        except Exception as e:
            print(f"Failed to get mapping: {e}")
            return {}
    
    def get_residency_config(self, actor_type: str) -> Dict:
        """Get residency configuration for specific actor type"""
        mapping = self.get_mapping()
        residency_mode = mapping.get('residencyMode', {})
        actor_key = f'actor_{actor_type}'
        
        config = residency_mode.get(actor_key, {})
        return {
            'mode': config.get('mode', 'app'),  # Default: app (federated)
            'syncStatus': config.get('syncStatus', 'synced'),
            'lastSyncAt': config.get('lastSyncAt'),
            'syncVersion': config.get('syncVersion', 1)
        }
    
    def sync_actor(self, actor_data: Dict) -> bool:
        """
        Sync actor data to platform (for platform residency mode).
        
        actor_data should contain:
        - type: actor type (e.g., 'visitor')
        - id: actor's local ID
        - data: actor fields to sync
        - operation: 'upsert' or 'delete' (default: 'upsert')
        """
        if not self.client_id:
            return False
            
        try:
            response = requests.post(
                f"{self.base_url}/sync/actors",
                headers=self._get_auth_headers(),
                json=actor_data
            )
            response.raise_for_status()
            return True
        except Exception as e:
            print(f"Failed to sync actor: {e}")
            return False
    
    def sync_actors_batch(self, actors: List[Dict]) -> Dict:
        """Sync multiple actors in batch"""
        if not self.client_id or not actors:
            return {"synced": 0, "failed": 0}
            
        try:
            response = requests.post(
                f"{self.base_url}/sync/actors/batch",
                headers=self._get_auth_headers(),
                json={"actors": actors}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Failed to batch sync actors: {e}")
            return {"synced": 0, "failed": len(actors), "error": str(e)}
    
    def update_sync_status(self, data_type: str, status: str = 'synced') -> bool:
        """
        Update sync status on platform after full/incremental sync.
        
        data_type: e.g., 'actor_visitor'
        status: 'synced', 'pending_migration', 'stale'
        """
        if not self.client_id:
            return False
            
        try:
            response = requests.post(
                f"{self.base_url}/sync/status",
                headers=self._get_auth_headers(),
                json={
                    "dataType": data_type,
                    "status": status,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }
            )
            response.raise_for_status()
            print(f"✅ Sync status updated: {data_type} → {status}")
            return True
        except Exception as e:
            print(f"Failed to update sync status: {e}")
            return False
    
    def is_platform_mode(self, actor_type: str) -> bool:
        """Check if actor type is in platform residency mode"""
        config = self.get_residency_config(actor_type)
        return config['mode'] == 'platform'

# Global Instance
integration_client = IntegrationClient()
