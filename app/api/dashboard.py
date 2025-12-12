"""
Dashboard API - Stats and analytics
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta

from app.db import visit_collection, visitor_collection, employee_collection
from app.auth import require_auth
from app.utils import get_current_utc, error_response, format_datetime
from app.services.auto_checkout import run_auto_checkout

dashboard_bp = Blueprint('vms_dashboard', __name__)


@dashboard_bp.route('/stats', methods=['GET'])
@require_auth
def get_dashboard_stats():
    """Get dashboard statistics"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        # Run auto-checkout for this company to clean up stale visits
        run_auto_checkout(company_id)
        
        # Support both ObjectId and string companyId in database
        try:
            company_oid = ObjectId(company_id)
            company_query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_query = {'companyId': company_id}
            
        now = get_current_utc()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        # Current Visitors (Checked In)
        current_query = {**company_query, 'status': 'checked_in'}
        current_visitors = visit_collection.count_documents(current_query)
        
        # Expected Today (Scheduled for today, not yet checked in)
        expected_query = {
            **company_query,
            'expectedArrival': {'$gte': start_of_day, '$lt': end_of_day},
            'status': 'scheduled'
        }
        expected_today = visit_collection.count_documents(expected_query)
        
        # Checked In Today (Total check-ins today)
        checkin_query = {
            **company_query,
            'actualArrival': {'$gte': start_of_day, '$lt': end_of_day}
        }
        checked_in_today = visit_collection.count_documents(checkin_query)
        
        # Checked Out Today
        checkout_query = {
            **company_query,
            'actualDeparture': {'$gte': start_of_day, '$lt': end_of_day}
        }
        checked_out_today = visit_collection.count_documents(checkout_query)
        
        # Recent Activity (Last 10 events)
        recent_visits = list(visit_collection.find({
            **company_query,
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


# =====================================
# Security Dashboard
# =====================================

@dashboard_bp.route('/security', methods=['GET'])
@require_auth
def security_dashboard():
    """Security dashboard - live visitors, alerts, overstays"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        try:
            company_oid = ObjectId(company_id)
            company_query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_query = {'companyId': company_id}
        
        now = get_current_utc()
        
        # Live visitors (checked in)
        live_visitors = list(visit_collection.find({
            **company_query,
            'status': 'checked_in'
        }).sort('actualArrival', -1))
        
        for v in live_visitors:
            v['_id'] = str(v['_id'])
            v['visitorId'] = str(v.get('visitorId', ''))
            if v.get('actualArrival'):
                v['actualArrival'] = v['actualArrival'].isoformat()
                # Calculate time inside
                arrival = v.get('actualArrival')
                if isinstance(arrival, str):
                    arrival = datetime.fromisoformat(arrival.replace('Z', '+00:00'))
                delta = now - arrival if isinstance(arrival, datetime) else timedelta(0)
                v['hoursInside'] = round(delta.total_seconds() / 3600, 1)
        
        # Overstayed visitors (checked in > expected duration or > 10 hours)
        overstayed = []
        for v in live_visitors:
            hours = v.get('hoursInside', 0)
            expected = v.get('durationHours', 8)
            if hours > expected or hours > 10:
                overstayed.append({
                    'visitorName': v.get('visitorName'),
                    'hostName': v.get('hostEmployeeName'),
                    'hoursInside': hours,
                    'expected': expected,
                    'visitId': v['_id']
                })
        
        # Pending approvals
        pending_approvals = list(visit_collection.find({
            **company_query,
            'requiresApproval': True,
            'approvalStatus': 'pending'
        }).limit(20))
        
        for v in pending_approvals:
            v['_id'] = str(v['_id'])
        
        # Access denied count (today)
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        # (Would need a separate access_log collection for full implementation)
        
        return jsonify({
            'liveVisitors': live_visitors,
            'liveCount': len(live_visitors),
            'overstayed': overstayed,
            'overstayedCount': len(overstayed),
            'pendingApprovals': pending_approvals,
            'pendingCount': len(pending_approvals)
        })
        
    except Exception as e:
        print(f"Error in security dashboard: {e}")
        return error_response(str(e), 500)


# =====================================
# Reports & Export
# =====================================

@dashboard_bp.route('/reports/visits', methods=['GET'])
@require_auth
def export_visits_report():
    """Export visits report"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        # Date range
        start_date = request.args.get('startDate')
        end_date = request.args.get('endDate')
        format_type = request.args.get('format', 'json')  # json, csv
        
        try:
            company_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        if start_date:
            query['createdAt'] = {'$gte': datetime.fromisoformat(start_date)}
        if end_date:
            if 'createdAt' in query:
                query['createdAt']['$lte'] = datetime.fromisoformat(end_date)
            else:
                query['createdAt'] = {'$lte': datetime.fromisoformat(end_date)}
        
        visits = list(visit_collection.find(query).sort('createdAt', -1).limit(1000))
        
        report_data = []
        for v in visits:
            report_data.append({
                'visitId': str(v['_id']),
                'visitorName': v.get('visitorName', ''),
                'hostName': v.get('hostEmployeeName', ''),
                'visitType': v.get('visitType', 'guest'),
                'purpose': v.get('purpose', ''),
                'status': v.get('status', ''),
                'expectedArrival': format_datetime(v.get('expectedArrival')),
                'actualArrival': format_datetime(v.get('actualArrival')),
                'actualDeparture': format_datetime(v.get('actualDeparture')),
                'durationMinutes': v.get('durationMinutes'),
                'checkInMethod': v.get('checkInMethod', ''),
                'checkOutMethod': v.get('checkOutMethod', ''),
                'locationName': v.get('locationName', ''),
                'hasLaptop': v.get('assets', {}).get('laptop', False),
                'lunchIncluded': v.get('facilities', {}).get('lunchIncluded', False),
                'vehicleNumber': v.get('vehicle', {}).get('number', ''),
                'ndaRequired': v.get('compliance', {}).get('ndaRequired', False),
                'ndaSigned': v.get('compliance', {}).get('ndaSigned', False)
            })
        
        if format_type == 'csv':
            # Build CSV
            if not report_data:
                return 'No data', 200, {'Content-Type': 'text/csv'}
            
            headers = list(report_data[0].keys())
            csv_lines = [','.join(headers)]
            for row in report_data:
                csv_lines.append(','.join([str(row.get(h, '')).replace(',', ';') for h in headers]))
            
            csv_content = '\n'.join(csv_lines)
            return csv_content, 200, {
                'Content-Type': 'text/csv',
                'Content-Disposition': f'attachment; filename=visits_report_{datetime.now().strftime("%Y%m%d")}.csv'
            }
        
        return jsonify({
            'count': len(report_data),
            'data': report_data
        })
        
    except Exception as e:
        print(f"Error in visits report: {e}")
        return error_response(str(e), 500)


@dashboard_bp.route('/reports/summary', methods=['GET'])
@require_auth
def get_summary_report():
    """Get summary analytics"""
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('Company ID is required', 400)
        
        try:
            company_oid = ObjectId(company_id)
            company_query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_query = {'companyId': company_id}
        
        now = get_current_utc()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        # Visits this month
        monthly_visits = visit_collection.count_documents({
            **company_query,
            'createdAt': {'$gte': start_of_month}
        })
        
        # By visitor type
        type_pipeline = [
            {'$match': {**company_query, 'createdAt': {'$gte': start_of_month}}},
            {'$group': {'_id': '$visitType', 'count': {'$sum': 1}}},
            {'$sort': {'count': -1}}
        ]
        by_type = list(visit_collection.aggregate(type_pipeline))
        
        # By check-in method
        method_pipeline = [
            {'$match': {**company_query, 'checkInMethod': {'$exists': True, '$ne': None}}},
            {'$group': {'_id': '$checkInMethod', 'count': {'$sum': 1}}}
        ]
        by_method = list(visit_collection.aggregate(method_pipeline))
        
        # Average visit duration
        duration_pipeline = [
            {'$match': {**company_query, 'durationMinutes': {'$exists': True, '$gt': 0}}},
            {'$group': {'_id': None, 'avgDuration': {'$avg': '$durationMinutes'}}}
        ]
        duration_result = list(visit_collection.aggregate(duration_pipeline))
        avg_duration = round(duration_result[0]['avgDuration'], 0) if duration_result else 0
        
        # Peak hours (by hour of check-in)
        hour_pipeline = [
            {'$match': {**company_query, 'actualArrival': {'$exists': True}}},
            {'$group': {'_id': {'$hour': '$actualArrival'}, 'count': {'$sum': 1}}},
            {'$sort': {'count': -1}},
            {'$limit': 5}
        ]
        peak_hours = list(visit_collection.aggregate(hour_pipeline))
        
        return jsonify({
            'monthlyVisits': monthly_visits,
            'byVisitorType': [{'type': t['_id'] or 'unknown', 'count': t['count']} for t in by_type],
            'byCheckInMethod': [{'method': m['_id'] or 'unknown', 'count': m['count']} for m in by_method],
            'avgDurationMinutes': avg_duration,
            'peakHours': [{'hour': h['_id'], 'count': h['count']} for h in peak_hours]
        })
        
    except Exception as e:
        print(f"Error in summary report: {e}")
        return error_response(str(e), 500)


# =====================================
# Approval Workflow
# =====================================

@dashboard_bp.route('/approvals/<visit_id>/approve', methods=['POST'])
@require_auth
def approve_visit(visit_id):
    """Approve a pending visit"""
    try:
        data = request.json or {}
        
        result = visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {'$set': {
                'approvalStatus': 'approved',
                'approvedBy': data.get('approvedBy'),
                'approvedAt': datetime.utcnow(),
                'lastUpdated': datetime.utcnow()
            }}
        )
        
        if result.matched_count == 0:
            return error_response('Visit not found', 404)
        
        return jsonify({'message': 'Visit approved'})
        
    except Exception as e:
        return error_response(str(e), 500)


@dashboard_bp.route('/approvals/<visit_id>/deny', methods=['POST'])
@require_auth
def deny_visit(visit_id):
    """Deny a pending visit"""
    try:
        data = request.json or {}
        
        result = visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {'$set': {
                'approvalStatus': 'denied',
                'deniedBy': data.get('deniedBy'),
                'deniedAt': datetime.utcnow(),
                'denialReason': data.get('reason', ''),
                'status': 'cancelled',
                'lastUpdated': datetime.utcnow()
            }}
        )
        
        if result.matched_count == 0:
            return error_response('Visit not found', 404)
        
        return jsonify({'message': 'Visit denied'})
        
    except Exception as e:
        return error_response(str(e), 500)
