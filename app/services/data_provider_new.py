"""
Data Provider Service - Residency-Aware Data Fetching

Provides unified data access based on residency mode:
- App mode: Fetch from VMS local database
- Platform mode: Fetch from Platform using manifest actor mapping
"""
from flask import session
from app.config import Config
from app.db import employees_collection, visitor_collection, companies_collection
from app.services.platform_client import platform_client
from app.services.residency_detector import ResidencyDetector
from bson import ObjectId
from bson.errors import InvalidId


class DataProvider:
    """Residency-aware data provider"""
    
    def __init__(self, company_id=None):
        self.company_id = company_id
        self._connected = None
    
    @property
    def is_connected(self):
        """Check if user came from platform (has SSO token in session)"""
        if self._connected is not None:
            return self._connected
        
        platform_token = session.get('platform_token')
        self._connected = bool(platform_token)
        return self._connected
    
    def get_employees(self, company_id=None):
        """
        Get employees with residency-aware logic.
        
        Flow:
        1. Check residency mode for this company's employees
        2. If 'app' mode: Return from VMS local database
        3. If 'platform' mode:
           a. Check manifest for actor mapping
           b. Fetch from Platform using mapped actor type
        
        Args:
            company_id: Company ID
            
        Returns:
            List of employee records
        """
        cid = company_id or self.company_id
        
        # STEP 1: Check residency mode
        residency_mode = ResidencyDetector.get_mode(cid, 'employee')
        print(f"[DataProvider.get_employees] Company {cid}, mode: {residency_mode}")
        
        # STEP 2: App mode - fetch from VMS DB
        if residency_mode == 'app':
            return self._get_employees_from_vms(cid)
        
        # STEP 3: Platform mode - fetch from Platform
        return self._get_employees_from_platform(cid)
    
    def _get_employees_from_vms(self, company_id):
        """Fetch employees from VMS local database"""
        print(f"[DataProvider] Fetching employees from VMS DB")
        
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        employees = list(employees_collection.find(query))
        print(f"[DataProvider] Found {len(employees)} employees in VMS DB")
        return employees
    
    def _get_employees_from_platform(self, company_id):
        """Fetch employees from Platform using manifest actor mapping"""
        print(f"[DataProvider] Fetching employees from Platform")
        
        # Get actor mapping from manifest
        mapped_actor_type = self._get_mapped_actor_type(company_id, 'employee')
        print(f"[DataProvider] VMS 'employee' → Platform '{mapped_actor_type}'")
        
        employees = []
        
        try:
            if self.is_connected:
                # Use existing platform_client
                employees = platform_client.get_actors_by_type(company_id, mapped_actor_type)
            else:
                # Generate token and use Platform client wrapper
                employees = self._fetch_from_platform_api(company_id, mapped_actor_type)
            
            print(f"[DataProvider] Fetched {len(employees)} employees from Platform")
            
        except Exception as e:
            print(f"[DataProvider] Error fetching from Platform: {e}")
            # In platform mode, don't fallback to VMS DB - that violates residency
            employees = []
        
        return employees
    
    def _fetch_from_platform_api(self, company_id, actor_type):
        """Fetch from Platform API when no session token"""
        from app.services.platform_client_wrapper import PlatformClientWrapper
        import jwt
        from datetime import datetime, timedelta
        
        # Generate platform token
        platform_secret = Config.PLATFORM_JWT_SECRET or Config.JWT_SECRET
        payload = {
            'sub': 'vms_app_v1',
            'companyId': company_id,
            'iss': 'vms',
            'exp': datetime.utcnow() + timedelta(hours=1)
        }
        platform_token = jwt.encode(payload, platform_secret, algorithm='HS256')
        
        client = PlatformClientWrapper(platform_token)
        return client.get_employees(company_id)
    
    def _get_mapped_actor_type(self, company_id, vms_entity_type):
        """
        Get Platform actor type from manifest mapping.
        
        Checks manifest to see which Platform actor type maps to VMS entity.
        Example: VMS 'employee' → Platform 'shift_supervisor'
        
        Args:
            company_id: Company ID
            vms_entity_type: VMS entity type ('employee', 'visitor')
            
        Returns:
            Platform actor type string
        """
        try:
            if self.is_connected:
                # Get manifest from Platform
                manifest = platform_client.get_app_manifest('vms_app_v1', company_id)
                
                if manifest and 'actorMappings' in manifest:
                    mappings = manifest['actorMappings']
                    
                    if vms_entity_type in mappings:
                        platform_actors = mappings[vms_entity_type]
                        
                        if platform_actors and len(platform_actors) > 0:
                            return platform_actors[0]
        except Exception as e:
            print(f"[DataProvider] Error getting manifest: {e}")
        
        # Default: 1:1 mapping (VMS entity type = Platform actor type)
        return vms_entity_type
    
    def get_visitors(self, company_id=None):
        """
        Get visitors with residency-aware logic.
        
        Same pattern as employees.
        """
        cid = company_id or self.company_id
        
        # Check residency mode
        residency_mode = ResidencyDetector.get_mode(cid, 'visitor')
        print(f"[DataProvider.get_visitors] Company {cid}, mode: {residency_mode}")
        
        # App mode - fetch from VMS DB
        if residency_mode == 'app':
            return self._get_visitors_from_vms(cid)
        
        # Platform mode - fetch from Platform
        return self._get_visitors_from_platform(cid)
    
    def _get_visitors_from_vms(self, company_id):
        """Fetch visitors from VMS local database"""
        print(f"[DataProvider] Fetching visitors from VMS DB")
        
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except InvalidId:
            query = {'companyId': company_id}
        
        visitors = list(visitor_collection.find(query))
        print(f"[DataProvider] Found {len(visitors)} visitors in VMS DB")
        return visitors
    
    def _get_visitors_from_platform(self, company_id):
        """Fetch visitors from Platform using manifest actor mapping"""
        print(f"[DataProvider] Fetching visitors from Platform")
        
        mapped_actor_type = self._get_mapped_actor_type(company_id, 'visitor')
        print(f"[DataProvider] VMS 'visitor' → Platform '{mapped_actor_type}'")
        
        visitors = []
        
        try:
            if self.is_connected:
                visitors = platform_client.get_actors_by_type(company_id, mapped_actor_type)
            else:
                # Use Platform client wrapper
                from app.services.platform_client_wrapper import PlatformClientWrapper
                import jwt
                from datetime import datetime, timedelta
                
                platform_secret = Config.PLATFORM_JWT_SECRET or Config.JWT_SECRET
                payload = {
                    'sub': 'vms_app_v1',
                    'companyId': company_id,
                    'iss': 'vms',
                    'exp': datetime.utcnow() + timedelta(hours=1)
                }
                platform_token = jwt.encode(payload, platform_secret, algorithm='HS256')
                
                client = PlatformClientWrapper(platform_token)
                visitors = client.get_visitors(company_id)
            
            print(f"[DataProvider] Fetched {len(visitors)} visitors from Platform")
            
        except Exception as e:
            print(f"[DataProvider] Error fetching from Platform: {e}")
            visitors = []
        
        return visitors


def get_data_provider(company_id=None):
    """Factory function to get data provider instance"""
    return DataProvider(company_id)
