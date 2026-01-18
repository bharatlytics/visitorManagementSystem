"""
Approvals API

REST endpoints for the approval workflow system:
- View pending approvals
- Approve/reject visits
- Delegate approvals
- View approval history
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime

from app.db import get_db, visit_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc
from app.services.approval_workflow import (
    create_approval_request, process_approval_action, delegate_approval,
    get_pending_approvals_for_user, check_expired_approvals, ApprovalStatus
)

approvals_bp = Blueprint('approvals', __name__)


def convert_objectids(obj):
    """Recursively convert ObjectIds to strings"""
    if isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(i) for i in obj]
    elif isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


@approvals_bp.route('/pending', methods=['GET'])
@require_company_access
def get_pending_approvals():
    """
    Get pending approvals for the current user.
    
    Query Parameters:
        companyId (required): Company ObjectId
        approverId (optional): Filter by specific approver (default: current user)
    
    Returns:
        Array of pending approval requests with visit details
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        approver_id = request.args.get('approverId') or getattr(request, 'user_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        if not approver_id:
            return jsonify({'error': 'Approver ID is required'}), 400
        
        approvals = get_pending_approvals_for_user(approver_id, company_id)
        
        # Enrich with visit details
        result = []
        for approval in approvals:
            visit = visit_collection.find_one({'_id': approval.get('visitId')})
            
            result.append({
                'approvalId': str(approval['_id']),
                'visitId': str(approval.get('visitId')),
                'visitorType': approval.get('visitorType'),
                'currentLevel': approval.get('currentLevel'),
                'totalLevels': approval.get('totalLevels'),
                'requestedAt': approval.get('requestedAt'),
                'visit': convert_objectids(visit) if visit else None,
                'levels': convert_objectids(approval.get('levels', []))
            })
        
        return jsonify({
            'pendingApprovals': result,
            'count': len(result)
        }), 200
        
    except Exception as e:
        print(f"Error getting pending approvals: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/<approval_id>/approve', methods=['POST'])
@require_company_access
def approve_visit(approval_id):
    """
    Approve a pending visit.
    
    Request Body:
        approverId (required): Who is approving
        comment (optional): Approval comment
    """
    try:
        data = request.json or {}
        approver_id = data.get('approverId') or getattr(request, 'user_id', None)
        comment = data.get('comment')
        
        if not approver_id:
            return jsonify({'error': 'Approver ID is required'}), 400
        
        approval = process_approval_action(
            approval_id=approval_id,
            approver_id=approver_id,
            action='approve',
            comment=comment
        )
        
        return jsonify({
            'message': 'Visit approved successfully',
            'approvalId': approval_id,
            'status': approval.get('status'),
            'nextLevel': approval.get('currentLevel') if approval.get('status') == ApprovalStatus.PENDING else None
        }), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error approving visit: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/<approval_id>/reject', methods=['POST'])
@require_company_access
def reject_visit(approval_id):
    """
    Reject a pending visit.
    
    Request Body:
        approverId (required): Who is rejecting
        reason (required): Reason for rejection
    """
    try:
        data = request.json or {}
        approver_id = data.get('approverId') or getattr(request, 'user_id', None)
        reason = data.get('reason')
        
        if not approver_id:
            return jsonify({'error': 'Approver ID is required'}), 400
        
        if not reason:
            return jsonify({'error': 'Rejection reason is required'}), 400
        
        approval = process_approval_action(
            approval_id=approval_id,
            approver_id=approver_id,
            action='reject',
            comment=reason
        )
        
        return jsonify({
            'message': 'Visit rejected',
            'approvalId': approval_id,
            'status': approval.get('status'),
            'reason': reason
        }), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error rejecting visit: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/<approval_id>/delegate', methods=['POST'])
@require_company_access
def delegate_visit_approval(approval_id):
    """
    Delegate approval to another person.
    
    Request Body:
        fromApproverId (required): Current approver
        toApproverId (required): Delegate
        reason (optional): Reason for delegation
    """
    try:
        data = request.json or {}
        from_approver = data.get('fromApproverId') or getattr(request, 'user_id', None)
        to_approver = data.get('toApproverId')
        reason = data.get('reason')
        
        if not from_approver:
            return jsonify({'error': 'From approver ID is required'}), 400
        
        if not to_approver:
            return jsonify({'error': 'Delegate ID is required'}), 400
        
        approval = delegate_approval(
            approval_id=approval_id,
            from_approver_id=from_approver,
            to_approver_id=to_approver,
            reason=reason
        )
        
        return jsonify({
            'message': 'Approval delegated successfully',
            'approvalId': approval_id,
            'delegatedTo': to_approver
        }), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error delegating approval: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/<approval_id>', methods=['GET'])
@require_company_access
def get_approval_details(approval_id):
    """Get details of a specific approval request"""
    try:
        db = get_db()
        approvals_collection = db['approvals']
        
        approval = approvals_collection.find_one({'_id': ObjectId(approval_id)})
        if not approval:
            return jsonify({'error': 'Approval not found'}), 404
        
        # Get visit details
        visit = visit_collection.find_one({'_id': approval.get('visitId')})
        
        return jsonify({
            'approval': convert_objectids(approval),
            'visit': convert_objectids(visit) if visit else None
        }), 200
        
    except Exception as e:
        print(f"Error getting approval: {e}")
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/history', methods=['GET'])
@require_company_access
def get_approval_history():
    """
    Get approval history.
    
    Query Parameters:
        companyId (required): Company ObjectId
        status (optional): Filter by status
        limit (optional): Number of records (default: 50)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        status = request.args.get('status')
        limit = int(request.args.get('limit', 50))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        approvals_collection = db['approvals']
        
        query = {'companyId': company_id}
        if status:
            query['status'] = status
        
        approvals = list(approvals_collection.find(query).sort('requestedAt', -1).limit(limit))
        
        return jsonify({
            'approvals': convert_objectids(approvals),
            'count': len(approvals)
        }), 200
        
    except Exception as e:
        print(f"Error getting approval history: {e}")
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/rules', methods=['GET'])
@require_company_access
def get_approval_rules():
    """Get configured approval rules for a company"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        rules_collection = db['approval_rules']
        
        rules = list(rules_collection.find({'companyId': company_id, 'active': True}))
        
        return jsonify({
            'rules': convert_objectids(rules),
            'count': len(rules)
        }), 200
        
    except Exception as e:
        print(f"Error getting approval rules: {e}")
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/rules', methods=['POST'])
@require_company_access
def create_approval_rule():
    """
    Create a custom approval rule.
    
    Request Body:
        companyId (required): Company ObjectId
        visitorType (required): Which visitor type this applies to
        mode (required): 'sequential', 'parallel', or 'any'
        levels (required): Array of approval levels
        requiresApproval (optional): Whether approval is mandatory
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        if not data.get('visitorType'):
            return jsonify({'error': 'Visitor type is required'}), 400
        
        if not data.get('levels'):
            return jsonify({'error': 'Approval levels are required'}), 400
        
        db = get_db()
        rules_collection = db['approval_rules']
        
        # Deactivate existing rule for this visitor type
        rules_collection.update_many(
            {'companyId': company_id, 'visitorType': data['visitorType']},
            {'$set': {'active': False}}
        )
        
        rule_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'visitorType': data['visitorType'],
            'mode': data.get('mode', 'sequential'),
            'levels': data['levels'],
            'requiresApproval': data.get('requiresApproval', True),
            'active': True,
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'system')
        }
        
        rules_collection.insert_one(rule_doc)
        
        return jsonify({
            'message': 'Approval rule created',
            'ruleId': str(rule_doc['_id'])
        }), 201
        
    except Exception as e:
        print(f"Error creating approval rule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approvals_bp.route('/check-expired', methods=['POST'])
@require_company_access
def check_expired():
    """
    Manually trigger check for expired approvals.
    
    This should normally be run by a scheduled job.
    """
    try:
        company_id = request.json.get('companyId') or getattr(request, 'company_id', None)
        
        processed = check_expired_approvals(company_id)
        
        return jsonify({
            'message': 'Expired approvals processed',
            'processedCount': processed
        }), 200
        
    except Exception as e:
        print(f"Error checking expired approvals: {e}")
        return jsonify({'error': str(e)}), 500
