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
        """Get employees from appropriate source"""
        cid = company_id or self.company_id
        
        if self.is_connected:
            return platform_client.get_employees(cid)
        else:
            # Local database
            return list(employees_collection.find({'companyId': cid}))
    
    def get_entities(self, company_id=None, types=None):
        """Get entities from appropriate source"""
        cid = company_id or self.company_id
        
        if self.is_connected:
            return platform_client.get_entities(cid, types)
        else:
            # Local database
            query = {'companyId': cid}
            if types:
                query['type'] = {'$in': types}
            return list(entities_collection.find(query))
    
    def get_company(self, company_id=None):
        """Get company info from appropriate source"""
        cid = company_id or self.company_id
        
        if self.is_connected:
            return platform_client.get_company(cid)
        else:
            from bson import ObjectId
            return companies_collection.find_one({'_id': ObjectId(cid) if isinstance(cid, str) else cid})
    
    def get_employee_by_id(self, employee_id, company_id=None):
        """Get single employee by ID"""
        cid = company_id or self.company_id
        employees = self.get_employees(cid)
        
        for emp in employees:
            if str(emp.get('_id')) == str(employee_id) or emp.get('employeeId') == employee_id:
                return emp
        return None


def get_data_provider(company_id=None):
    """Factory function to get data provider"""
    return DataProvider(company_id)
