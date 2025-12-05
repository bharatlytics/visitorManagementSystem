"""
VMS Analytics API - Dashboard analytics and trends
"""
from flask import Blueprint, jsonify, request
from bson import ObjectId
from datetime import timedelta

from app.db import visit_collection, visitor_collection, entities_collection
from app.utils import get_current_utc, error_response
from app.auth import require_auth

vms_analytics_bp = Blueprint('vms_analytics', __name__)


@vms_analytics_bp.route('/dashboard', methods=['GET'])
@require_auth
def get_dashboard_analytics():
    """Get dashboard analytics - total visitors, active visits, visits today, top zones"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400

        # Time ranges
        now = get_current_utc()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)
        month_start = today_start - timedelta(days=30)

        # 1. Total Visitors (All time)
        total_visitors = visitor_collection.count_documents({'companyId': ObjectId(company_id)})

        # 2. Active Visits (Currently checked in)
        active_visits = visit_collection.count_documents({
            'companyId': ObjectId(company_id),
            'status': 'checked_in'
        })

        # 3. Visits Today
        visits_today = visit_collection.count_documents({
            'companyId': ObjectId(company_id),
            'expectedArrival': {'$gte': today_start}
        })

        # 4. Zone Utilization
        zone_stats = list(visit_collection.aggregate([
            {'$match': {
                'companyId': ObjectId(company_id),
                'status': {'$in': ['checked_in', 'checked_out']},
                'actualArrival': {'$gte': month_start}
            }},
            {'$unwind': '$accessAreas'},
            {'$group': {'_id': '$accessAreas', 'count': {'$sum': 1}}},
            {'$sort': {'count': -1}},
            {'$limit': 5}
        ]))

        # Enrich with Zone names
        enriched_zone_stats = []
        for stat in zone_stats:
            zone_id = stat['_id']
            # Try to get zone name from entities collection
            zone = entities_collection.find_one({
                '_id': ObjectId(zone_id) if isinstance(zone_id, str) else zone_id,
                'companyId': ObjectId(company_id),
                'type': 'Zone'
            })
            if zone:
                enriched_zone_stats.append({
                    'zoneName': zone.get('name', 'Unknown Zone'),
                    'count': stat['count']
                })
            else:
                enriched_zone_stats.append({
                    'zoneName': 'Unknown Zone',
                    'count': stat['count']
                })

        return jsonify({
            'totalVisitors': total_visitors,
            'activeVisits': active_visits,
            'visitsToday': visits_today,
            'topZones': enriched_zone_stats
        })

    except Exception as e:
        print(f"Error in analytics dashboard: {e}")
        return jsonify({'error': str(e)}), 500


@vms_analytics_bp.route('/trends', methods=['GET'])
@require_auth
def get_visitor_trends():
    """Get visitor trends - last 7 days"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Last 7 days trend
        now = get_current_utc()
        seven_days_ago = now - timedelta(days=6)
        seven_days_ago = seven_days_ago.replace(hour=0, minute=0, second=0, microsecond=0)
        
        pipeline = [
            {
                '$match': {
                    'companyId': ObjectId(company_id),
                    'actualArrival': {'$gte': seven_days_ago}
                }
            },
            {
                '$group': {
                    '_id': {
                        '$dateToString': {
                            'format': '%Y-%m-%d', 
                            'date': '$actualArrival'
                        }
                    },
                    'count': {'$sum': 1}
                }
            },
            {'$sort': {'_id': 1}}
        ]
        
        daily_counts = list(visit_collection.aggregate(pipeline))
        
        # Fill in missing days
        trends = []
        current_date = seven_days_ago
        date_map = {item['_id']: item['count'] for item in daily_counts}
        
        for _ in range(7):
            date_str = current_date.strftime('%Y-%m-%d')
            trends.append({
                'date': date_str,
                'count': date_map.get(date_str, 0)
            })
            current_date += timedelta(days=1)
            
        return jsonify({'trends': trends})

    except Exception as e:
        print(f"Error in trends: {e}")
        return jsonify({'error': str(e)}), 500
