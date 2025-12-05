"""
Dashboard API - Stats and analytics
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta

from app.db import visits_collection, visitors_collection
from app.auth import require_auth

dashboard_bp = Blueprint('dashboard', __name__)


@dashboard_bp.route('/stats', methods=['GET'])
@require_auth
def get_stats():
    """Get dashboard statistics"""
    company_id = request.args.get('companyId') or request.company_id
    company_oid = ObjectId(company_id)
    
    now = datetime.utcnow()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    # Current Visitors (Checked In)
    current_visitors = visits_collection.count_documents({
        'companyId': company_oid,
        'status': 'checked_in'
    })
    
    # Expected Today
    expected_today = visits_collection.count_documents({
        'companyId': company_oid,
        'expectedArrival': {'$gte': start_of_day, '$lt': end_of_day},
        'status': 'scheduled'
    })
    
    # Checked In Today
    checked_in_today = visits_collection.count_documents({
        'companyId': company_oid,
        'actualArrival': {'$gte': start_of_day, '$lt': end_of_day}
    })
    
    # Checked Out Today
    checked_out_today = visits_collection.count_documents({
        'companyId': company_oid,
        'actualDeparture': {'$gte': start_of_day, '$lt': end_of_day}
    })
    
    # Total Visitors
    total_visitors = visitors_collection.count_documents({
        'companyId': company_oid
    })
    
    # Recent Activity
    recent_visits = list(visits_collection.find({
        'companyId': company_oid
    }).sort('lastUpdated', -1).limit(10))
    
    activity = []
    for v in recent_visits:
        activity.append({
            'visitorName': v.get('visitorName', 'Unknown'),
            'status': v.get('status', 'unknown').replace('_', ' ').title(),
            'time': v.get('lastUpdated').isoformat() if v.get('lastUpdated') else None,
            'visitId': str(v['_id']),
            'hostName': v.get('hostEmployeeName')
        })
    
    return jsonify({
        'currentVisitors': current_visitors,
        'expectedToday': expected_today,
        'checkedInToday': checked_in_today,
        'checkedOutToday': checked_out_today,
        'totalVisitors': total_visitors,
        'recentActivity': activity
    })


@dashboard_bp.route('/trends', methods=['GET'])
@require_auth
def get_trends():
    """Get visitor trends (last 7 days)"""
    company_id = request.args.get('companyId') or request.company_id
    
    now = datetime.utcnow()
    seven_days_ago = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    
    pipeline = [
        {
            '$match': {
                'companyId': ObjectId(company_id),
                'actualArrival': {'$gte': seven_days_ago}
            }
        },
        {
            '$group': {
                '_id': {'$dateToString': {'format': '%Y-%m-%d', 'date': '$actualArrival'}},
                'count': {'$sum': 1}
            }
        },
        {'$sort': {'_id': 1}}
    ]
    
    daily_counts = list(visits_collection.aggregate(pipeline))
    date_map = {item['_id']: item['count'] for item in daily_counts}
    
    trends = []
    current_date = seven_days_ago
    for _ in range(7):
        date_str = current_date.strftime('%Y-%m-%d')
        trends.append({'date': date_str, 'count': date_map.get(date_str, 0)})
        current_date += timedelta(days=1)
    
    return jsonify({'trends': trends})
