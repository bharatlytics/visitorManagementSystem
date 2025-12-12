"""
Platform API Client

Makes authenticated requests to Bharatlytics Platform.
Uses the SSO token from the user's session - NO static API keys.
"""
import requests
from flask import session
from app.config import Config


class PlatformClient:
    """
    Client for Bharatlytics Platform API.
    All authentication comes from the SSO token in session.
    """
    
    def __init__(self, api_url=None):
        self.base_url = api_url or Config.PLATFORM_API_URL
    
    def _get_token(self):
        """Get the platform token from session"""
        return session.get('platform_token')
    
    def _get_company_id(self):
        """Get the company ID from session (set during SSO)"""
        return session.get('company_id')
    
    def _request(self, method, endpoint, params=None, data=None):
        """Make authenticated request to platform using session token"""
        token = self._get_token()
        if not token:
            print("[PlatformClient] No platform token in session - falling back to local")
            return None
        
        url = f"{self.base_url}{endpoint}"
        headers = {
            'Authorization': f'Bearer {token}',
            'X-App-Id': 'vms',
            'Content-Type': 'application/json'
        }
        
        print(f"[PlatformClient] {method} {url} params={params}")
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=data,
                timeout=30
            )
            print(f"[PlatformClient] Response status: {response.status_code}")
            response.raise_for_status()
            result = response.json()
            print(f"[PlatformClient] Response data type: {type(result)}, length: {len(result) if isinstance(result, list) else 'N/A'}")
            return result
        except requests.exceptions.RequestException as e:
            print(f"[PlatformClient] API error: {e}")
            return None
    
    def get_employees(self, company_id=None):
        """Get employees from platform actors collection"""
        cid = company_id or self._get_company_id()
        data = self._request('GET', '/bharatlytics/v1/actors', params={'companyId': cid})
        if not data:
            return []
        
        # Filter to employees and map fields
        employees = []
        for actor in data if isinstance(data, list) else []:
            if actor.get('actorType') == 'employee':
                attrs = actor.get('attributes', {})
                employees.append({
                    '_id': actor.get('_id'),
                    'employeeId': attrs.get('employeeId', actor.get('_id')),
                    'employeeName': attrs.get('employeeName') or attrs.get('name', 'Unknown'),
                    'email': attrs.get('email'),
                    'phone': attrs.get('phone'),
                    'department': attrs.get('department'),
                    'designation': attrs.get('designation')
                })
        return employees
    
    def get_entities(self, company_id=None, types=None):
        """Get entities from platform"""
        cid = company_id or self._get_company_id()
        data = self._request('GET', '/bharatlytics/v1/entities', params={'companyId': cid})
        if not data:
            return []
        
        entities = data if isinstance(data, list) else []
        
        # Filter by types if specified
        if types:
            entities = [e for e in entities if e.get('type') in types]
        
        return entities
    
    def get_company(self, company_id=None):
        """Get company info from platform"""
        cid = company_id or self._get_company_id()
        return self._request('GET', f'/bharatlytics/v1/companies/{cid}')


# Global instance
platform_client = PlatformClient()

