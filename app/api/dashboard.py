"""
Dashboard API - Stats and analytics
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta

from app.db import visit_collection, visitor_collection, employee_collection
from app.auth import require_auth
from app.utils import get_current_utc, error_response, format_datetime

dashboard_bp = Blueprint('vms_dashboard', __name__)


@dashboard_bp.route('/stats', methods=['GET'])
@require_auth
def get_dashboard_stats():
    """Get dashboard statistics"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
            
        company_oid = ObjectId(company_id)
        now = get_current_utc()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        # Current Visitors (Checked In)
        current_visitors = visit_collection.count_documents({
            'companyId': company_oid,
            'status': 'checked_in'
        })
        
        # Expected Today (Scheduled for today, not yet checked in)
        expected_today = visit_collection.count_documents({
            'companyId': company_oid,
            'expectedArrival': {'$gte': start_of_day, '$lt': end_of_day},
            'status': 'scheduled'
        })
        
        # Checked In Today (Total check-ins today)
        checked_in_today = visit_collection.count_documents({
            'companyId': company_oid,
            'actualArrival': {'$gte': start_of_day, '$lt': end_of_day}
        })
        
        # Checked Out Today
        checked_out_today = visit_collection.count_documents({
            'companyId': company_oid,
            'actualDeparture': {'$gte': start_of_day, '$lt': end_of_day}
        })
        
        # Recent Activity (Last 10 events)
        recent_visits = list(visit_collection.find({
            'companyId': company_oid,
            'lastUpdated': {'$exists': True}
        }).sort('lastUpdated', -1).limit(10))
        
        activity = []
        for v in recent_visits:
            visitor_name = v.get('visitorName')
            host_name = v.get('hostEmployeeName')
            
            # If visitor name is missing, fetch from visitor collection
            if not visitor_name:
                visitor_id = v.get('visitorId')
                if visitor_id:
                    visitor = visitor_collection.find_one({'_id': ObjectId(visitor_id) if isinstance(visitor_id, str) else visitor_id})
                    if visitor:
                        visitor_name = visitor.get('visitorName', 'Unknown')
                    else:
                        visitor_name = 'Unknown'
                else:
                    visitor_name = 'Unknown'
            
            # If host name is missing, fetch from employee collection
            if not host_name:
                host_id = v.get('hostEmployeeId')
                if host_id:
                    host = employee_collection.find_one({'_id': ObjectId(host_id) if isinstance(host_id, str) else host_id})
                    if host:
                        host_name = host.get('employeeName', 'Unknown')
                    else:
                        host_name = 'Unknown'
                else:
                    host_name = 'Unknown'
            
            activity.append({
                'visitorName': visitor_name,
                'action': v.get('status', 'unknown').replace('_', ' ').title(),
                'time': format_datetime(v.get('lastUpdated')),
                'visitId': str(v['_id']),
                'hostName': host_name
            })
            
        return jsonify({
            'currentVisitors': current_visitors,
            'expectedToday': expected_today,
            'checkedInToday': checked_in_today,
            'checkedOutToday': checked_out_today,
            'recentActivity': activity
        }), 200
        
    except Exception as e:
        print(f"Error in dashboard stats: {e}")
        return error_response(str(e), 500)


@dashboard_bp.route('/trends', methods=['GET'])
@require_auth
def get_trends():
    """Get visitor trends (last 7 days)"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        now = get_current_utc()
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
        
        daily_counts = list(visit_collection.aggregate(pipeline))
        date_map = {item['_id']: item['count'] for item in daily_counts}
        
        trends = []
        current_date = seven_days_ago
        for _ in range(7):
            date_str = current_date.strftime('%Y-%m-%d')
            trends.append({'date': date_str, 'count': date_map.get(date_str, 0)})
            current_date += timedelta(days=1)
        
        return jsonify({'trends': trends})
        
    except Exception as e:
        print(f"Error in trends: {e}")
        return error_response(str(e), 500)
