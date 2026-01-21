"""
VMS Role-Based Access Control (RBAC) Service

Standalone RBAC system for VMS independent operation.
When integrated with Platform, can sync roles from Platform.

Roles:
- super_admin: Full system access (multi-company, VMS admin)
- company_admin: Full access within their company
- manager: Manage employees, approve visitors, view reports
- receptionist: Register visitors, check-in/out, manage visits
- security_guard: View visitors, check-in at gates, blacklist
- host: View own visitors, approve/reject visitors meeting them
- readonly: View-only access to dashboards

Permissions follow pattern: resource.action
- visitors.create, visitors.read, visitors.update, visitors.delete
- employees.*, visits.*, devices.*, settings.*, reports.*, etc.
"""
from functools import wraps
from flask import request, jsonify, session
from typing import List, Dict, Optional, Set

# Role hierarchy: Higher roles inherit all permissions of lower roles
ROLE_HIERARCHY = {
    'super_admin': ['company_admin', 'manager', 'receptionist', 'security_guard', 'host', 'readonly'],
    'company_admin': ['manager', 'receptionist', 'security_guard', 'host', 'readonly'],
    'manager': ['receptionist', 'host', 'readonly'],
    'receptionist': ['readonly'],
    'security_guard': ['readonly'],
    'host': ['readonly'],
    'readonly': []
}

# Permission definitions per role
ROLE_PERMISSIONS: Dict[str, Set[str]] = {
    'super_admin': {
        # System-level
        'system.*',
        'companies.*',
        'users.*',
        # All resources
        '*.*'
    },
    'company_admin': {
        # Company management
        'company.read', 'company.update',
        'users.*',
        'settings.*',
        'devices.*',
        # All operational
        'visitors.*',
        'employees.*',
        'visits.*',
        'reports.*',
        'analytics.*',
        'audit.*',
        'watchlist.*',
        'approvals.*',
        'preregistration.*',
        'evacuation.*',
        'access_control.*',
        'api_keys.*',
        'webhooks.*',
        'gdpr.*'
    },
    'manager': {
        # Personnel management
        'employees.read', 'employees.create', 'employees.update',
        # Visitor operations
        'visitors.*',
        'visits.*',
        'approvals.*',
        'preregistration.*',
        # Reports
        'reports.read',
        'analytics.read',
        'audit.read',
        # Watchlist
        'watchlist.read', 'watchlist.create',
        # Emergency
        'evacuation.read', 'evacuation.trigger'
    },
    'receptionist': {
        # Visitor registration
        'visitors.create', 'visitors.read', 'visitors.update',
        # Visit management
        'visits.create', 'visits.read', 'visits.update',
        'visits.checkin', 'visits.checkout',
        # Pre-registration
        'preregistration.read', 'preregistration.create',
        # Badge printing
        'badge.print',
        # Read-only for others
        'employees.read',
        'devices.read',
        'evacuation.read'
    },
    'security_guard': {
        # Gate operations
        'visitors.read',
        'visits.read', 'visits.checkin', 'visits.checkout',
        # Blacklist access
        'watchlist.read', 'watchlist.create',
        # Employees for verification
        'employees.read',
        # Emergency
        'evacuation.read', 'evacuation.trigger',
        # Access control
        'access_control.verify'
    },
    'host': {
        # Own visitors only (filtered by API)
        'visitors.read',
        'visits.read',
        # Approvals for self
        'approvals.read', 'approvals.approve', 'approvals.reject',
        # View colleagues
        'employees.read'
    },
    'readonly': {
        # Dashboard view
        'dashboard.read',
        'analytics.read',
        # Basic reads
        'visitors.read',
        'employees.read',
        'visits.read'
    }
}


def get_user_role() -> Optional[str]:
    """Get current user's role from session or token"""
    # Check session first (browser users)
    if session.get('user_role'):
        return session.get('user_role')
    
    # Check request attributes (set by auth decorators)
    if hasattr(request, 'user_role'):
        return request.user_role
    
    # Try to get from database
    if hasattr(request, 'user_id'):
        from app.db import users_collection
        from bson import ObjectId
        
        try:
            user = users_collection.find_one({'_id': ObjectId(request.user_id)})
            if user:
                return user.get('role', 'readonly')
        except:
            pass
    
    return None


def get_inherited_roles(role: str) -> Set[str]:
    """Get all roles inherited by a given role"""
    inherited = {role}
    if role in ROLE_HIERARCHY:
        for child_role in ROLE_HIERARCHY[role]:
            inherited.update(get_inherited_roles(child_role))
    return inherited


def get_role_permissions(role: str) -> Set[str]:
    """Get all permissions for a role, including inherited"""
    permissions = set()
    
    # Get permissions from this role and all inherited roles
    for r in get_inherited_roles(role):
        if r in ROLE_PERMISSIONS:
            permissions.update(ROLE_PERMISSIONS[r])
    
    return permissions


def has_permission(role: str, permission: str) -> bool:
    """
    Check if a role has a specific permission.
    
    Handles wildcards:
    - *.* matches everything
    - visitors.* matches visitors.create, visitors.read, etc.
    - visitors.create matches exactly
    """
    permissions = get_role_permissions(role)
    
    # Check for exact match
    if permission in permissions:
        return True
    
    # Check for wildcard matches
    resource, action = permission.split('.') if '.' in permission else (permission, '*')
    
    # Check for *.* (super wildcard)
    if '*.*' in permissions:
        return True
    
    # Check for resource.* (resource wildcard)
    if f'{resource}.*' in permissions:
        return True
    
    return False


def require_permission(permission: str):
    """
    Decorator to require a specific permission.
    
    Usage:
        @require_permission('visitors.create')
        def create_visitor():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            role = get_user_role()
            
            if not role:
                return jsonify({'error': 'Authentication required'}), 401
            
            if not has_permission(role, permission):
                return jsonify({
                    'error': 'Permission denied',
                    'required': permission,
                    'yourRole': role
                }), 403
            
            return f(*args, **kwargs)
        return decorated
    return decorator


def require_role(required_role: str):
    """
    Decorator to require a minimum role level.
    
    Usage:
        @require_role('manager')
        def manage_employees():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user_role = get_user_role()
            
            if not user_role:
                return jsonify({'error': 'Authentication required'}), 401
            
            # Check if user's role includes the required role
            user_roles = get_inherited_roles(user_role)
            
            if required_role not in user_roles and user_role != required_role:
                return jsonify({
                    'error': 'Insufficient role privileges',
                    'required': required_role,
                    'yourRole': user_role
                }), 403
            
            return f(*args, **kwargs)
        return decorated
    return decorator


def require_any_role(roles: List[str]):
    """
    Decorator to require any one of the specified roles.
    
    Usage:
        @require_any_role(['receptionist', 'security_guard'])
        def check_in_visitor():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user_role = get_user_role()
            
            if not user_role:
                return jsonify({'error': 'Authentication required'}), 401
            
            # Get all roles the user has (including inherited)
            user_roles = get_inherited_roles(user_role)
            
            # Check if any required role is in user's roles
            if not any(r in user_roles or r == user_role for r in roles):
                return jsonify({
                    'error': 'Insufficient role privileges',
                    'requiredOneOf': roles,
                    'yourRole': user_role
                }), 403
            
            return f(*args, **kwargs)
        return decorated
    return decorator


# Available roles for user assignment
AVAILABLE_ROLES = [
    {'id': 'company_admin', 'name': 'Company Admin', 'description': 'Full company access'},
    {'id': 'manager', 'name': 'Manager', 'description': 'Manage employees, approve visitors'},
    {'id': 'receptionist', 'name': 'Receptionist', 'description': 'Manage visitor check-in/out'},
    {'id': 'security_guard', 'name': 'Security Guard', 'description': 'Gate operations, blacklist'},
    {'id': 'host', 'name': 'Host', 'description': 'Approve visitors for self only'},
    {'id': 'readonly', 'name': 'View Only', 'description': 'Dashboard view only'}
]


def get_available_roles() -> List[Dict]:
    """Get list of roles available for assignment"""
    return AVAILABLE_ROLES
