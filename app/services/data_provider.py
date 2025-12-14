"""
Data Provider Service

Provides unified data access based on HOW the user accessed the app:
- Direct access (localhost:5001) → Login → Own DB
- From Platform (SSO token) → Platform API for employees/entities
"""
from flask import session
from app.config import Config
from app.db import employees_collection, entities_collection, companies_collection
from app.services.platform_client import platform_client


class DataProvider:
    """Unified data provider - mode determined by session, not config"""
    
    def __init__(self, company_id=None):
        self.company_id = company_id
        self._connected = None
    
    @property
    def is_connected(self):
        """
        Check if user came from platform (has SSO token in session).
        Mode is PER-SESSION, not a static config.
        """
        if self._connected is not None:
            return self._connected
        
        # If session has platform_token, user came via platform SSO
        platform_token = session.get('platform_token')
        self._connected = bool(platform_token)
        
        return self._connected
    
    def get_employees(self, company_id=None):
        """Get employees respecting Data Residency mode AND actor type mapping.
        
        - If mode is 'app': Query local database (data lives here - VMS manages its own employees)
        - If mode is 'platform': Query platform API for the MAPPED actor type
        
        The actorMappings field determines WHICH actor type to fetch:
        e.g., actorMappings: {"employee": ["shift_supervisor"]} 
              means VMS's "employee" → Platform's "shift_supervisor"
        """
        from bson import ObjectId
        from bson.errors import InvalidId
        
        cid = company_id or self.company_id
        
        # Get full mapping config (includes mode AND actor type mapping)
        config = self._get_full_mapping_config('employee')
        print(f"[DataProvider.get_employees] Full config: mode={config.get('mode')}, mapped_type={config.get('mapped_type')}")
        
        if config['mode'] == 'app':
            # Data lives in our app (VMS manages its own employees)
            print(f"[DataProvider.get_employees] Using LOCAL employees (mode=app)")
            try:
                cid_oid = ObjectId(cid)
                query = {'$or': [{'companyId': cid_oid}, {'companyId': cid}]}
            except InvalidId:
                query = {'companyId': cid}
                
            employees = list(employees_collection.find(query))
            print(f"[DataProvider.get_employees] Found {len(employees)} local employees")
            return employees
        
        # Data lives on platform - use the MAPPED actor type
        mapped_type = config.get('mapped_type', 'employee')
        print(f"[DataProvider.get_employees] Using PLATFORM actors of type '{mapped_type}'")
        employees = []
        
        if self.is_connected:
            try:
                # Fetch the mapped actor type, not hardcoded 'employee'
                employees = platform_client.get_actors_by_type(cid, mapped_type)
                print(f"[DataProvider.get_employees] Got {len(employees)} platform actors (type={mapped_type})")
            except Exception as e:
                print(f"Error fetching platform actors: {e}")
        
        # Fallback to local DB if platform returns nothing
        if not employees:
            try:
                cid_oid = ObjectId(cid)
                query = {'$or': [{'companyId': cid_oid}, {'companyId': cid}]}
            except InvalidId:
                query = {'companyId': cid}
                
            employees = list(employees_collection.find(query))
            print(f"[DataProvider.get_employees] Fallback: {len(employees)} local employees")
            
        return employees
    
    def get_entities(self, company_id=None, types=None):
        """Get entities from appropriate source with local fallback"""
        cid = company_id or self.company_id
        entities = []
        
        if self.is_connected:
            try:
                entities = platform_client.get_entities(cid, types)
            except Exception as e:
                print(f"Error fetching platform entities: {e}")
        
        # Fallback to local DB if platform returns nothing
        if not entities:
            # Local database - handle both ObjectId and string
            from bson import ObjectId
            from bson.errors import InvalidId
            try:
                cid_oid = ObjectId(cid)
                query = {'$or': [{'companyId': cid_oid}, {'companyId': cid}]}
            except InvalidId:
                query = {'companyId': cid}
            
            if types:
                query['type'] = {'$in': types}
            entities = list(entities_collection.find(query))
            
        return entities
    
    def get_company(self, company_id=None):
        """Get company info from appropriate source"""
        cid = company_id or self.company_id
        
        if self.is_connected:
            return platform_client.get_company(cid)
        else:
            from bson import ObjectId
            from bson.errors import InvalidId
            
            # Try multiple strategies like in company API
            company = None
            try:
                if ObjectId.is_valid(cid):
                    company = companies_collection.find_one({'_id': ObjectId(cid)})
                
                if not company:
                    if ObjectId.is_valid(cid):
                        company = companies_collection.find_one({'companyId': ObjectId(cid)})
                    
                    if not company:
                        company = companies_collection.find_one({'companyId': cid})
            except Exception:
                pass
                
            if not company:
                # Last resort fallback
                company = companies_collection.find_one({'companyId': cid})
                
            return company
    
    def get_employee_by_id(self, employee_id, company_id=None):
        """Get single employee by ID"""
        cid = company_id or self.company_id
        employees = self.get_employees(cid)
        
        for emp in employees:
            if str(emp.get('_id')) == str(employee_id) or emp.get('employeeId') == employee_id:
                return emp
        return None
    
    def get_visitors(self, company_id=None, filters=None):
        """
        Get visitors respecting Data Residency mode.
        
        - If mode is 'platform': Query platform (data lives there)
        - If mode is 'app': Query local database (default, data lives here)
        """
        from app.db import visitor_collection
        from app.services.integration_helper import integration_client
        from bson import ObjectId
        from bson.errors import InvalidId
        
        cid = company_id or self.company_id
        
        # Check residency configuration
        config = self._get_residency_config('visitor')
        
        if config['mode'] == 'platform':
            # Data lives on platform — query via integration API
            return integration_client.get_actors('visitor', filters=filters)
        else:
            # Data lives in our app (default) — query local DB
            try:
                cid_oid = ObjectId(cid)
                query = {'$or': [{'companyId': cid_oid}, {'companyId': cid}]}
            except InvalidId:
                query = {'companyId': cid}
            
            # Apply filters if provided
            if filters:
                if filters.get('status'):
                    query['status'] = filters['status']
                if filters.get('blacklisted') is not None:
                    query['blacklisted'] = filters['blacklisted']
            
            return list(visitor_collection.find(query))
    
    def _get_full_mapping_config(self, actor_type):
        """Get full mapping configuration including mode AND mapped actor type.
        
        Returns:
        {
            'mode': 'platform' | 'app',
            'mapped_type': 'shift_supervisor' | 'employee' | etc.,  # The actor type to fetch
            'syncStatus': 'synced' | 'pending_migration',
            ...
        }
        """
        import requests
        import json
        import os
        from flask import session
        from app.config import Config
        from app.db import db
        
        actor_key = f'actor_{actor_type}'
        
        try:
            # Get company_id from session or self
            company_id = session.get('company_id') or self.company_id
            
            # Get app_id dynamically
            app_id = self._get_app_id(company_id)
            
            if company_id:
                # Fetch mapping from platform
                url = f"{Config.PLATFORM_API_URL}/bharatlytics/integration/v1/installations/mapping"
                params = {'appId': app_id, 'companyId': company_id}
                
                print(f"[_get_full_mapping_config] Fetching from {url} params={params}")
                response = requests.get(url, params=params, timeout=5)
                
                if response.status_code == 200:
                    data = response.json()
                    mapping = data.get('mapping')
                    
                    if mapping:
                        # Get residency mode
                        residency_mode = mapping.get('residencyMode', {})
                        actor_config = residency_mode.get(actor_key, {})
                        mode = actor_config.get('mode', 'platform')
                        
                        # Get actor type mapping (what platform type to fetch)
                        actor_mappings = mapping.get('actorMappings', {})
                        mapped_types = actor_mappings.get(actor_type, [actor_type])
                        # Take the first mapped type (usually there's only one)
                        mapped_type = mapped_types[0] if mapped_types else actor_type
                        
                        print(f"[_get_full_mapping_config] {actor_type} → mode={mode}, mapped_type={mapped_type}")
                        
                        return {
                            'mode': mode,
                            'mapped_type': mapped_type,
                            'syncStatus': actor_config.get('syncStatus', 'synced'),
                            'lastSyncAt': actor_config.get('lastSyncAt'),
                            'syncVersion': actor_config.get('syncVersion', 1)
                        }
                    else:
                        print(f"[_get_full_mapping_config] No mapping configured for {app_id}")
                else:
                    print(f"[_get_full_mapping_config] API error {response.status_code}")
                    
        except Exception as e:
            print(f"[_get_full_mapping_config] Error: {e}")
        
        # Default
        if self.is_connected:
            return {'mode': 'platform', 'mapped_type': actor_type, 'syncStatus': 'synced'}
        else:
            return {'mode': 'app', 'mapped_type': actor_type, 'syncStatus': 'synced'}
    
    def _get_app_id(self, company_id):
        """Get the platform app_id for this installation."""
        import json
        import os
        from app.db import db
        
        # Try local installations collection
        installation = db['installations'].find_one({'company_id': company_id})
        if installation and installation.get('app_id'):
            return installation.get('app_id')
        
        # Fallback: Get from manifest
        try:
            manifest_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'manifest.json')
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
                if manifest.get('appId'):
                    return manifest.get('appId')
        except Exception:
            pass
        
        # Final fallback
        return 'app_bharatlytics_vms_366865a4'
    
    def _get_residency_config(self, actor_type):
        """Get residency configuration for actor type (legacy method).
        
        For backward compatibility. Use _get_full_mapping_config for new code.
        """
        config = self._get_full_mapping_config(actor_type)
        return {
            'mode': config.get('mode', 'platform'),
            'syncStatus': config.get('syncStatus', 'synced'),
            'lastSyncAt': config.get('lastSyncAt'),
            'syncVersion': config.get('syncVersion', 1)
        }
    
    def sync_visitor_if_needed(self, visitor_data):
        """
        Sync visitor to platform if in platform residency mode.
        Call this after creating/updating visitors.
        """
        config = self._get_residency_config('visitor')
        
        if config['mode'] != 'platform':
            return True  # No sync needed
        
        try:
            from app.services.integration_helper import integration_client
            
            sync_data = {
                'type': 'visitor',
                'id': str(visitor_data.get('_id', visitor_data.get('id'))),
                'data': {
                    'name': visitor_data.get('visitorName'),
                    'phone': visitor_data.get('phone'),
                    'email': visitor_data.get('email'),
                    'company': visitor_data.get('organization'),
                },
                'operation': 'upsert'
            }
            
            return integration_client.sync_actor(sync_data)
        except Exception as e:
            print(f"Failed to sync visitor: {e}")
            return False


def get_data_provider(company_id=None):
    """Factory function to get data provider"""
    return DataProvider(company_id)

