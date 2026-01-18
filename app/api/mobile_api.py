"""
Mobile API - Optimized endpoints for mobile clients

Features:
- Compressed responses
- Pagination with cursors
- Delta sync for offline support
- Push notification registration
- Mobile-specific visit flows
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta, timezone
import json
import hashlib

from app.db import get_db, visitor_collection, visit_collection, employee_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

mobile_bp = Blueprint('mobile', __name__)


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


def make_cursor(doc):
    """Create a cursor for pagination"""
    if not doc:
        return None
    return f"{doc.get('lastUpdated', doc.get('createdAt', '')).isoformat()}_{doc.get('_id')}"


def parse_cursor(cursor_str):
    """Parse a cursor back to timestamp and id"""
    if not cursor_str:
        return None, None
    parts = cursor_str.rsplit('_', 1)
    if len(parts) != 2:
        return None, None
    try:
        timestamp = datetime.fromisoformat(parts[0])
        doc_id = parts[1]
        return timestamp, doc_id
    except:
        return None, None


@mobile_bp.route('/sync/visitors', methods=['GET'])
@require_company_access
def sync_visitors():
    """
    Get visitors with delta sync support.
    
    Query Parameters:
        companyId (required): Company ObjectId
        since (optional): ISO timestamp - only return records updated after this
        cursor (optional): Pagination cursor from previous response
        limit (optional): Number of records (default: 50, max: 200)
    
    Returns:
        - visitors: Array of visitor records
        - nextCursor: Cursor for next page (null if no more)
        - syncTimestamp: Use as 'since' for next sync
        - hasMore: Boolean indicating more records
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        since = request.args.get('since')
        cursor = request.args.get('cursor')
        limit = min(int(request.args.get('limit', 50)), 200)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Build query
        query = {}
        try:
            company_oid = ObjectId(company_id)
            query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            query['companyId'] = company_id
        
        # Delta sync - only records updated after timestamp
        if since:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query['lastUpdated'] = {'$gt': since_dt}
        
        # Cursor-based pagination
        cursor_time, cursor_id = parse_cursor(cursor)
        if cursor_time:
            query['$or'] = [
                {'lastUpdated': {'$gt': cursor_time}},
                {'lastUpdated': cursor_time, '_id': {'$gt': ObjectId(cursor_id)}}
            ]
        
        # Fetch with limit + 1 to check hasMore
        visitors = list(visitor_collection.find(query)
                       .sort([('lastUpdated', 1), ('_id', 1)])
                       .limit(limit + 1))
        
        has_more = len(visitors) > limit
        if has_more:
            visitors = visitors[:limit]
        
        # Minimal fields for mobile
        mobile_visitors = []
        for v in visitors:
            mobile_visitors.append({
                '_id': str(v['_id']),
                'visitorName': v.get('visitorName'),
                'phone': v.get('phone'),
                'email': v.get('email'),
                'organization': v.get('organization'),
                'visitorType': v.get('visitorType'),
                'status': v.get('status'),
                'blacklisted': v.get('blacklisted', False),
                'hasPhoto': bool(v.get('visitorImages')),
                'lastUpdated': v.get('lastUpdated')
            })
        
        next_cursor = make_cursor(visitors[-1]) if has_more and visitors else None
        
        return jsonify({
            'visitors': convert_objectids(mobile_visitors),
            'count': len(mobile_visitors),
            'nextCursor': next_cursor,
            'hasMore': has_more,
            'syncTimestamp': get_current_utc().isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error syncing visitors: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/sync/visits', methods=['GET'])
@require_company_access
def sync_visits():
    """
    Get visits with delta sync support.
    
    For security guards - get today's expected and checked-in visits.
    For hosts - get their own pending visits.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        role = request.args.get('role', 'guard')  # guard, host
        host_id = request.args.get('hostEmployeeId')
        since = request.args.get('since')
        limit = min(int(request.args.get('limit', 50)), 200)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Base query
        query = {}
        try:
            company_oid = ObjectId(company_id)
            query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            query['companyId'] = company_id
        
        today = get_current_utc().replace(hour=0, minute=0, second=0, microsecond=0)
        
        if role == 'guard':
            # Security guards see today's visits
            query['$and'] = [
                {'expectedArrival': {'$gte': today}},
                {'expectedArrival': {'$lt': today + timedelta(days=1)}}
            ]
            query['status'] = {'$in': ['scheduled', 'checked_in', 'pending']}
        elif role == 'host' and host_id:
            # Hosts see their own pending visits
            query['hostEmployeeId'] = host_id
            query['status'] = {'$in': ['scheduled', 'pending', 'checked_in']}
        
        if since:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query['lastUpdated'] = {'$gt': since_dt}
        
        visits = list(visit_collection.find(query)
                     .sort('expectedArrival', 1)
                     .limit(limit))
        
        # Minimal fields for mobile
        mobile_visits = []
        for v in visits:
            mobile_visits.append({
                '_id': str(v['_id']),
                'visitorId': str(v.get('visitorId', '')),
                'visitorName': v.get('visitorName'),
                'hostEmployeeId': v.get('hostEmployeeId'),
                'hostEmployeeName': v.get('hostEmployeeName'),
                'purpose': v.get('purpose'),
                'expectedArrival': v.get('expectedArrival'),
                'actualArrival': v.get('actualArrival'),
                'status': v.get('status'),
                'approvalStatus': v.get('approvalStatus'),
                'locationName': v.get('locationName'),
                'checkInMethod': v.get('checkInMethod'),
                'lastUpdated': v.get('lastUpdated')
            })
        
        return jsonify({
            'visits': convert_objectids(mobile_visits),
            'count': len(mobile_visits),
            'syncTimestamp': get_current_utc().isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error syncing visits: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/quick-checkin', methods=['POST'])
@require_company_access
def quick_checkin():
    """
    Quick check-in for mobile guard app.
    
    Supports:
    - QR code scan
    - Face recognition match
    - Manual lookup
    
    Request Body:
        visitId (optional): Direct visit ID from QR
        visitorPhone (optional): Lookup by phone
        faceMatch (optional): Face recognition result
        deviceId (required): Device identifier
        deviceName (optional): Device display name
        method (required): qr, face, manual
    """
    try:
        data = request.json or {}
        visit_id = data.get('visitId')
        visitor_phone = data.get('visitorPhone')
        device_id = data.get('deviceId')
        method = data.get('method', 'manual')
        
        if not device_id:
            return jsonify({'error': 'Device ID is required'}), 400
        
        visit = None
        
        # Find visit by ID (QR code)
        if visit_id:
            visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        
        # Find by phone
        elif visitor_phone:
            visitor = visitor_collection.find_one({'phone': visitor_phone})
            if visitor:
                # Get today's scheduled visit for this visitor
                today = get_current_utc().replace(hour=0, minute=0, second=0, microsecond=0)
                visit = visit_collection.find_one({
                    'visitorId': visitor['_id'],
                    'status': 'scheduled',
                    'expectedArrival': {'$gte': today}
                })
        
        if not visit:
            return jsonify({'error': 'No scheduled visit found'}), 404
        
        if visit.get('status') != 'scheduled':
            return jsonify({
                'error': f'Visit is already {visit.get("status")}',
                'currentStatus': visit.get('status')
            }), 400
        
        # Check approval
        if visit.get('requiresApproval') and visit.get('approvalStatus') != 'approved':
            return jsonify({
                'error': 'Visit not yet approved',
                'approvalStatus': visit.get('approvalStatus')
            }), 400
        
        # Perform check-in
        now = get_current_utc()
        update_data = {
            'status': 'checked_in',
            'actualArrival': now,
            'checkInDeviceId': device_id,
            'checkInDeviceName': data.get('deviceName'),
            'checkInMethod': method,
            'lastUpdated': now
        }
        
        visit_collection.update_one(
            {'_id': visit['_id']},
            {'$set': update_data}
        )
        
        # Get visitor details for response
        visitor = visitor_collection.find_one({'_id': visit.get('visitorId')})
        
        return jsonify({
            'success': True,
            'message': 'Checked in successfully',
            'visitId': str(visit['_id']),
            'visitorName': visit.get('visitorName'),
            'hostEmployeeName': visit.get('hostEmployeeName'),
            'purpose': visit.get('purpose'),
            'checkInTime': now.isoformat(),
            'method': method
        }), 200
        
    except Exception as e:
        print(f"Error in quick check-in: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/quick-checkout', methods=['POST'])
@require_company_access
def quick_checkout():
    """
    Quick check-out for mobile guard app.
    """
    try:
        data = request.json or {}
        visit_id = data.get('visitId')
        device_id = data.get('deviceId')
        method = data.get('method', 'manual')
        
        if not visit_id:
            return jsonify({'error': 'Visit ID is required'}), 400
        
        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return jsonify({'error': 'Visit not found'}), 404
        
        if visit.get('status') != 'checked_in':
            return jsonify({'error': f'Visit is {visit.get("status")}, not checked in'}), 400
        
        now = get_current_utc()
        
        # Calculate duration
        duration_minutes = None
        if visit.get('actualArrival'):
            duration = now - visit['actualArrival']
            duration_minutes = int(duration.total_seconds() / 60)
        
        update_data = {
            'status': 'checked_out',
            'actualDeparture': now,
            'checkOutDeviceId': device_id,
            'checkOutDeviceName': data.get('deviceName'),
            'checkOutMethod': method,
            'durationMinutes': duration_minutes,
            'lastUpdated': now
        }
        
        visit_collection.update_one(
            {'_id': visit['_id']},
            {'$set': update_data}
        )
        
        return jsonify({
            'success': True,
            'message': 'Checked out successfully',
            'visitId': str(visit['_id']),
            'visitorName': visit.get('visitorName'),
            'checkOutTime': now.isoformat(),
            'durationMinutes': duration_minutes
        }), 200
        
    except Exception as e:
        print(f"Error in quick checkout: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/push/register', methods=['POST'])
@require_company_access
def register_push_device():
    """
    Register device for push notifications.
    
    Request Body:
        userId (required): Employee or user ID
        deviceToken (required): FCM/APNS token
        platform (required): android, ios
        deviceId (optional): Unique device identifier
    """
    try:
        data = request.json or {}
        user_id = data.get('userId')
        device_token = data.get('deviceToken')
        platform = data.get('platform')
        
        if not user_id or not device_token or not platform:
            return jsonify({'error': 'userId, deviceToken, and platform are required'}), 400
        
        if platform not in ['android', 'ios']:
            return jsonify({'error': 'Platform must be android or ios'}), 400
        
        db = get_db()
        push_devices = db['push_devices']
        
        # Upsert device
        push_devices.update_one(
            {'deviceToken': device_token},
            {
                '$set': {
                    'userId': user_id,
                    'deviceToken': device_token,
                    'platform': platform,
                    'deviceId': data.get('deviceId'),
                    'lastUpdated': get_current_utc(),
                    'active': True
                },
                '$setOnInsert': {
                    'createdAt': get_current_utc()
                }
            },
            upsert=True
        )
        
        return jsonify({
            'message': 'Device registered for push notifications',
            'userId': user_id,
            'platform': platform
        }), 200
        
    except Exception as e:
        print(f"Error registering push device: {e}")
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/push/unregister', methods=['POST'])
@require_company_access
def unregister_push_device():
    """Unregister device from push notifications"""
    try:
        data = request.json or {}
        device_token = data.get('deviceToken')
        
        if not device_token:
            return jsonify({'error': 'Device token is required'}), 400
        
        db = get_db()
        db['push_devices'].update_one(
            {'deviceToken': device_token},
            {'$set': {'active': False, 'lastUpdated': get_current_utc()}}
        )
        
        return jsonify({'message': 'Device unregistered'}), 200
        
    except Exception as e:
        print(f"Error unregistering push device: {e}")
        return jsonify({'error': str(e)}), 500


@mobile_bp.route('/dashboard-summary', methods=['GET'])
@require_company_access
def get_dashboard_summary():
    """
    Get quick dashboard summary for mobile home screen.
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        today = get_current_utc().replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        
        # Build company query
        try:
            company_oid = ObjectId(company_id)
            company_query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
        except:
            company_query = {'companyId': company_id}
        
        # Today's stats
        scheduled_query = {**company_query, 'status': 'scheduled', 'expectedArrival': {'$gte': today, '$lt': tomorrow}}
        checked_in_query = {**company_query, 'status': 'checked_in'}
        checked_out_query = {**company_query, 'status': 'checked_out', 'actualDeparture': {'$gte': today}}
        
        summary = {
            'today': {
                'scheduled': visit_collection.count_documents(scheduled_query),
                'checkedIn': visit_collection.count_documents(checked_in_query),
                'checkedOut': visit_collection.count_documents(checked_out_query)
            },
            'currentlyOnSite': visit_collection.count_documents(checked_in_query),
            'pendingApprovals': visit_collection.count_documents({
                **company_query,
                'status': 'scheduled',
                'approvalStatus': 'pending'
            }),
            'generatedAt': get_current_utc().isoformat()
        }
        
        return jsonify(summary), 200
        
    except Exception as e:
        print(f"Error getting dashboard summary: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
