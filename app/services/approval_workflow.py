"""
Approval Workflow Engine

Configurable multi-level approval chains for visitor management:
- Define approval rules per visitor type
- Sequential or parallel approvals
- Auto-escalation on timeout
- Delegation support for absent approvers
"""
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from enum import Enum

from app.db import get_db, visit_collection, employee_collection
from app.utils import get_current_utc


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"
    DELEGATED = "delegated"
    EXPIRED = "expired"


class ApprovalMode(str, Enum):
    SEQUENTIAL = "sequential"  # One after another
    PARALLEL = "parallel"      # All at once, all must approve
    ANY = "any"               # Any one approver is sufficient


def get_approval_rules_collection():
    """Get the approval rules collection"""
    return get_db()['approval_rules']


def get_approvals_collection():
    """Get the approvals collection"""
    return get_db()['approvals']


def get_default_approval_chain(visitor_type: str, company_id: str) -> dict:
    """
    Get the default approval chain for a visitor type.
    
    Returns a chain configuration or None if no approval needed.
    """
    # Check for custom rules first
    rules_collection = get_approval_rules_collection()
    
    rule = rules_collection.find_one({
        'companyId': company_id,
        'visitorType': visitor_type,
        'active': True
    })
    
    if rule:
        return rule
    
    # Default rules based on visitor type
    default_rules = {
        'contractor': {
            'mode': ApprovalMode.SEQUENTIAL,
            'levels': [
                {'role': 'host', 'timeoutHours': 24},
                {'role': 'manager', 'timeoutHours': 48}
            ],
            'requiresApproval': True
        },
        'vendor': {
            'mode': ApprovalMode.SEQUENTIAL,
            'levels': [
                {'role': 'host', 'timeoutHours': 24},
                {'role': 'procurement', 'timeoutHours': 48}
            ],
            'requiresApproval': True
        },
        'interview': {
            'mode': ApprovalMode.SEQUENTIAL,
            'levels': [
                {'role': 'host', 'timeoutHours': 12}
            ],
            'requiresApproval': True
        },
        'vip': {
            'mode': ApprovalMode.SEQUENTIAL,
            'levels': [
                {'role': 'host', 'timeoutHours': 4}  # Fast-track VIPs
            ],
            'requiresApproval': True
        },
        'guest': {
            'mode': ApprovalMode.ANY,
            'levels': [
                {'role': 'host', 'timeoutHours': 24}
            ],
            'requiresApproval': False  # Optional approval
        }
    }
    
    return default_rules.get(visitor_type, {
        'mode': ApprovalMode.ANY,
        'levels': [],
        'requiresApproval': False
    })


def create_approval_request(visit_id: str, company_id: str, visitor_type: str, 
                            host_employee_id: str, requested_by: str = None) -> dict:
    """
    Create an approval request for a visit.
    
    Args:
        visit_id: The visit that needs approval
        company_id: Company context
        visitor_type: Type of visitor (determines approval chain)
        host_employee_id: The host employee ID
        requested_by: Who initiated the request
    
    Returns:
        Created approval request document
    """
    approvals_collection = get_approvals_collection()
    
    # Get approval chain for this visitor type
    chain = get_default_approval_chain(visitor_type, company_id)
    
    if not chain.get('levels'):
        # No approval needed
        return None
    
    # Get host employee details
    host = None
    try:
        host = employee_collection.find_one({'_id': ObjectId(host_employee_id)})
    except:
        host = employee_collection.find_one({'employeeId': host_employee_id})
    
    # Build approval levels
    levels = []
    for idx, level_config in enumerate(chain.get('levels', [])):
        level = {
            'level': idx + 1,
            'role': level_config.get('role'),
            'status': ApprovalStatus.PENDING if idx == 0 else 'waiting',
            'approverId': None,
            'approverName': None,
            'comment': None,
            'actionAt': None,
            'timeoutHours': level_config.get('timeoutHours', 24),
            'timeoutAt': None
        }
        
        # If role is 'host', set the approver to the host employee
        if level_config.get('role') == 'host' and host:
            level['approverId'] = str(host.get('_id'))
            level['approverName'] = host.get('employeeName')
            
            # Set timeout
            if idx == 0:  # First level - set timeout
                level['timeoutAt'] = get_current_utc() + timedelta(
                    hours=level_config.get('timeoutHours', 24)
                )
        
        levels.append(level)
    
    approval_doc = {
        '_id': ObjectId(),
        'visitId': ObjectId(visit_id),
        'companyId': company_id,
        'visitorType': visitor_type,
        'mode': chain.get('mode', ApprovalMode.SEQUENTIAL),
        'status': ApprovalStatus.PENDING,
        'currentLevel': 1,
        'totalLevels': len(levels),
        'levels': levels,
        'requiresApproval': chain.get('requiresApproval', True),
        'requestedBy': requested_by,
        'requestedAt': get_current_utc(),
        'completedAt': None,
        'escalated': False,
        'delegations': []
    }
    
    approvals_collection.insert_one(approval_doc)
    
    # Update visit with approval reference
    visit_collection.update_one(
        {'_id': ObjectId(visit_id)},
        {
            '$set': {
                'approvalId': approval_doc['_id'],
                'approvalStatus': ApprovalStatus.PENDING,
                'requiresApproval': chain.get('requiresApproval', True)
            }
        }
    )
    
    # TODO: Send notification to first-level approver
    
    return approval_doc


def process_approval_action(approval_id: str, approver_id: str, action: str, 
                           comment: str = None) -> dict:
    """
    Process an approval or rejection action.
    
    Args:
        approval_id: The approval request ID
        approver_id: Who is taking the action
        action: 'approve' or 'reject'
        comment: Optional comment
    
    Returns:
        Updated approval document
    """
    approvals_collection = get_approvals_collection()
    
    approval = approvals_collection.find_one({'_id': ObjectId(approval_id)})
    if not approval:
        raise ValueError("Approval request not found")
    
    if approval['status'] not in [ApprovalStatus.PENDING, 'waiting']:
        raise ValueError(f"Approval is already {approval['status']}")
    
    current_level = approval['currentLevel']
    levels = approval['levels']
    
    # Find current pending level
    current_level_data = None
    for level in levels:
        if level['level'] == current_level and level['status'] == ApprovalStatus.PENDING:
            current_level_data = level
            break
    
    if not current_level_data:
        raise ValueError("No pending approval at current level")
    
    # Verify approver
    if current_level_data['approverId'] and current_level_data['approverId'] != approver_id:
        # Check if delegated
        is_delegate = any(
            d.get('delegateId') == approver_id and d.get('level') == current_level
            for d in approval.get('delegations', [])
        )
        if not is_delegate:
            raise ValueError("Not authorized to approve at this level")
    
    # Get approver details
    approver = None
    try:
        approver = employee_collection.find_one({'_id': ObjectId(approver_id)})
    except:
        approver = employee_collection.find_one({'employeeId': approver_id})
    
    approver_name = approver.get('employeeName', 'Unknown') if approver else 'Unknown'
    
    # Process action
    now = get_current_utc()
    
    if action == 'reject':
        # Rejection at any level fails the entire approval
        current_level_data['status'] = ApprovalStatus.REJECTED
        current_level_data['approverId'] = approver_id
        current_level_data['approverName'] = approver_name
        current_level_data['comment'] = comment
        current_level_data['actionAt'] = now
        
        approval['status'] = ApprovalStatus.REJECTED
        approval['completedAt'] = now
        
        # Update visit status
        visit_collection.update_one(
            {'_id': approval['visitId']},
            {
                '$set': {
                    'approvalStatus': ApprovalStatus.REJECTED,
                    'status': 'cancelled',
                    'cancelReason': f'Approval rejected: {comment or "No reason provided"}'
                }
            }
        )
        
    elif action == 'approve':
        current_level_data['status'] = ApprovalStatus.APPROVED
        current_level_data['approverId'] = approver_id
        current_level_data['approverName'] = approver_name
        current_level_data['comment'] = comment
        current_level_data['actionAt'] = now
        
        # Check if all levels are complete
        if current_level >= approval['totalLevels']:
            # Final approval
            approval['status'] = ApprovalStatus.APPROVED
            approval['completedAt'] = now
            
            # Update visit status - change from pending_approval to scheduled
            visit_collection.update_one(
                {'_id': approval['visitId']},
                {'$set': {
                    'approvalStatus': ApprovalStatus.APPROVED,
                    'status': 'scheduled',  # Change from pending_approval to scheduled
                    'approvedAt': now,
                    'approvedBy': approver_id
                }}
            )
        else:
            # Move to next level
            next_level = current_level + 1
            approval['currentLevel'] = next_level
            
            # Update next level status to pending
            for level in levels:
                if level['level'] == next_level:
                    level['status'] = ApprovalStatus.PENDING
                    level['timeoutAt'] = now + timedelta(hours=level.get('timeoutHours', 24))
                    break
            
            # TODO: Send notification to next-level approver
    
    # Save updates
    approvals_collection.update_one(
        {'_id': ObjectId(approval_id)},
        {'$set': {
            'status': approval['status'],
            'currentLevel': approval.get('currentLevel', current_level),
            'levels': levels,
            'completedAt': approval.get('completedAt')
        }}
    )
    
    return approval


def delegate_approval(approval_id: str, from_approver_id: str, to_approver_id: str, 
                     reason: str = None) -> dict:
    """
    Delegate an approval to another person.
    
    Args:
        approval_id: The approval request ID
        from_approver_id: Original approver
        to_approver_id: Delegate
        reason: Reason for delegation
    
    Returns:
        Updated approval document
    """
    approvals_collection = get_approvals_collection()
    
    approval = approvals_collection.find_one({'_id': ObjectId(approval_id)})
    if not approval:
        raise ValueError("Approval request not found")
    
    current_level = approval['currentLevel']
    
    # Verify the original approver is the current approver
    current_level_data = None
    for level in approval['levels']:
        if level['level'] == current_level:
            current_level_data = level
            break
    
    if not current_level_data or current_level_data.get('approverId') != from_approver_id:
        raise ValueError("Not authorized to delegate")
    
    # Get delegate details
    delegate = None
    try:
        delegate = employee_collection.find_one({'_id': ObjectId(to_approver_id)})
    except:
        delegate = employee_collection.find_one({'employeeId': to_approver_id})
    
    if not delegate:
        raise ValueError("Delegate not found")
    
    # Add delegation record
    delegation = {
        'level': current_level,
        'fromId': from_approver_id,
        'delegateId': to_approver_id,
        'delegateName': delegate.get('employeeName'),
        'reason': reason,
        'delegatedAt': get_current_utc()
    }
    
    # Update current level with delegate info
    current_level_data['delegatedTo'] = to_approver_id
    current_level_data['delegateName'] = delegate.get('employeeName')
    current_level_data['status'] = ApprovalStatus.DELEGATED
    
    approvals_collection.update_one(
        {'_id': ObjectId(approval_id)},
        {
            '$push': {'delegations': delegation},
            '$set': {'levels': approval['levels']}
        }
    )
    
    # TODO: Send notification to delegate
    
    return approval


def check_expired_approvals(company_id: str = None) -> int:
    """
    Check for and escalate expired approvals.
    
    Approvals that have passed their timeout are escalated or auto-rejected.
    
    Args:
        company_id: Optional company filter
    
    Returns:
        Number of approvals processed
    """
    approvals_collection = get_approvals_collection()
    now = get_current_utc()
    processed = 0
    
    query = {'status': ApprovalStatus.PENDING}
    if company_id:
        query['companyId'] = company_id
    
    pending_approvals = list(approvals_collection.find(query))
    
    for approval in pending_approvals:
        current_level = approval['currentLevel']
        
        for level in approval['levels']:
            if level['level'] == current_level and level.get('timeoutAt'):
                timeout_at = level['timeoutAt']
                if isinstance(timeout_at, str):
                    timeout_at = datetime.fromisoformat(timeout_at.replace('Z', '+00:00'))
                
                if timeout_at < now:
                    # Approval has timed out
                    level['status'] = ApprovalStatus.EXPIRED
                    approval['escalated'] = True
                    
                    # For now, auto-reject on timeout
                    # In production, you might escalate to a backup approver
                    approval['status'] = ApprovalStatus.EXPIRED
                    approval['completedAt'] = now
                    
                    approvals_collection.update_one(
                        {'_id': approval['_id']},
                        {'$set': {
                            'status': approval['status'],
                            'escalated': approval['escalated'],
                            'levels': approval['levels'],
                            'completedAt': approval['completedAt']
                        }}
                    )
                    
                    # Update visit
                    visit_collection.update_one(
                        {'_id': approval['visitId']},
                        {
                            '$set': {
                                'approvalStatus': ApprovalStatus.EXPIRED,
                                'status': 'cancelled',
                                'cancelReason': 'Approval expired - no response within timeout'
                            }
                        }
                    )
                    
                    processed += 1
                    print(f"[Approval] Expired approval {approval['_id']}")
    
    return processed


def get_pending_approvals_for_user(approver_id: str, company_id: str = None) -> list:
    """
    Get all pending approvals for a specific approver.
    
    Args:
        approver_id: The approver's employee ID
        company_id: Optional company filter
    
    Returns:
        List of pending approvals
    """
    approvals_collection = get_approvals_collection()
    
    query = {
        'status': ApprovalStatus.PENDING,
        'levels': {
            '$elemMatch': {
                'approverId': approver_id,
                'status': ApprovalStatus.PENDING
            }
        }
    }
    
    if company_id:
        query['companyId'] = company_id
    
    approvals = list(approvals_collection.find(query))
    
    # Also check delegations
    delegation_query = {
        'status': ApprovalStatus.PENDING,
        'delegations.delegateId': approver_id
    }
    if company_id:
        delegation_query['companyId'] = company_id
    
    delegated = list(approvals_collection.find(delegation_query))
    
    # Combine and deduplicate
    all_approvals = {str(a['_id']): a for a in approvals}
    for d in delegated:
        all_approvals[str(d['_id'])] = d
    
    return list(all_approvals.values())
