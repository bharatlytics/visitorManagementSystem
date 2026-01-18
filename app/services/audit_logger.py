"""
Audit Logger Service

Complete audit trail for all VMS actions:
- Tracks who, what, when, where
- Captures before/after state changes
- Supports compliance reporting
"""
from datetime import datetime, timezone
from bson import ObjectId
from flask import request, has_request_context
import json

from app.db import get_db


def get_audit_collection():
    """Get the audit logs collection"""
    return get_db()['audit_logs']


def get_client_info() -> dict:
    """Extract client information from the current request"""
    if not has_request_context():
        return {
            'ip': 'system',
            'userAgent': 'system',
            'deviceId': None
        }
    
    return {
        'ip': request.headers.get('X-Forwarded-For', request.remote_addr),
        'userAgent': request.headers.get('User-Agent', 'unknown')[:200],
        'deviceId': request.headers.get('X-Device-Id'),
        'sessionId': request.headers.get('X-Session-Id')
    }


def log_action(
    action: str,
    entity_type: str,
    entity_id: str,
    company_id: str,
    user_id: str = None,
    user_name: str = None,
    user_role: str = None,
    before: dict = None,
    after: dict = None,
    details: dict = None,
    severity: str = 'info'
) -> ObjectId:
    """
    Log an action to the audit trail.
    
    Args:
        action: Action performed (create, update, delete, view, login, etc.)
        entity_type: Type of entity (visitor, visit, employee, settings, etc.)
        entity_id: ID of the entity
        company_id: Company context
        user_id: Who performed the action
        user_name: Display name of the user
        user_role: Role of the user (admin, host, security, etc.)
        before: State before the action (for updates)
        after: State after the action (for updates/creates)
        details: Additional details about the action
        severity: Log severity (info, warning, critical)
    
    Returns:
        ObjectId of the created audit log
    """
    audit_collection = get_audit_collection()
    
    # Get client info
    client_info = get_client_info()
    
    # Calculate changed fields if before/after provided
    changed_fields = []
    if before and after:
        for key in set(list(before.keys()) + list(after.keys())):
            before_val = before.get(key)
            after_val = after.get(key)
            if before_val != after_val:
                changed_fields.append({
                    'field': key,
                    'from': str(before_val)[:500] if before_val else None,
                    'to': str(after_val)[:500] if after_val else None
                })
    
    audit_doc = {
        '_id': ObjectId(),
        'timestamp': datetime.now(timezone.utc),
        'action': action,
        'entityType': entity_type,
        'entityId': str(entity_id) if entity_id else None,
        'companyId': company_id,
        'user': {
            'id': str(user_id) if user_id else None,
            'name': user_name,
            'role': user_role
        },
        'client': client_info,
        'changedFields': changed_fields if changed_fields else None,
        'details': details,
        'severity': severity
    }
    
    # Don't store full before/after for large objects
    if before and len(json.dumps(before, default=str)) < 10000:
        audit_doc['before'] = before
    if after and len(json.dumps(after, default=str)) < 10000:
        audit_doc['after'] = after
    
    audit_collection.insert_one(audit_doc)
    
    return audit_doc['_id']


# Convenience functions for common actions

def log_visitor_created(visitor: dict, company_id: str, user_id: str = None, user_name: str = None):
    """Log visitor creation"""
    log_action(
        action='visitor.created',
        entity_type='visitor',
        entity_id=visitor.get('_id'),
        company_id=company_id,
        user_id=user_id,
        user_name=user_name,
        after={
            'visitorName': visitor.get('visitorName'),
            'phone': visitor.get('phone'),
            'email': visitor.get('email'),
            'organization': visitor.get('organization'),
            'visitorType': visitor.get('visitorType')
        },
        details={'hasBiometric': bool(visitor.get('visitorImages'))}
    )


def log_visitor_updated(visitor_id: str, before: dict, after: dict, company_id: str, 
                       user_id: str = None, user_name: str = None):
    """Log visitor update"""
    log_action(
        action='visitor.updated',
        entity_type='visitor',
        entity_id=visitor_id,
        company_id=company_id,
        user_id=user_id,
        user_name=user_name,
        before=before,
        after=after
    )


def log_visitor_deleted(visitor_id: str, visitor_name: str, company_id: str,
                       user_id: str = None, user_name: str = None):
    """Log visitor deletion"""
    log_action(
        action='visitor.deleted',
        entity_type='visitor',
        entity_id=visitor_id,
        company_id=company_id,
        user_id=user_id,
        user_name=user_name,
        details={'visitorName': visitor_name}
    )


def log_visit_checkin(visit: dict, company_id: str, method: str = 'manual'):
    """Log visitor check-in"""
    log_action(
        action='visit.checkin',
        entity_type='visit',
        entity_id=visit.get('_id'),
        company_id=company_id,
        details={
            'visitorId': str(visit.get('visitorId')),
            'visitorName': visit.get('visitorName'),
            'hostEmployeeId': visit.get('hostEmployeeId'),
            'method': method
        }
    )


def log_visit_checkout(visit: dict, company_id: str, method: str = 'manual'):
    """Log visitor check-out"""
    log_action(
        action='visit.checkout',
        entity_type='visit',
        entity_id=visit.get('_id'),
        company_id=company_id,
        details={
            'visitorId': str(visit.get('visitorId')),
            'visitorName': visit.get('visitorName'),
            'method': method,
            'duration': visit.get('durationMinutes')
        }
    )


def log_blacklist_action(visitor_id: str, visitor_name: str, action_type: str,
                        reason: str, company_id: str, user_id: str = None):
    """Log blacklist/unblacklist action"""
    log_action(
        action=f'visitor.{action_type}',
        entity_type='visitor',
        entity_id=visitor_id,
        company_id=company_id,
        user_id=user_id,
        details={
            'visitorName': visitor_name,
            'reason': reason
        },
        severity='warning' if action_type == 'blacklisted' else 'info'
    )


def log_security_alert(alert_type: str, details: dict, company_id: str, severity: str = 'warning'):
    """Log security alerts"""
    log_action(
        action=f'security.{alert_type}',
        entity_type='security',
        entity_id=None,
        company_id=company_id,
        details=details,
        severity=severity
    )


def log_approval_action(approval_id: str, action: str, approver_id: str, 
                       approver_name: str, company_id: str, comment: str = None):
    """Log approval workflow actions"""
    log_action(
        action=f'approval.{action}',
        entity_type='approval',
        entity_id=approval_id,
        company_id=company_id,
        user_id=approver_id,
        user_name=approver_name,
        details={'comment': comment}
    )


def log_settings_changed(setting_name: str, before_value, after_value, 
                        company_id: str, user_id: str = None):
    """Log settings changes"""
    log_action(
        action='settings.changed',
        entity_type='settings',
        entity_id=setting_name,
        company_id=company_id,
        user_id=user_id,
        before={'value': before_value},
        after={'value': after_value}
    )


def log_evacuation_event(event_type: str, evacuation_id: str, details: dict, 
                        company_id: str, user_id: str = None):
    """Log evacuation events"""
    log_action(
        action=f'evacuation.{event_type}',
        entity_type='evacuation',
        entity_id=evacuation_id,
        company_id=company_id,
        user_id=user_id,
        details=details,
        severity='critical' if event_type == 'triggered' else 'info'
    )


def log_login(user_id: str, user_email: str, company_id: str, success: bool, 
              failure_reason: str = None):
    """Log login attempts"""
    log_action(
        action='auth.login' if success else 'auth.login_failed',
        entity_type='user',
        entity_id=user_id,
        company_id=company_id,
        user_id=user_id,
        details={
            'email': user_email,
            'success': success,
            'failureReason': failure_reason
        },
        severity='info' if success else 'warning'
    )


def log_data_export(export_type: str, entity_type: str, entity_id: str,
                   company_id: str, user_id: str = None):
    """Log data exports (GDPR compliance)"""
    log_action(
        action=f'data.{export_type}',
        entity_type=entity_type,
        entity_id=entity_id,
        company_id=company_id,
        user_id=user_id,
        details={'exportType': export_type}
    )


def log_data_purge(entity_type: str, entity_id: str, company_id: str,
                  user_id: str = None, reason: str = None):
    """Log data purges (GDPR right to be forgotten)"""
    log_action(
        action='data.purged',
        entity_type=entity_type,
        entity_id=entity_id,
        company_id=company_id,
        user_id=user_id,
        details={'reason': reason},
        severity='warning'
    )
