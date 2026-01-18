"""
Report Builder API

Custom report generation and scheduling:
- Predefined report templates
- Custom date ranges
- Multiple export formats (PDF, CSV, Excel)
- Scheduled report delivery
"""
from flask import Blueprint, request, jsonify, Response
from bson import ObjectId
from datetime import datetime, timedelta, timezone
import json
import csv
import io

from app.db import get_db, visit_collection, visitor_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

reports_bp = Blueprint('reports', __name__)


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


# Predefined report templates
REPORT_TEMPLATES = {
    'daily_summary': {
        'name': 'Daily Summary',
        'description': 'Overview of daily visitor activity',
        'fields': ['date', 'scheduled', 'checkedIn', 'checkedOut', 'noShows', 'avgDuration']
    },
    'visitor_log': {
        'name': 'Visitor Log',
        'description': 'Detailed log of all visitors',
        'fields': ['visitorName', 'phone', 'hostName', 'checkInTime', 'checkOutTime', 'duration', 'purpose']
    },
    'host_activity': {
        'name': 'Host Activity Report',
        'description': 'Visits by host employee',
        'fields': ['hostName', 'totalVisits', 'completedVisits', 'noShows', 'avgDuration']
    },
    'security_events': {
        'name': 'Security Events Report',
        'description': 'Blacklist matches and security alerts',
        'fields': ['timestamp', 'eventType', 'visitorName', 'description', 'severity']
    },
    'compliance': {
        'name': 'Compliance Report',
        'description': 'Compliance metrics and audit summary',
        'fields': ['metric', 'value', 'percentage', 'trend']
    }
}


@reports_bp.route('/templates', methods=['GET'])
@require_company_access
def list_report_templates():
    """List available report templates"""
    return jsonify({
        'templates': REPORT_TEMPLATES
    }), 200


@reports_bp.route('/generate', methods=['POST'])
@require_company_access
def generate_report():
    """
    Generate a report.
    
    Request Body:
        companyId (required): Company ObjectId
        templateId (required): Report template ID
        startDate (required): Start of date range
        endDate (required): End of date range
        format (optional): json, csv (default: json)
        filters (optional): Additional filters
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        template_id = data.get('templateId')
        start_date = data.get('startDate')
        end_date = data.get('endDate')
        output_format = data.get('format', 'json')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        if not template_id:
            return jsonify({'error': 'Template ID is required'}), 400
        if template_id not in REPORT_TEMPLATES:
            return jsonify({'error': f'Unknown template: {template_id}'}), 400
        if not start_date or not end_date:
            return jsonify({'error': 'Start and end dates are required'}), 400
        
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        
        try:
            company_oid = ObjectId(company_id)
            company_match = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_match = {'companyId': company_id}
        
        # Generate report based on template
        report_data = []
        
        if template_id == 'daily_summary':
            report_data = generate_daily_summary(company_match, start_dt, end_dt)
        elif template_id == 'visitor_log':
            report_data = generate_visitor_log(company_match, start_dt, end_dt)
        elif template_id == 'host_activity':
            report_data = generate_host_activity(company_match, start_dt, end_dt)
        elif template_id == 'security_events':
            report_data = generate_security_events(company_id, start_dt, end_dt)
        elif template_id == 'compliance':
            report_data = generate_compliance_report(company_match, start_dt, end_dt)
        
        template = REPORT_TEMPLATES[template_id]
        
        if output_format == 'csv':
            output = io.StringIO()
            if report_data:
                writer = csv.DictWriter(output, fieldnames=template['fields'])
                writer.writeheader()
                writer.writerows(report_data)
            
            return Response(
                output.getvalue(),
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename={template_id}_{start_date[:10]}_to_{end_date[:10]}.csv'}
            )
        else:
            return jsonify({
                'report': {
                    'templateId': template_id,
                    'templateName': template['name'],
                    'startDate': start_date,
                    'endDate': end_date,
                    'generatedAt': get_current_utc().isoformat(),
                    'recordCount': len(report_data)
                },
                'data': report_data
            }), 200
        
    except Exception as e:
        print(f"Error generating report: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def generate_daily_summary(company_match, start_dt, end_dt):
    """Generate daily summary report data"""
    pipeline = [
        {
            '$match': {
                **company_match,
                'expectedArrival': {'$gte': start_dt, '$lte': end_dt}
            }
        },
        {
            '$group': {
                '_id': {'$dateToString': {'format': '%Y-%m-%d', 'date': '$expectedArrival'}},
                'scheduled': {'$sum': 1},
                'checkedIn': {'$sum': {'$cond': [{'$in': ['$status', ['checked_in', 'checked_out']]}, 1, 0]}},
                'checkedOut': {'$sum': {'$cond': [{'$eq': ['$status', 'checked_out']}, 1, 0]}},
                'noShows': {'$sum': {'$cond': [{'$eq': ['$noShowMarked', True]}, 1, 0]}},
                'avgDuration': {'$avg': '$durationMinutes'}
            }
        },
        {'$sort': {'_id': 1}}
    ]
    
    results = list(visit_collection.aggregate(pipeline))
    
    return [
        {
            'date': r['_id'],
            'scheduled': r['scheduled'],
            'checkedIn': r['checkedIn'],
            'checkedOut': r['checkedOut'],
            'noShows': r['noShows'],
            'avgDuration': round(r['avgDuration'], 1) if r.get('avgDuration') else 0
        }
        for r in results
    ]


def generate_visitor_log(company_match, start_dt, end_dt):
    """Generate detailed visitor log"""
    visits = list(visit_collection.find({
        **company_match,
        'expectedArrival': {'$gte': start_dt, '$lte': end_dt}
    }).sort('actualArrival', 1))
    
    return [
        {
            'visitorName': v.get('visitorName', ''),
            'phone': v.get('visitorPhone', ''),
            'hostName': v.get('hostEmployeeName', ''),
            'checkInTime': v.get('actualArrival').isoformat() if v.get('actualArrival') else '',
            'checkOutTime': v.get('actualDeparture').isoformat() if v.get('actualDeparture') else '',
            'duration': v.get('durationMinutes', ''),
            'purpose': v.get('purpose', '')
        }
        for v in visits
    ]


def generate_host_activity(company_match, start_dt, end_dt):
    """Generate host activity report"""
    pipeline = [
        {
            '$match': {
                **company_match,
                'expectedArrival': {'$gte': start_dt, '$lte': end_dt}
            }
        },
        {
            '$group': {
                '_id': '$hostEmployeeId',
                'hostName': {'$first': '$hostEmployeeName'},
                'totalVisits': {'$sum': 1},
                'completedVisits': {'$sum': {'$cond': [{'$eq': ['$status', 'checked_out']}, 1, 0]}},
                'noShows': {'$sum': {'$cond': [{'$eq': ['$noShowMarked', True]}, 1, 0]}},
                'avgDuration': {'$avg': '$durationMinutes'}
            }
        },
        {'$sort': {'totalVisits': -1}}
    ]
    
    results = list(visit_collection.aggregate(pipeline))
    
    return [
        {
            'hostName': r.get('hostName', 'Unknown'),
            'totalVisits': r['totalVisits'],
            'completedVisits': r['completedVisits'],
            'noShows': r['noShows'],
            'avgDuration': round(r['avgDuration'], 1) if r.get('avgDuration') else 0
        }
        for r in results
    ]


def generate_security_events(company_id, start_dt, end_dt):
    """Generate security events report"""
    db = get_db()
    events = list(db['audit_logs'].find({
        'companyId': company_id,
        'severity': {'$in': ['warning', 'critical']},
        'timestamp': {'$gte': start_dt, '$lte': end_dt}
    }).sort('timestamp', -1))
    
    return [
        {
            'timestamp': e.get('timestamp').isoformat() if e.get('timestamp') else '',
            'eventType': e.get('action', ''),
            'visitorName': e.get('details', {}).get('visitorName', ''),
            'description': str(e.get('details', {})),
            'severity': e.get('severity', '')
        }
        for e in events
    ]


def generate_compliance_report(company_match, start_dt, end_dt):
    """Generate compliance report"""
    total = visit_collection.count_documents({**company_match, 'expectedArrival': {'$gte': start_dt, '$lte': end_dt}})
    completed = visit_collection.count_documents({**company_match, 'status': 'checked_out', 'actualDeparture': {'$gte': start_dt, '$lte': end_dt}})
    no_shows = visit_collection.count_documents({**company_match, 'noShowMarked': True, 'expectedArrival': {'$gte': start_dt, '$lte': end_dt}})
    cancelled = visit_collection.count_documents({**company_match, 'status': 'cancelled', 'expectedArrival': {'$gte': start_dt, '$lte': end_dt}})
    
    return [
        {'metric': 'Total Scheduled', 'value': total, 'percentage': 100, 'trend': 'N/A'},
        {'metric': 'Completed Visits', 'value': completed, 'percentage': round(completed/total*100, 1) if total > 0 else 0, 'trend': 'N/A'},
        {'metric': 'No-Shows', 'value': no_shows, 'percentage': round(no_shows/total*100, 1) if total > 0 else 0, 'trend': 'N/A'},
        {'metric': 'Cancelled', 'value': cancelled, 'percentage': round(cancelled/total*100, 1) if total > 0 else 0, 'trend': 'N/A'},
        {'metric': 'Compliance Rate', 'value': completed, 'percentage': round((completed+no_shows)/total*100, 1) if total > 0 else 0, 'trend': 'N/A'}
    ]


@reports_bp.route('/schedule', methods=['POST'])
@require_company_access
def schedule_report():
    """
    Schedule a recurring report.
    
    Request Body:
        companyId (required): Company ObjectId
        templateId (required): Report template
        frequency (required): daily, weekly, monthly
        recipients (required): Array of email addresses
        dayOfWeek (optional): For weekly (0=Monday)
        dayOfMonth (optional): For monthly (1-28)
        time (optional): Time to send (default: 08:00)
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        if not data.get('templateId'):
            return jsonify({'error': 'Template ID is required'}), 400
        if not data.get('frequency'):
            return jsonify({'error': 'Frequency is required'}), 400
        if not data.get('recipients'):
            return jsonify({'error': 'Recipients are required'}), 400
        
        db = get_db()
        scheduled_reports = db['scheduled_reports']
        
        schedule_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'templateId': data['templateId'],
            'templateName': REPORT_TEMPLATES.get(data['templateId'], {}).get('name', 'Unknown'),
            'frequency': data['frequency'],
            'dayOfWeek': data.get('dayOfWeek', 0),
            'dayOfMonth': data.get('dayOfMonth', 1),
            'time': data.get('time', '08:00'),
            'recipients': data['recipients'],
            'format': data.get('format', 'csv'),
            'active': True,
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'system'),
            'lastRun': None,
            'nextRun': None
        }
        
        scheduled_reports.insert_one(schedule_doc)
        
        return jsonify({
            'message': 'Report scheduled successfully',
            'scheduleId': str(schedule_doc['_id']),
            'frequency': data['frequency'],
            'recipients': data['recipients']
        }), 201
        
    except Exception as e:
        print(f"Error scheduling report: {e}")
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/scheduled', methods=['GET'])
@require_company_access
def list_scheduled_reports():
    """List all scheduled reports"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        reports = list(db['scheduled_reports'].find({'companyId': company_id}))
        
        return jsonify({
            'scheduledReports': convert_objectids(reports),
            'count': len(reports)
        }), 200
        
    except Exception as e:
        print(f"Error listing scheduled reports: {e}")
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/scheduled/<schedule_id>', methods=['DELETE'])
@require_company_access
def delete_scheduled_report(schedule_id):
    """Delete a scheduled report"""
    try:
        db = get_db()
        result = db['scheduled_reports'].delete_one({'_id': ObjectId(schedule_id)})
        
        if result.deleted_count == 0:
            return jsonify({'error': 'Schedule not found'}), 404
        
        return jsonify({'message': 'Schedule deleted'}), 200
        
    except Exception as e:
        print(f"Error deleting schedule: {e}")
        return jsonify({'error': str(e)}), 500
