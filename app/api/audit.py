"""
Audit API

REST endpoints for accessing audit logs:
- Search and filter audit logs
- Export for compliance
- Get entity-specific history
"""
from flask import Blueprint, request, jsonify, Response
from bson import ObjectId
from datetime import datetime, timedelta, timezone
import json
import csv
import io

from app.db import get_db
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

audit_bp = Blueprint('audit', __name__)


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


@audit_bp.route('/logs', methods=['GET'])
@require_company_access
def search_audit_logs():
    """
    Search audit logs with filters.
    
    Query Parameters:
        companyId (required): Company ObjectId
        action (optional): Filter by action type (visitor.created, visit.checkin, etc.)
        entityType (optional): Filter by entity type (visitor, visit, employee)
        entityId (optional): Filter by specific entity
        userId (optional): Filter by user who performed action
        severity (optional): Filter by severity (info, warning, critical)
        startDate (optional): Start of date range (ISO format)
        endDate (optional): End of date range (ISO format)
        limit (optional): Number of records (default: 100, max: 1000)
        offset (optional): Pagination offset
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Build query
        query = {'companyId': company_id}
        
        if request.args.get('action'):
            query['action'] = request.args.get('action')
        
        if request.args.get('entityType'):
            query['entityType'] = request.args.get('entityType')
        
        if request.args.get('entityId'):
            query['entityId'] = request.args.get('entityId')
        
        if request.args.get('userId'):
            query['user.id'] = request.args.get('userId')
        
        if request.args.get('severity'):
            query['severity'] = request.args.get('severity')
        
        # Date range
        if request.args.get('startDate') or request.args.get('endDate'):
            query['timestamp'] = {}
            if request.args.get('startDate'):
                start_date = datetime.fromisoformat(request.args.get('startDate').replace('Z', '+00:00'))
                query['timestamp']['$gte'] = start_date
            if request.args.get('endDate'):
                end_date = datetime.fromisoformat(request.args.get('endDate').replace('Z', '+00:00'))
                query['timestamp']['$lte'] = end_date
        
        limit = min(int(request.args.get('limit', 100)), 1000)
        offset = int(request.args.get('offset', 0))
        
        db = get_db()
        audit_collection = db['audit_logs']
        
        logs = list(audit_collection.find(query).sort('timestamp', -1).skip(offset).limit(limit))
        total = audit_collection.count_documents(query)
        
        return jsonify({
            'logs': convert_objectids(logs),
            'total': total,
            'limit': limit,
            'offset': offset
        }), 200
        
    except Exception as e:
        print(f"Error searching audit logs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@audit_bp.route('/entity/<entity_type>/<entity_id>', methods=['GET'])
@require_company_access
def get_entity_audit_history(entity_type, entity_id):
    """
    Get complete audit history for a specific entity.
    
    Path Parameters:
        entity_type: visitor, visit, employee, etc.
        entity_id: Entity ObjectId
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        db = get_db()
        audit_collection = db['audit_logs']
        
        query = {
            'entityType': entity_type,
            'entityId': entity_id
        }
        if company_id:
            query['companyId'] = company_id
        
        logs = list(audit_collection.find(query).sort('timestamp', -1))
        
        return jsonify({
            'entityType': entity_type,
            'entityId': entity_id,
            'history': convert_objectids(logs),
            'count': len(logs)
        }), 200
        
    except Exception as e:
        print(f"Error getting entity audit history: {e}")
        return jsonify({'error': str(e)}), 500


@audit_bp.route('/export', methods=['GET'])
@require_company_access
def export_audit_logs():
    """
    Export audit logs for compliance.
    
    Query Parameters:
        companyId (required): Company ObjectId
        format (optional): csv or json (default: json)
        startDate (required): Start of date range
        endDate (required): End of date range
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        export_format = request.args.get('format', 'json')
        start_date = request.args.get('startDate')
        end_date = request.args.get('endDate')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        if not start_date or not end_date:
            return jsonify({'error': 'Start and end dates are required'}), 400
        
        query = {
            'companyId': company_id,
            'timestamp': {
                '$gte': datetime.fromisoformat(start_date.replace('Z', '+00:00')),
                '$lte': datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            }
        }
        
        db = get_db()
        audit_collection = db['audit_logs']
        
        logs = list(audit_collection.find(query).sort('timestamp', 1))
        logs = convert_objectids(logs)
        
        if export_format == 'csv':
            output = io.StringIO()
            if logs:
                writer = csv.DictWriter(output, fieldnames=[
                    'timestamp', 'action', 'entityType', 'entityId',
                    'userId', 'userName', 'severity', 'ip'
                ])
                writer.writeheader()
                
                for log in logs:
                    writer.writerow({
                        'timestamp': log.get('timestamp'),
                        'action': log.get('action'),
                        'entityType': log.get('entityType'),
                        'entityId': log.get('entityId'),
                        'userId': log.get('user', {}).get('id'),
                        'userName': log.get('user', {}).get('name'),
                        'severity': log.get('severity'),
                        'ip': log.get('client', {}).get('ip')
                    })
            
            return Response(
                output.getvalue(),
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename=audit_logs_{start_date[:10]}_to_{end_date[:10]}.csv'}
            )
        else:
            return Response(
                json.dumps({'logs': logs}, indent=2),
                mimetype='application/json',
                headers={'Content-Disposition': f'attachment; filename=audit_logs_{start_date[:10]}_to_{end_date[:10]}.json'}
            )
        
    except Exception as e:
        print(f"Error exporting audit logs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@audit_bp.route('/summary', methods=['GET'])
@require_company_access
def get_audit_summary():
    """
    Get summary statistics of audit logs.
    
    Query Parameters:
        companyId (required): Company ObjectId
        days (optional): Number of days to summarize (default: 7)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 7))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        start_date = get_current_utc() - timedelta(days=days)
        
        db = get_db()
        audit_collection = db['audit_logs']
        
        query = {
            'companyId': company_id,
            'timestamp': {'$gte': start_date}
        }
        
        # Aggregate by action
        pipeline = [
            {'$match': query},
            {
                '$group': {
                    '_id': '$action',
                    'count': {'$sum': 1}
                }
            },
            {'$sort': {'count': -1}}
        ]
        
        action_counts = list(audit_collection.aggregate(pipeline))
        
        # Aggregate by severity
        severity_pipeline = [
            {'$match': query},
            {
                '$group': {
                    '_id': '$severity',
                    'count': {'$sum': 1}
                }
            }
        ]
        
        severity_counts = list(audit_collection.aggregate(severity_pipeline))
        
        # Total count
        total = audit_collection.count_documents(query)
        
        return jsonify({
            'period': f'Last {days} days',
            'totalActions': total,
            'byAction': {item['_id']: item['count'] for item in action_counts},
            'bySeverity': {item['_id']: item['count'] for item in severity_counts}
        }), 200
        
    except Exception as e:
        print(f"Error getting audit summary: {e}")
        return jsonify({'error': str(e)}), 500


@audit_bp.route('/security-events', methods=['GET'])
@require_company_access
def get_security_events():
    """
    Get security-related audit events.
    
    Returns events like login failures, blacklist matches, unauthorized access attempts.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        days = int(request.args.get('days', 7))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        start_date = get_current_utc() - timedelta(days=days)
        
        db = get_db()
        audit_collection = db['audit_logs']
        
        # Security-related actions
        security_actions = [
            'auth.login_failed',
            'security.blacklist_match',
            'security.unauthorized_access',
            'security.suspicious_activity',
            'visitor.blacklisted',
            'evacuation.triggered'
        ]
        
        query = {
            'companyId': company_id,
            'timestamp': {'$gte': start_date},
            '$or': [
                {'action': {'$in': security_actions}},
                {'severity': {'$in': ['warning', 'critical']}}
            ]
        }
        
        events = list(audit_collection.find(query).sort('timestamp', -1).limit(100))
        
        return jsonify({
            'securityEvents': convert_objectids(events),
            'count': len(events),
            'period': f'Last {days} days'
        }), 200
        
    except Exception as e:
        print(f"Error getting security events: {e}")
        return jsonify({'error': str(e)}), 500
