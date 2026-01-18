"""
Advanced Analytics API

Enterprise analytics for visitor management:
- Real-time dashboards
- Historical trends
- Occupancy analysis
- Peak hour detection
- Compliance metrics
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta, timezone
from collections import defaultdict

from app.db import get_db, visit_collection, visitor_collection, employee_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

advanced_analytics_bp = Blueprint('advanced_analytics', __name__)


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


@advanced_analytics_bp.route('/dashboard', methods=['GET'])
@require_company_access
def get_dashboard_metrics():
    """
    Get comprehensive dashboard metrics.
    
    Query Parameters:
        companyId (required): Company ObjectId
        period (optional): today, week, month (default: today)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        period = request.args.get('period', 'today')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        now = get_current_utc()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Calculate date range
        if period == 'today':
            start_date = today
        elif period == 'week':
            start_date = today - timedelta(days=7)
        elif period == 'month':
            start_date = today - timedelta(days=30)
        else:
            start_date = today
        
        # Build company query
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Current on-site
        currently_on_site = visit_collection.count_documents({
            **company_match,
            'status': 'checked_in'
        })
        
        # Today's visits
        todays_visits = list(visit_collection.find({
            **company_match,
            'expectedArrival': {'$gte': today, '$lt': today + timedelta(days=1)}
        }))
        
        scheduled = sum(1 for v in todays_visits if v.get('status') == 'scheduled')
        checked_in = sum(1 for v in todays_visits if v.get('status') == 'checked_in')
        checked_out = sum(1 for v in todays_visits if v.get('status') == 'checked_out')
        
        # Average visit duration (from checked out visits)
        checked_out_visits = [v for v in todays_visits if v.get('durationMinutes')]
        avg_duration = 0
        if checked_out_visits:
            avg_duration = sum(v['durationMinutes'] for v in checked_out_visits) / len(checked_out_visits)
        
        # Period metrics
        period_visits = visit_collection.count_documents({
            **company_match,
            'expectedArrival': {'$gte': start_date}
        })
        
        period_completed = visit_collection.count_documents({
            **company_match,
            'status': 'checked_out',
            'actualDeparture': {'$gte': start_date}
        })
        
        # New visitors in period
        new_visitors = visitor_collection.count_documents({
            **company_match,
            'createdAt': {'$gte': start_date}
        })
        
        # Pending approvals
        pending_approvals = visit_collection.count_documents({
            **company_match,
            'approvalStatus': 'pending'
        })
        
        return jsonify({
            'currentlyOnSite': currently_on_site,
            'today': {
                'total': len(todays_visits),
                'scheduled': scheduled,
                'checkedIn': checked_in,
                'checkedOut': checked_out,
                'avgDurationMinutes': round(avg_duration, 1)
            },
            'period': {
                'name': period,
                'totalVisits': period_visits,
                'completedVisits': period_completed,
                'newVisitors': new_visitors
            },
            'pendingApprovals': pending_approvals,
            'generatedAt': now.isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error getting dashboard metrics: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/trends', methods=['GET'])
@require_company_access
def get_visit_trends():
    """
    Get visit trend data for charts.
    
    Query Parameters:
        companyId (required): Company ObjectId
        days (optional): Number of days to analyze (default: 30)
        granularity (optional): daily, weekly (default: daily)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 30))
        granularity = request.args.get('granularity', 'daily')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        now = get_current_utc()
        start_date = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Build company query
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Pipeline for daily aggregation
        pipeline = [
            {
                '$match': {
                    **company_match,
                    'expectedArrival': {'$gte': start_date}
                }
            },
            {
                '$group': {
                    '_id': {
                        '$dateToString': {'format': '%Y-%m-%d', 'date': '$expectedArrival'}
                    },
                    'total': {'$sum': 1},
                    'checkedIn': {'$sum': {'$cond': [{'$eq': ['$status', 'checked_in']}, 1, 0]}},
                    'checkedOut': {'$sum': {'$cond': [{'$eq': ['$status', 'checked_out']}, 1, 0]}},
                    'cancelled': {'$sum': {'$cond': [{'$eq': ['$status', 'cancelled']}, 1, 0]}},
                    'avgDuration': {'$avg': '$durationMinutes'}
                }
            },
            {'$sort': {'_id': 1}}
        ]
        
        results = list(visit_collection.aggregate(pipeline))
        
        # Fill in missing dates
        trend_data = []
        current_date = start_date
        result_map = {r['_id']: r for r in results}
        
        while current_date <= now:
            date_str = current_date.strftime('%Y-%m-%d')
            if date_str in result_map:
                trend_data.append({
                    'date': date_str,
                    **{k: v for k, v in result_map[date_str].items() if k != '_id'}
                })
            else:
                trend_data.append({
                    'date': date_str,
                    'total': 0,
                    'checkedIn': 0,
                    'checkedOut': 0,
                    'cancelled': 0,
                    'avgDuration': None
                })
            current_date += timedelta(days=1)
        
        return jsonify({
            'trends': trend_data,
            'period': {'days': days, 'granularity': granularity}
        }), 200
        
    except Exception as e:
        print(f"Error getting trends: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/peak-hours', methods=['GET'])
@require_company_access
def get_peak_hours():
    """
    Analyze peak visiting hours.
    
    Returns hourly distribution of check-ins for capacity planning.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 30))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        now = get_current_utc()
        start_date = now - timedelta(days=days)
        
        # Build company query
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Aggregate by hour
        pipeline = [
            {
                '$match': {
                    **company_match,
                    'actualArrival': {'$gte': start_date, '$exists': True}
                }
            },
            {
                '$group': {
                    '_id': {'$hour': '$actualArrival'},
                    'count': {'$sum': 1},
                    'avgDuration': {'$avg': '$durationMinutes'}
                }
            },
            {'$sort': {'_id': 1}}
        ]
        
        results = list(visit_collection.aggregate(pipeline))
        
        # Create full 24-hour distribution
        hourly_data = []
        result_map = {r['_id']: r for r in results}
        total_visits = sum(r.get('count', 0) for r in results)
        
        peak_hour = 0
        peak_count = 0
        
        for hour in range(24):
            count = result_map.get(hour, {}).get('count', 0)
            avg_duration = result_map.get(hour, {}).get('avgDuration')
            
            if count > peak_count:
                peak_count = count
                peak_hour = hour
            
            hourly_data.append({
                'hour': hour,
                'label': f"{hour:02d}:00",
                'visits': count,
                'percentage': round(count / total_visits * 100, 1) if total_visits > 0 else 0,
                'avgDuration': round(avg_duration, 1) if avg_duration else None
            })
        
        return jsonify({
            'hourlyDistribution': hourly_data,
            'peakHour': peak_hour,
            'peakHourLabel': f"{peak_hour:02d}:00 - {peak_hour+1:02d}:00",
            'peakVisits': peak_count,
            'totalVisitsAnalyzed': total_visits,
            'analysisperiod': days
        }), 200
        
    except Exception as e:
        print(f"Error getting peak hours: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/visitor-types', methods=['GET'])
@require_company_access
def get_visitor_type_breakdown():
    """
    Get breakdown of visits by visitor type.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 30))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        start_date = get_current_utc() - timedelta(days=days)
        
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        pipeline = [
            {
                '$match': {
                    **company_match,
                    'expectedArrival': {'$gte': start_date}
                }
            },
            {
                '$group': {
                    '_id': {'$ifNull': ['$visitType', 'guest']},
                    'count': {'$sum': 1},
                    'avgDuration': {'$avg': '$durationMinutes'}
                }
            },
            {'$sort': {'count': -1}}
        ]
        
        results = list(visit_collection.aggregate(pipeline))
        total = sum(r['count'] for r in results)
        
        breakdown = []
        for r in results:
            breakdown.append({
                'type': r['_id'],
                'count': r['count'],
                'percentage': round(r['count'] / total * 100, 1) if total > 0 else 0,
                'avgDuration': round(r['avgDuration'], 1) if r.get('avgDuration') else None
            })
        
        return jsonify({
            'breakdown': breakdown,
            'total': total,
            'period': days
        }), 200
        
    except Exception as e:
        print(f"Error getting visitor types: {e}")
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/host-stats', methods=['GET'])
@require_company_access
def get_host_statistics():
    """
    Get statistics by host employee.
    
    Useful for understanding which employees have most visitors.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 30))
        limit = int(request.args.get('limit', 20))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        start_date = get_current_utc() - timedelta(days=days)
        
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        pipeline = [
            {
                '$match': {
                    **company_match,
                    'expectedArrival': {'$gte': start_date}
                }
            },
            {
                '$group': {
                    '_id': '$hostEmployeeId',
                    'hostName': {'$first': '$hostEmployeeName'},
                    'totalVisits': {'$sum': 1},
                    'completedVisits': {
                        '$sum': {'$cond': [{'$eq': ['$status', 'checked_out']}, 1, 0]}
                    },
                    'noShows': {
                        '$sum': {'$cond': [{'$eq': ['$noShowMarked', True]}, 1, 0]}
                    },
                    'avgDuration': {'$avg': '$durationMinutes'}
                }
            },
            {'$sort': {'totalVisits': -1}},
            {'$limit': limit}
        ]
        
        results = list(visit_collection.aggregate(pipeline))
        
        host_stats = []
        for r in results:
            host_stats.append({
                'hostEmployeeId': r['_id'],
                'hostName': r.get('hostName', 'Unknown'),
                'totalVisits': r['totalVisits'],
                'completedVisits': r['completedVisits'],
                'noShows': r['noShows'],
                'completionRate': round(r['completedVisits'] / r['totalVisits'] * 100, 1) if r['totalVisits'] > 0 else 0,
                'avgDuration': round(r['avgDuration'], 1) if r.get('avgDuration') else None
            })
        
        return jsonify({
            'hostStats': host_stats,
            'period': days
        }), 200
        
    except Exception as e:
        print(f"Error getting host stats: {e}")
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/compliance', methods=['GET'])
@require_company_access
def get_compliance_metrics():
    """
    Get compliance-related metrics.
    
    - Check-in compliance rate
    - Average check-in delay
    - Blacklist match count
    - Approval turnaround time
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 30))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        start_date = get_current_utc() - timedelta(days=days)
        
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Total scheduled visits
        total_scheduled = visit_collection.count_documents({
            **company_match,
            'expectedArrival': {'$gte': start_date}
        })
        
        # Completed visits
        completed = visit_collection.count_documents({
            **company_match,
            'status': 'checked_out',
            'actualDeparture': {'$gte': start_date}
        })
        
        # No-shows
        no_shows = visit_collection.count_documents({
            **company_match,
            'noShowMarked': True,
            'expectedArrival': {'$gte': start_date}
        })
        
        # Get audit data for security events
        db = get_db()
        blacklist_matches = db['audit_logs'].count_documents({
            'companyId': company_id,
            'action': 'security.blacklist_match',
            'timestamp': {'$gte': start_date}
        })
        
        # Calculate compliance rate
        compliance_rate = 0
        if total_scheduled > 0:
            compliance_rate = round((completed + no_shows) / total_scheduled * 100, 1)
        
        return jsonify({
            'complianceMetrics': {
                'totalScheduled': total_scheduled,
                'completed': completed,
                'noShows': no_shows,
                'cancelled': total_scheduled - completed - no_shows,
                'complianceRate': compliance_rate,
                'blacklistMatches': blacklist_matches
            },
            'period': days,
            'generatedAt': get_current_utc().isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error getting compliance metrics: {e}")
        return jsonify({'error': str(e)}), 500


@advanced_analytics_bp.route('/occupancy', methods=['GET'])
@require_company_access
def get_occupancy_data():
    """
    Get real-time and historical occupancy data.
    
    Useful for capacity management.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        now = get_current_utc()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Current occupancy
        current_occupancy = visit_collection.count_documents({
            **company_match,
            'status': 'checked_in'
        })
        
        # Get occupancy by location
        location_occupancy = list(visit_collection.aggregate([
            {'$match': {**company_match, 'status': 'checked_in'}},
            {
                '$group': {
                    '_id': '$locationId',
                    'locationName': {'$first': '$locationName'},
                    'count': {'$sum': 1}
                }
            },
            {'$sort': {'count': -1}}
        ]))
        
        # Expected arrivals rest of today
        expected_today = visit_collection.count_documents({
            **company_match,
            'status': 'scheduled',
            'expectedArrival': {'$gte': now, '$lt': today + timedelta(days=1)}
        })
        
        return jsonify({
            'currentOccupancy': current_occupancy,
            'expectedArrivalsToday': expected_today,
            'byLocation': convert_objectids(location_occupancy),
            'timestamp': now.isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error getting occupancy: {e}")
        return jsonify({'error': str(e)}), 500
