"""
Watchlist & Security API
Handles blacklist, watchlist, and security alerts
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime

from app.db import visitor_collection, visit_collection
from app.auth import require_auth

security_bp = Blueprint('vms_security', __name__)


# Watchlist collection (we'll use a field on visitors for simplicity)
# visitor.securityStatus: 'clear' | 'watchlist' | 'blacklisted'


@security_bp.route('/watchlist', methods=['GET'])
@require_auth
def get_watchlist():
    """Get watchlist and blacklist entries"""
    company_id = request.args.get('companyId') or request.company_id
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    try:
        company_oid = ObjectId(company_id)
        query = {
            '$or': [{'companyId': company_oid}, {'companyId': company_id}],
            'securityStatus': {'$in': ['watchlist', 'blacklisted']}
        }
    except:
        query = {
            'companyId': company_id,
            'securityStatus': {'$in': ['watchlist', 'blacklisted']}
        }
    
    entries = list(visitor_collection.find(query))
    
    for v in entries:
        v['_id'] = str(v['_id'])
        v['companyId'] = str(v.get('companyId', ''))
    
    return jsonify(entries)


@security_bp.route('/watchlist/<visitor_id>', methods=['POST'])
@require_auth
def add_to_watchlist(visitor_id):
    """Add visitor to watchlist"""
    data = request.json or {}
    status = data.get('status', 'watchlist')  # watchlist or blacklisted
    reason = data.get('reason', '')
    
    if status not in ['watchlist', 'blacklisted']:
        return jsonify({'error': 'Invalid status'}), 400
    
    result = visitor_collection.update_one(
        {'_id': ObjectId(visitor_id)},
        {'$set': {
            'securityStatus': status,
            'securityReason': reason,
            'securityUpdatedAt': datetime.utcnow(),
            'securityUpdatedBy': data.get('updatedBy')
        }}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Visitor not found'}), 404
    
    return jsonify({'message': f'Added to {status}'})


@security_bp.route('/watchlist/<visitor_id>', methods=['DELETE'])
@require_auth
def remove_from_watchlist(visitor_id):
    """Remove visitor from watchlist/blacklist"""
    result = visitor_collection.update_one(
        {'_id': ObjectId(visitor_id)},
        {'$set': {
            'securityStatus': 'clear',
            'securityReason': '',
            'securityUpdatedAt': datetime.utcnow()
        }}
    )
    
    if result.matched_count == 0:
        return jsonify({'error': 'Visitor not found'}), 404
    
    return jsonify({'message': 'Removed from watchlist'})


@security_bp.route('/check/<visitor_id>', methods=['GET'])
@require_auth
def check_security_status(visitor_id):
    """Check if visitor is on watchlist/blacklist"""
    visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id)})
    
    if not visitor:
        return jsonify({'error': 'Visitor not found'}), 404
    
    status = visitor.get('securityStatus', 'clear')
    
    return jsonify({
        'visitorId': str(visitor['_id']),
        'visitorName': visitor.get('visitorName'),
        'securityStatus': status,
        'reason': visitor.get('securityReason', ''),
        'isBlocked': status == 'blacklisted',
        'requiresAttention': status in ['watchlist', 'blacklisted']
    })


@security_bp.route('/alerts', methods=['GET'])
@require_auth
def get_security_alerts():
    """Get recent security alerts"""
    company_id = request.args.get('companyId') or request.company_id
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
    
    try:
        company_oid = ObjectId(company_id)
        company_query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
    except:
        company_query = {'companyId': company_id}
    
    now = datetime.utcnow()
    
    alerts = []
    
    # 1. Blacklisted visitors who checked in (should not happen but flag it)
    blacklisted_checkins = list(visit_collection.find({
        **company_query,
        'status': 'checked_in'
    }).limit(50))
    
    for visit in blacklisted_checkins:
        visitor = visitor_collection.find_one({'_id': visit.get('visitorId')})
        if visitor and visitor.get('securityStatus') == 'blacklisted':
            alerts.append({
                'type': 'BLACKLISTED_ENTRY',
                'severity': 'critical',
                'visitId': str(visit['_id']),
                'visitorName': visit.get('visitorName'),
                'reason': visitor.get('securityReason', 'Blacklisted visitor'),
                'time': visit.get('actualArrival').isoformat() if visit.get('actualArrival') else None
            })
    
    # 2. Watchlist visitors currently inside
    for visit in blacklisted_checkins:
        visitor = visitor_collection.find_one({'_id': visit.get('visitorId')})
        if visitor and visitor.get('securityStatus') == 'watchlist':
            alerts.append({
                'type': 'WATCHLIST_ENTRY',
                'severity': 'warning',
                'visitId': str(visit['_id']),
                'visitorName': visit.get('visitorName'),
                'reason': visitor.get('securityReason', 'On watchlist'),
                'time': visit.get('actualArrival').isoformat() if visit.get('actualArrival') else None
            })
    
    # 3. Overstayed visitors (> 10 hours)
    overstayed_visits = list(visit_collection.find({
        **company_query,
        'status': 'checked_in',
        'actualArrival': {'$lt': datetime(now.year, now.month, now.day, now.hour - 10, now.minute) if now.hour >= 10 else None}
    }).limit(20))
    
    for visit in overstayed_visits:
        if visit.get('actualArrival'):
            hours = (now - visit['actualArrival']).total_seconds() / 3600
            if hours > 10:
                alerts.append({
                    'type': 'OVERSTAY',
                    'severity': 'warning',
                    'visitId': str(visit['_id']),
                    'visitorName': visit.get('visitorName'),
                    'reason': f'Inside for {round(hours, 1)} hours',
                    'time': visit.get('actualArrival').isoformat()
                })
    
    # 4. Pending approvals
    pending = visit_collection.count_documents({
        **company_query,
        'requiresApproval': True,
        'approvalStatus': 'pending'
    })
    
    if pending > 0:
        alerts.append({
            'type': 'PENDING_APPROVAL',
            'severity': 'info',
            'count': pending,
            'reason': f'{pending} visit(s) awaiting approval'
        })
    
    # Sort by severity
    severity_order = {'critical': 0, 'warning': 1, 'info': 2}
    alerts.sort(key=lambda x: severity_order.get(x.get('severity', 'info'), 3))
    
    return jsonify({
        'alerts': alerts,
        'totalCount': len(alerts),
        'criticalCount': len([a for a in alerts if a.get('severity') == 'critical']),
        'warningCount': len([a for a in alerts if a.get('severity') == 'warning'])
    })
