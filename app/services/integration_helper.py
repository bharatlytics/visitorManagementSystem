"""
VMS Integration Layer Helper

This module provides helper functions for VMS to interact with the Integration Layer.
It handles authentication, data access, event publishing, and schema validation.
"""
from typing import Dict, List, Optional
from bson import ObjectId

from app.db import db, employee_collection


class VMSIntegrationHelper:
    """Helper class for VMS to interact with Integration Layer"""
    
    def __init__(self):
        self.app_id = None
        self.company_id = None
        self._load_vms_credentials()
    
    def _load_vms_credentials(self):
        """Load VMS app credentials from database"""
        try:
            vms_app = db['marketplace_apps'].find_one({'name': 'Visitor Management System'})
            if vms_app:
                self.app_id = str(vms_app['_id'])
        except Exception as e:
            print(f"Warning: Could not load VMS credentials: {e}")
    
    def set_company_context(self, company_id: str):
        """Set the company context for operations"""
        self.company_id = company_id
    
    def get_employee(self, employee_id: str) -> Optional[Dict]:
        """
        Get employee data through Data Access Gateway
        
        Args:
            employee_id: Employee ID (ObjectId as string)
            
        Returns:
            Employee data or None
        """
        if not self.company_id:
            raise ValueError("Company context not set. Call set_company_context first.")
        
        try:
            employee = employee_collection.find_one({
                '_id': ObjectId(employee_id),
                'companyId': ObjectId(self.company_id),
                'status': 'active',
                'blacklisted': False
            })
            
            if employee:
                self._log_access('actor', employee_id, 'read', 'success', {'actor_type': 'employee'})
            
            return employee
        except Exception as e:
            self._log_access('actor', employee_id, 'read', 'error', {'error': str(e)})
            return None
    
    def get_employee_by_code(self, employee_code: str) -> Optional[Dict]:
        """
        Get employee by employee code
        
        Args:
            employee_code: Employee code/ID
            
        Returns:
            Employee data or None
        """
        if not self.company_id:
            raise ValueError("Company context not set")
        
        try:
            employee = employee_collection.find_one({
                'employeeId': employee_code,
                'companyId': ObjectId(self.company_id),
                'status': 'active',
                'blacklisted': False
            })
            
            if employee:
                self._log_access('actor', str(employee.get('_id')), 'read', 'success', 
                               {'actor_type': 'employee', 'lookup': 'code'})
            
            return employee
        except Exception as e:
            self._log_access('actor', None, 'read', 'error', {'error': str(e)})
            return None
    
    def validate_visitor_data(self, visitor_data: Dict) -> tuple:
        """
        Validate visitor data against schema
        
        Args:
            visitor_data: Visitor data to validate
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        # Basic validation
        required_fields = ['visitorName', 'phone']
        for field in required_fields:
            if not visitor_data.get(field):
                return False, f"Missing required field: {field}"
        
        return True, None
    
    def publish_visitor_event(self, event_type: str, visitor_data: Dict):
        """
        Publish visitor-related event
        
        Args:
            event_type: Type of event (e.g., 'visitor.registered', 'visit.scheduled')
            visitor_data: Event data
        """
        if not self.app_id or not self.company_id:
            print(f"Warning: Cannot publish event - missing app_id or company_id")
            return None
        
        try:
            # Try to use event broker if available
            from app.services.event_broker import event_broker
            event_id = event_broker.publish_event(
                app_id=self.app_id,
                company_id=self.company_id,
                event_type=event_type,
                data=visitor_data
            )
            print(f"Published event: {event_type} (ID: {event_id})")
            return event_id
        except ImportError:
            print(f"Event broker not available - event {event_type} not published")
            return None
        except Exception as e:
            print(f"Failed to publish event {event_type}: {e}")
            return None
    
    def publish_visitor_registered(self, visitor_id: str, visitor_name: str, 
                                   host_employee_id: str, company_id: str):
        """Publish visitor.registered event"""
        self.set_company_context(company_id)
        self.publish_visitor_event('visitor.registered', {
            'visitor_id': visitor_id,
            'visitor_name': visitor_name,
            'host_employee_id': host_employee_id,
            'timestamp': None
        })
    
    def publish_visit_scheduled(self, visit_id: str, visitor_id: str, 
                                visitor_name: str, host_employee_id: str,
                                expected_arrival: str, expected_departure: str,
                                company_id: str):
        """Publish visit.scheduled event"""
        self.set_company_context(company_id)
        self.publish_visitor_event('visit.scheduled', {
            'visit_id': visit_id,
            'visitor_id': visitor_id,
            'visitor_name': visitor_name,
            'host_employee_id': host_employee_id,
            'expected_arrival': expected_arrival,
            'expected_departure': expected_departure
        })
    
    def publish_visit_checked_in(self, visit_id: str, visitor_id: str,
                                 visitor_name: str, host_employee_id: str,
                                 check_in_time: str, company_id: str):
        """Publish visit.checked_in event"""
        self.set_company_context(company_id)
        self.publish_visitor_event('visit.checked_in', {
            'visit_id': visit_id,
            'visitor_id': visitor_id,
            'visitor_name': visitor_name,
            'host_employee_id': host_employee_id,
            'check_in_time': check_in_time
        })
    
    def publish_visit_checked_out(self, visit_id: str, visitor_id: str,
                                  visitor_name: str, check_out_time: str,
                                  company_id: str):
        """Publish visit.checked_out event"""
        self.set_company_context(company_id)
        self.publish_visitor_event('visit.checked_out', {
            'visit_id': visit_id,
            'visitor_id': visitor_id,
            'visitor_name': visitor_name,
            'check_out_time': check_out_time
        })
    
    def _log_access(self, resource_type: str, resource_id: str, action: str, 
                    result: str, metadata: Dict = None):
        """Log access attempt - stub for when audit logger is not available"""
        try:
            from app.services.audit_logger import audit_logger
            audit_logger.log_access(
                app_id=self.app_id,
                company_id=self.company_id,
                resource_type=resource_type,
                resource_id=resource_id,
                action=action,
                capability=f'{resource_type}:{action}',
                result=result,
                metadata=metadata or {}
            )
        except ImportError:
            # Audit logger not available - log to console
            pass


# Singleton instance
vms_integration = VMSIntegrationHelper()
