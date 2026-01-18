"""
Emergency Evacuation API

Provides endpoints for emergency response and evacuation management:
- Real-time list of all on-site visitors
- Evacuation mode trigger
- Muster point check-in
- Headcount and status tracking
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timezone
from app.db import visit_collection, visitor_collection, employee_collection, get_db
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

evacuation_bp = Blueprint('evacuation', __name__)


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


@evacuation_bp.route('/evacuation-list', methods=['GET'])
@require_company_access
def get_evacuation_list():
    """
    Get real-time list of all currently checked-in visitors.
    
    Critical for emergency response - provides instant headcount of all
    visitors currently on-site with their host and location information.
    
    Query Parameters:
        companyId (required): Company ObjectId
        locationId (optional): Filter by specific location
        includeEmployees (optional): Include checked-in employees (default: false)
    
    Returns:
        JSON with visitors array containing:
        - visitorId, visitorName, phone
        - hostEmployeeName, hostEmployeePhone
        - locationName, checkInTime
        - status (on_site, evacuated, missing)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        location_id = request.args.get('locationId')
        include_employees = request.args.get('includeEmployees', 'false').lower() == 'true'
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Build query for checked-in visits
        query = {
            'status': 'checked_in'
        }
        
        # Handle both ObjectId and string companyId
        try:
            company_oid = ObjectId(company_id)
            query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            query['companyId'] = company_id
        
        if location_id:
            try:
                query['locationId'] = ObjectId(location_id)
            except:
                query['locationId'] = location_id
        
        # Fetch all checked-in visits
        visits = list(visit_collection.find(query))
        
        evacuation_list = []
        for visit in visits:
            # Get visitor details
            visitor = visitor_collection.find_one({'_id': visit.get('visitorId')})
            
            # Get host employee details
            host = None
            host_id = visit.get('hostEmployeeId')
            if host_id:
                try:
                    host = employee_collection.find_one({'_id': ObjectId(host_id)})
                except:
                    host = employee_collection.find_one({'employeeId': host_id})
            
            evacuation_entry = {
                'visitId': str(visit['_id']),
                'visitorId': str(visit.get('visitorId', '')),
                'visitorName': visit.get('visitorName') or (visitor.get('visitorName') if visitor else 'Unknown'),
                'visitorPhone': visitor.get('phone', '') if visitor else '',
                'visitorOrganization': visitor.get('organization', '') if visitor else '',
                'hostEmployeeId': str(host_id) if host_id else '',
                'hostEmployeeName': visit.get('hostEmployeeName') or (host.get('employeeName') if host else 'Unknown'),
                'hostEmployeePhone': host.get('phone', '') if host else '',
                'hostEmployeeEmail': host.get('email', '') if host else '',
                'locationId': str(visit.get('locationId', '')),
                'locationName': visit.get('locationName', 'Main Building'),
                'checkInTime': visit.get('actualArrival'),
                'checkInMethod': visit.get('checkInMethod', 'unknown'),
                'purpose': visit.get('purpose', ''),
                'accessZones': visit.get('accessAreas', []),
                'evacuationStatus': visit.get('evacuationStatus', 'on_site'),  # on_site, evacuated, missing
                'musterPoint': visit.get('musterPoint'),
                'musterCheckInTime': visit.get('musterCheckInTime')
            }
            
            evacuation_list.append(evacuation_entry)
        
        # Calculate summary
        total_on_site = len(evacuation_list)
        evacuated_count = sum(1 for e in evacuation_list if e['evacuationStatus'] == 'evacuated')
        missing_count = sum(1 for e in evacuation_list if e['evacuationStatus'] == 'missing')
        
        return jsonify({
            'evacuationList': convert_objectids(evacuation_list),
            'summary': {
                'totalOnSite': total_on_site,
                'evacuatedCount': evacuated_count,
                'missingCount': missing_count,
                'accountedFor': evacuated_count,
                'percentAccountedFor': round((evacuated_count / total_on_site * 100) if total_on_site > 0 else 100, 1)
            },
            'generatedAt': get_current_utc().isoformat(),
            'companyId': company_id
        }), 200
        
    except Exception as e:
        print(f"Error getting evacuation list: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@evacuation_bp.route('/trigger', methods=['POST'])
@require_company_access
def trigger_evacuation():
    """
    Trigger evacuation mode for a company/location.
    
    This will:
    1. Set all current visits to evacuation mode
    2. Send push notifications to all hosts
    3. Display evacuation instructions on kiosks
    4. Generate initial evacuation list
    
    Request Body:
        companyId (required): Company ObjectId
        locationId (optional): Specific location, or all if not specified
        reason (optional): Evacuation reason (fire, drill, security, other)
        musterPoints (optional): List of assembly point locations
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        location_id = data.get('locationId')
        reason = data.get('reason', 'emergency')
        muster_points = data.get('musterPoints', ['Main Assembly Point'])
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        # Get or create evacuation record
        db = get_db()
        evacuations_collection = db['evacuations']
        
        # Check if evacuation already in progress
        active_evacuation = evacuations_collection.find_one({
            'companyId': company_id,
            'status': 'in_progress'
        })
        
        if active_evacuation:
            return jsonify({
                'error': 'Evacuation already in progress',
                'evacuationId': str(active_evacuation['_id']),
                'startedAt': active_evacuation.get('startedAt')
            }), 409
        
        # Create evacuation record
        evacuation_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'locationId': location_id,
            'reason': reason,
            'musterPoints': muster_points,
            'status': 'in_progress',
            'startedAt': get_current_utc(),
            'startedBy': getattr(request, 'user_id', 'system'),
            'endedAt': None,
            'totalVisitors': 0,
            'totalEvacuated': 0
        }
        
        evacuations_collection.insert_one(evacuation_doc)
        
        # Build query for visits to update
        visit_query = {'status': 'checked_in'}
        try:
            company_oid = ObjectId(company_id)
            visit_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            visit_query['companyId'] = company_id
            
        if location_id:
            visit_query['locationId'] = location_id
        
        # Count visitors
        visitor_count = visit_collection.count_documents(visit_query)
        
        # Update all checked-in visits with evacuation status
        visit_collection.update_many(
            visit_query,
            {
                '$set': {
                    'evacuationStatus': 'on_site',  # Will change to 'evacuated' when they check in at muster
                    'evacuationId': evacuation_doc['_id'],
                    'evacuationStartedAt': get_current_utc()
                }
            }
        )
        
        # Update evacuation record with visitor count
        evacuations_collection.update_one(
            {'_id': evacuation_doc['_id']},
            {'$set': {'totalVisitors': visitor_count}}
        )
        
        # TODO: Send push notifications to all hosts
        # TODO: Trigger kiosk evacuation mode
        # TODO: Publish event to platform
        
        return jsonify({
            'message': 'Evacuation triggered successfully',
            'evacuationId': str(evacuation_doc['_id']),
            'totalVisitors': visitor_count,
            'musterPoints': muster_points,
            'status': 'in_progress',
            'startedAt': evacuation_doc['startedAt'].isoformat()
        }), 201
        
    except Exception as e:
        print(f"Error triggering evacuation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@evacuation_bp.route('/muster-checkin', methods=['POST'])
@require_company_access
def muster_checkin():
    """
    Check in a visitor at a muster/assembly point.
    
    Called when a visitor arrives at an assembly point during evacuation.
    Updates their evacuation status from 'on_site' to 'evacuated'.
    
    Request Body:
        visitId (required): Visit ObjectId
        musterPoint (required): Which assembly point they checked in at
        method (optional): How they were identified (face, badge, manual)
    """
    try:
        data = request.json or {}
        visit_id = data.get('visitId')
        muster_point = data.get('musterPoint', 'Main Assembly Point')
        method = data.get('method', 'manual')
        
        if not visit_id:
            return jsonify({'error': 'Visit ID is required'}), 400
        
        # Find and update the visit
        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return jsonify({'error': 'Visit not found'}), 404
        
        if visit.get('status') != 'checked_in':
            return jsonify({'error': 'Visitor is not currently checked in'}), 400
        
        if visit.get('evacuationStatus') == 'evacuated':
            return jsonify({
                'message': 'Visitor already checked in at muster point',
                'musterPoint': visit.get('musterPoint'),
                'musterCheckInTime': visit.get('musterCheckInTime')
            }), 200
        
        # Update visit with muster check-in
        visit_collection.update_one(
            {'_id': ObjectId(visit_id)},
            {
                '$set': {
                    'evacuationStatus': 'evacuated',
                    'musterPoint': muster_point,
                    'musterCheckInTime': get_current_utc(),
                    'musterCheckInMethod': method
                }
            }
        )
        
        # Update evacuation record counter
        if visit.get('evacuationId'):
            db = get_db()
            db['evacuations'].update_one(
                {'_id': visit['evacuationId']},
                {'$inc': {'totalEvacuated': 1}}
            )
        
        # Get visitor name for response
        visitor_name = visit.get('visitorName', 'Unknown')
        
        return jsonify({
            'message': 'Muster check-in successful',
            'visitId': visit_id,
            'visitorName': visitor_name,
            'musterPoint': muster_point,
            'checkedInAt': get_current_utc().isoformat(),
            'method': method
        }), 200
        
    except Exception as e:
        print(f"Error during muster check-in: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@evacuation_bp.route('/status', methods=['GET'])
@require_company_access
def get_evacuation_status():
    """
    Get current evacuation status and headcount.
    
    Returns real-time status of ongoing evacuation including:
    - Total visitors on-site at start
    - Number evacuated (checked in at muster)
    - Number still missing
    - List of missing visitors
    
    Query Parameters:
        companyId (required): Company ObjectId
        evacuationId (optional): Specific evacuation, or latest if not specified
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        evacuation_id = request.args.get('evacuationId')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        evacuations_collection = db['evacuations']
        
        # Find evacuation
        if evacuation_id:
            evacuation = evacuations_collection.find_one({'_id': ObjectId(evacuation_id)})
        else:
            # Get latest/active evacuation
            evacuation = evacuations_collection.find_one(
                {'companyId': company_id, 'status': 'in_progress'},
                sort=[('startedAt', -1)]
            )
        
        if not evacuation:
            return jsonify({
                'active': False,
                'message': 'No active evacuation',
                'lastEvacuation': None
            }), 200
        
        # Get real-time counts from visits
        evacuated_count = visit_collection.count_documents({
            'evacuationId': evacuation['_id'],
            'evacuationStatus': 'evacuated'
        })
        
        on_site_count = visit_collection.count_documents({
            'evacuationId': evacuation['_id'],
            'evacuationStatus': 'on_site'
        })
        
        # Get list of missing visitors (still on_site status)
        missing_visitors = list(visit_collection.find({
            'evacuationId': evacuation['_id'],
            'evacuationStatus': 'on_site'
        }))
        
        missing_list = []
        for visit in missing_visitors:
            visitor = visitor_collection.find_one({'_id': visit.get('visitorId')})
            host_id = visit.get('hostEmployeeId')
            host = None
            if host_id:
                try:
                    host = employee_collection.find_one({'_id': ObjectId(host_id)})
                except:
                    host = employee_collection.find_one({'employeeId': host_id})
            
            missing_list.append({
                'visitId': str(visit['_id']),
                'visitorName': visit.get('visitorName') or (visitor.get('visitorName') if visitor else 'Unknown'),
                'visitorPhone': visitor.get('phone', '') if visitor else '',
                'hostEmployeeName': host.get('employeeName', '') if host else '',
                'hostEmployeePhone': host.get('phone', '') if host else '',
                'lastKnownLocation': visit.get('locationName', 'Unknown'),
                'checkInTime': visit.get('actualArrival')
            })
        
        total_visitors = evacuated_count + on_site_count
        
        return jsonify({
            'active': evacuation['status'] == 'in_progress',
            'evacuationId': str(evacuation['_id']),
            'reason': evacuation.get('reason', 'emergency'),
            'startedAt': evacuation.get('startedAt'),
            'musterPoints': evacuation.get('musterPoints', []),
            'counts': {
                'total': total_visitors,
                'evacuated': evacuated_count,
                'missing': on_site_count,
                'percentSafe': round((evacuated_count / total_visitors * 100) if total_visitors > 0 else 100, 1)
            },
            'missingVisitors': convert_objectids(missing_list),
            'status': evacuation['status']
        }), 200
        
    except Exception as e:
        print(f"Error getting evacuation status: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@evacuation_bp.route('/end', methods=['POST'])
@require_company_access
def end_evacuation():
    """
    End an active evacuation.
    
    Marks the evacuation as complete and clears evacuation status from visits.
    Should be called after all-clear is given.
    
    Request Body:
        companyId (required): Company ObjectId
        evacuationId (optional): Specific evacuation ID, or ends current active one
        notes (optional): End notes/summary
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        evacuation_id = data.get('evacuationId')
        notes = data.get('notes', '')
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        evacuations_collection = db['evacuations']
        
        # Find evacuation
        if evacuation_id:
            evacuation = evacuations_collection.find_one({'_id': ObjectId(evacuation_id)})
        else:
            evacuation = evacuations_collection.find_one({
                'companyId': company_id,
                'status': 'in_progress'
            })
        
        if not evacuation:
            return jsonify({'error': 'No active evacuation found'}), 404
        
        # Get final counts
        final_evacuated = visit_collection.count_documents({
            'evacuationId': evacuation['_id'],
            'evacuationStatus': 'evacuated'
        })
        
        final_missing = visit_collection.count_documents({
            'evacuationId': evacuation['_id'],
            'evacuationStatus': 'on_site'
        })
        
        # End evacuation
        evacuations_collection.update_one(
            {'_id': evacuation['_id']},
            {
                '$set': {
                    'status': 'completed',
                    'endedAt': get_current_utc(),
                    'endedBy': getattr(request, 'user_id', 'system'),
                    'endNotes': notes,
                    'finalEvacuated': final_evacuated,
                    'finalMissing': final_missing
                }
            }
        )
        
        # Clear evacuation status from visits (but keep record of what happened)
        visit_collection.update_many(
            {'evacuationId': evacuation['_id']},
            {
                '$set': {
                    'evacuationEnded': True,
                    'evacuationEndedAt': get_current_utc()
                },
                '$unset': {
                    'evacuationStatus': ''
                }
            }
        )
        
        duration_seconds = (get_current_utc() - evacuation['startedAt']).total_seconds()
        
        return jsonify({
            'message': 'Evacuation ended successfully',
            'evacuationId': str(evacuation['_id']),
            'duration': {
                'seconds': int(duration_seconds),
                'minutes': round(duration_seconds / 60, 1)
            },
            'finalCounts': {
                'evacuated': final_evacuated,
                'missing': final_missing,
                'total': final_evacuated + final_missing
            },
            'endedAt': get_current_utc().isoformat()
        }), 200
        
    except Exception as e:
        print(f"Error ending evacuation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@evacuation_bp.route('/history', methods=['GET'])
@require_company_access  
def get_evacuation_history():
    """
    Get history of past evacuations for compliance reporting.
    
    Query Parameters:
        companyId (required): Company ObjectId
        limit (optional): Number of records (default: 20)
        offset (optional): Pagination offset
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        limit = int(request.args.get('limit', 20))
        offset = int(request.args.get('offset', 0))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        evacuations_collection = db['evacuations']
        
        evacuations = list(evacuations_collection.find(
            {'companyId': company_id}
        ).sort('startedAt', -1).skip(offset).limit(limit))
        
        total = evacuations_collection.count_documents({'companyId': company_id})
        
        return jsonify({
            'evacuations': convert_objectids(evacuations),
            'total': total,
            'limit': limit,
            'offset': offset
        }), 200
        
    except Exception as e:
        print(f"Error getting evacuation history: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
