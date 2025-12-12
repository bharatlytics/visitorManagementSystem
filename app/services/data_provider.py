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
        """Get employees from appropriate source with local fallback"""
        cid = company_id or self.company_id
        employees = []
        
        if self.is_connected:
            try:
                employees = platform_client.get_employees(cid)
            except Exception as e:
                print(f"Error fetching platform employees: {e}")
        
        # Fallback to local DB if platform returns nothing (or not connected)
        if not employees:
            # Local database - handle both ObjectId and string
            from bson import ObjectId
            from bson.errors import InvalidId
            try:
                cid_oid = ObjectId(cid)
                query = {'$or': [{'companyId': cid_oid}, {'companyId': cid}]}
            except InvalidId:
                query = {'companyId': cid}
                
            employees = list(employees_collection.find(query))
            
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
    
    def _get_residency_config(self, actor_type):
        """Get residency configuration for actor type"""
        try:
            from app.services.integration_helper import integration_client
            return integration_client.get_residency_config(actor_type)
        except Exception:
            # Default to app mode if integration not available
            return {'mode': 'app', 'syncStatus': 'synced'}
    
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

