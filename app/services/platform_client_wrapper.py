"""
Platform Client Wrapper - Handles all Platform API interactions

Provides fault-tolerant methods for creating, updating, and fetching data from Platform.
Automatically queues operations when Platform is down.
"""
from typing import Dict, Any, List, Optional
import requests
from datetime import datetime
from app.config import Config
from app.services.sync_queue import SyncQueue


class PlatformDownError(Exception):
    """Raised when Platform is unreachable"""
    pass


class PlatformClientWrapper:
    """Wrapper for Platform API with fault tolerance"""
    
    def __init__(self, platform_token: str = None):
        """
        Initialize Platform client.
        
        Args:
            platform_token: Optional auth token for Platform
        """
        self.platform_token = platform_token
        self.base_url = Config.PLATFORM_API_URL
    
    def _get_headers(self) -> Dict[str, str]:
        """Get headers for Platform API requests"""
        headers = {'Content-Type': 'application/json'}
        if self.platform_token:
            headers['Authorization'] = f'Bearer {self.platform_token}'
        return headers
    
    def _make_request(self, method: str, endpoint: str, data: Dict = None, 
                     params: Dict = None) -> Dict[str, Any]:
        """
        Make request to Platform API with error handling.
        
        Raises:
            PlatformDownError: If Platform is unreachable
        """
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=10)
            elif method == 'POST':
                response = requests.post(url, headers=headers, json=data, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, headers=headers, json=data, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            
            if response.status_code >= 500:
                raise PlatformDownError(f"Platform returned {response.status_code}")
            
            response.raise_for_status()
            return response.json() if response.content else {}
            
        except requests.exceptions.RequestException as e:
            print(f"[PlatformClient] Request failed: {e}")
            raise PlatformDownError(str(e))
    
    # ==================== Employee Methods ====================
    
    def create_employee(self, company_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create employee on Platform.
        
        Args:
            company_id: Company ID
            data: Employee data
            
        Returns:
            Created employee data from Platform
            
        Raises:
            PlatformDownError: If Platform is down (caller should queue)
        """
        endpoint = '/bharatlytics/v1/actors'
        payload = {
            'companyId': company_id,
            'actorType': 'employee',
            'attributes': data
        }
        
        print(f"[PlatformClient] Creating employee on Platform for company {company_id}")
        return self._make_request('POST', endpoint, data=payload)
    
    def update_employee(self, employee_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update employee on Platform"""
        endpoint = f'/bharatlytics/v1/actors/{employee_id}'
        payload = {'attributes': data}
        
        print(f"[PlatformClient] Updating employee {employee_id} on Platform")
        return self._make_request('PUT', endpoint, data=payload)
    
    def get_employees(self, company_id: str) -> List[Dict[str, Any]]:
        """Fetch employees from Platform"""
        endpoint = '/bharatlytics/v1/actors'
        params = {
            'companyId': company_id,
            'actorType': 'employee'
        }
        
        print(f"[PlatformClient] Fetching employees from Platform for company {company_id}")
        result = self._make_request('GET', endpoint, params=params)
        return result if isinstance(result, list) else []
    
    def delete_employee(self, employee_id: str):
        """Delete employee from Platform"""
        endpoint = f'/bharatlytics/v1/actors/{employee_id}'
        print(f"[PlatformClient] Deleting employee {employee_id} from Platform")
        return self._make_request('DELETE', endpoint)
    
    # ==================== Visitor Methods ====================
    
    def create_visitor(self, company_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create visitor on Platform"""
        endpoint = '/bharatlytics/v1/actors'
        payload = {
            'companyId': company_id,
            'actorType': 'visitor',
            'attributes': data
        }
        
        print(f"[PlatformClient] Creating visitor on Platform for company {company_id}")
        return self._make_request('POST', endpoint, data=payload)
    
    def update_visitor(self, visitor_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update visitor on Platform"""
        endpoint = f'/bharatlytics/v1/actors/{visitor_id}'
        payload = {'attributes': data}
        
        print(f"[PlatformClient] Updating visitor {visitor_id} on Platform")
        return self._make_request('PUT', endpoint, data=payload)
    
    def get_visitors(self, company_id: str) -> List[Dict[str, Any]]:
        """Fetch visitors from Platform"""
        endpoint = '/bharatlytics/v1/actors'
        params = {
            'companyId': company_id,
            'actorType': 'visitor'
        }
        
        print(f"[PlatformClient] Fetching visitors from Platform for company {company_id}")
        result = self._make_request('GET', endpoint, params=params)
        return result if isinstance(result, list) else []
    
    def delete_visitor(self, visitor_id: str):
        """Delete visitor from Platform"""
        endpoint = f'/bharatlytics/v1/actors/{visitor_id}'
        print(f"[PlatformClient] Deleting visitor {visitor_id} from Platform")
        return self._make_request('DELETE', endpoint)
    
    # ==================== Generic Actor Methods ====================
    
    def get_actors_by_type(self, company_id: str, actor_type: str) -> List[Dict[str, Any]]:
        """
        Fetch actors of any type from Platform.
        
        This is used for manifest-based actor mapping.
        Example: VMS 'location' → Platform 'organization'
        
        Args:
            company_id: Company ID
            actor_type: Platform actor type (e.g., 'employee', 'organization', 'zone')
            
        Returns:
            List of actors from Platform
        """
        endpoint = '/bharatlytics/v1/actors'
        params = {
            'companyId': company_id,
            'actorType': actor_type
        }
        
        print(f"[PlatformClient] Fetching actors of type '{actor_type}' from Platform for company {company_id}")
        result = self._make_request('GET', endpoint, params=params)
        return result if isinstance(result, list) else []
    
    # ==================== Embedding Methods ====================
    
    def upload_embedding(self, actor_id: str, embedding_file, model: str = 'buffalo_l'):
        """
        Upload embedding to Platform.
        
        Args:
            actor_id: Actor ID on Platform
            embedding_file: File-like object with embedding data
            model: Embedding model name
        """
        endpoint = f'/bharatlytics/v1/actors/{actor_id}/biometrics'
        
        # TODO: Implement multipart upload
        print(f"[PlatformClient] Uploading embedding for actor {actor_id}")
        # This will need to be implemented based on Platform's API
        pass
    
    # ==================== Helper Methods ====================
    
    @staticmethod
    def create_with_queue(company_id: str, entity_type: str, data: Dict[str, Any], 
                         platform_token: str = None) -> tuple[bool, Optional[Dict], Optional[str]]:
        """
        Create entity on Platform with automatic queueing on failure.
        
        Args:
            company_id: Company ID
            entity_type: 'employee' or 'visitor'
            data: Entity data
            platform_token: Optional Platform auth token
            
        Returns:
            Tuple of (success, result_data, queue_id)
            - success: True if created on Platform, False if queued
            - result_data: Platform response if success, None if queued
            - queue_id: Queue ID if queued, None if success
        """
        client = PlatformClientWrapper(platform_token)
        
        try:
            if entity_type == 'employee':
                result = client.create_employee(company_id, data)
            elif entity_type == 'visitor':
                result = client.create_visitor(company_id, data)
            else:
                raise ValueError(f"Unknown entity type: {entity_type}")
            
            print(f"[PlatformClient] Successfully created {entity_type} on Platform")
            return True, result, None
            
        except PlatformDownError as e:
            # Platform is down, queue for retry
            print(f"[PlatformClient] Platform down, queueing {entity_type}: {e}")
            queue_id = SyncQueue.enqueue(
                operation='create',
                entity_type=entity_type,
                entity_id='pending',  # Will be set after Platform creates it
                data=data,
                company_id=company_id
            )
            return False, None, queue_id
