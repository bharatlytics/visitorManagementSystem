"""
Attendance API - Employee Attendance Management

Endpoints for fetching and recording employee attendance.
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timezone
from app.db import attendance_collection, employee_collection
from app.utils import error_response, get_current_utc

attendance_bp = Blueprint('attendance', __name__)


def convert_objectids(obj):
    """Convert ObjectIds to strings recursively"""
    if isinstance(obj, dict):
        return {k: convert_objectids(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectids(item) for item in obj]
    elif isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


@attendance_bp.route('', methods=['GET'])
def list_attendance():
    """
    List attendance records for a company.
    
    Query params:
    - companyId (required): Company ID
    - employeeId (optional): Filter by employee
    - startDate (optional): Filter from date (ISO format)
    - endDate (optional): Filter to date (ISO format)
    - attendanceType (optional): Filter by IN/OUT
    - limit (optional): Max records to return (default 100)
    - skip (optional): Records to skip for pagination
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return error_response('companyId is required', 400)
        
        try:
            company_oid = ObjectId(company_id)
        except InvalidId:
            return error_response('Invalid companyId format', 400)
        
        # Build query
        query = {'companyId': company_oid}
        
        # Optional filters
        employee_id = request.args.get('employeeId')
        if employee_id:
            try:
                query['employeeId'] = ObjectId(employee_id)
            except InvalidId:
                return error_response('Invalid employeeId format', 400)
        
        start_date = request.args.get('startDate')
        end_date = request.args.get('endDate')
        if start_date or end_date:
            query['attendanceTime'] = {}
            if start_date:
                query['attendanceTime']['$gte'] = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if end_date:
                query['attendanceTime']['$lte'] = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        
        attendance_type = request.args.get('attendanceType')
        if attendance_type:
            query['attendanceType'] = attendance_type.upper()
        
        # Pagination
        limit = int(request.args.get('limit', 100))
        skip = int(request.args.get('skip', 0))
        
        # Fetch attendance records
        cursor = attendance_collection.find(query).sort('attendanceTime', -1).skip(skip).limit(limit)
        records = list(cursor)
        
        # Enrich with employee names
        employee_ids = list(set(r.get('employeeId') for r in records if r.get('employeeId')))
        employees = {}
        if employee_ids:
            emp_cursor = employee_collection.find({'_id': {'$in': employee_ids}}, {'employeeName': 1, 'name': 1})
            for emp in emp_cursor:
                employees[emp['_id']] = emp.get('employeeName') or emp.get('name', 'Unknown')
        
        # Format response
        result = []
        for record in records:
            emp_id = record.get('employeeId')
            formatted = {
                '_id': str(record['_id']),
                'employeeId': str(emp_id) if emp_id else None,
                'employeeName': employees.get(emp_id, 'Unknown') if emp_id else None,
                'visitorId': str(record.get('visitorId')) if record.get('visitorId') else None,
                'personType': 'employee' if emp_id else 'visitor',
                'attendanceTime': record.get('attendanceTime').isoformat() if record.get('attendanceTime') else None,
                'attendanceType': record.get('attendanceType'),
                'shiftId': record.get('shiftId'),
                'location': record.get('location'),
                'recognition': record.get('recognition'),
                'device': record.get('device'),
                'syncStatus': record.get('syncStatus', 1),
                'transactionFrom': record.get('transactionFrom'),
                'remarks': record.get('remarks'),
                'createdAt': record.get('createdAt').isoformat() if record.get('createdAt') else None,
                'updatedAt': record.get('updatedAt').isoformat() if record.get('updatedAt') else None
            }
            result.append(formatted)
        
        # Get total count
        total = attendance_collection.count_documents(query)
        
        return jsonify({
            'attendance': result,
            'total': total,
            'limit': limit,
            'skip': skip
        })
    
    except Exception as e:
        print(f"[attendance] Error listing attendance: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@attendance_bp.route('', methods=['POST'])
def create_attendance():
    """
    Create a new attendance record.
    
    Body: Attendance record data
    """
    try:
        data = request.get_json()
        if not data:
            return error_response('Request body is required', 400)
        
        # Required fields
        company_id = data.get('companyId')
        if not company_id:
            return error_response('companyId is required', 400)
        
        employee_id = data.get('employeeId')
        visitor_id = data.get('visitorId')
        if not employee_id and not visitor_id:
            return error_response('Either employeeId or visitorId is required', 400)
        
        attendance_type = data.get('attendanceType')
        if not attendance_type:
            return error_response('attendanceType is required', 400)
        
        now = get_current_utc()
        
        # Build attendance document
        attendance_doc = {
            'companyId': ObjectId(company_id),
            'employeeId': ObjectId(employee_id) if employee_id else None,
            'visitorId': ObjectId(visitor_id) if visitor_id else None,
            'attendanceTime': datetime.fromisoformat(data['attendanceTime'].replace('Z', '+00:00')) if data.get('attendanceTime') else now,
            'attendanceType': attendance_type.upper(),
            'shiftId': data.get('shiftId'),
            'location': data.get('location'),
            'recognition': data.get('recognition'),
            'device': data.get('device'),
            'syncStatus': data.get('syncStatus', 1),
            'transactionFrom': data.get('transactionFrom', 'mobileApp'),
            'remarks': data.get('remarks'),
            'createdAt': now,
            'updatedAt': now
        }
        
        # Insert
        result = attendance_collection.insert_one(attendance_doc)
        
        return jsonify({
            'message': 'Attendance recorded successfully',
            'attendanceId': str(result.inserted_id)
        }), 201
    
    except Exception as e:
        print(f"[attendance] Error creating attendance: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)


@attendance_bp.route('/<attendance_id>', methods=['GET'])
def get_attendance(attendance_id):
    """Get a single attendance record by ID"""
    try:
        try:
            att_oid = ObjectId(attendance_id)
        except InvalidId:
            return error_response('Invalid attendance ID format', 400)
        
        record = attendance_collection.find_one({'_id': att_oid})
        if not record:
            return error_response('Attendance record not found', 404)
        
        # Get employee name
        employee_name = None
        if record.get('employeeId'):
            emp = employee_collection.find_one({'_id': record['employeeId']}, {'employeeName': 1, 'name': 1})
            if emp:
                employee_name = emp.get('employeeName') or emp.get('name')
        
        return jsonify(convert_objectids({
            **record,
            'employeeName': employee_name
        }))
    
    except Exception as e:
        print(f"[attendance] Error getting attendance: {e}")
        return error_response(str(e), 500)


@attendance_bp.route('/bulk', methods=['POST'])
def bulk_create_attendance():
    """
    Create multiple attendance records at once (for offline sync).
    
    Body: { "records": [...] }
    """
    try:
        data = request.get_json()
        if not data or 'records' not in data:
            return error_response('records array is required', 400)
        
        records = data['records']
        if not records:
            return error_response('records array cannot be empty', 400)
        
        now = get_current_utc()
        docs_to_insert = []
        
        for record in records:
            company_id = record.get('companyId')
            employee_id = record.get('employeeId')
            visitor_id = record.get('visitorId')
            
            if not company_id or (not employee_id and not visitor_id):
                continue  # Skip invalid records
            
            attendance_doc = {
                'companyId': ObjectId(company_id),
                'employeeId': ObjectId(employee_id) if employee_id else None,
                'visitorId': ObjectId(visitor_id) if visitor_id else None,
                'attendanceTime': datetime.fromisoformat(record['attendanceTime'].replace('Z', '+00:00')) if record.get('attendanceTime') else now,
                'attendanceType': record.get('attendanceType', 'IN').upper(),
                'shiftId': record.get('shiftId'),
                'location': record.get('location'),
                'recognition': record.get('recognition'),
                'device': record.get('device'),
                'syncStatus': record.get('syncStatus', 1),
                'transactionFrom': record.get('transactionFrom', 'mobileApp'),
                'remarks': record.get('remarks'),
                'createdAt': now,
                'updatedAt': now
            }
            docs_to_insert.append(attendance_doc)
        
        if not docs_to_insert:
            return error_response('No valid records to insert', 400)
        
        result = attendance_collection.insert_many(docs_to_insert)
        
        return jsonify({
            'message': f'Successfully inserted {len(result.inserted_ids)} attendance records',
            'insertedCount': len(result.inserted_ids),
            'insertedIds': [str(id) for id in result.inserted_ids]
        }), 201
    
    except Exception as e:
        print(f"[attendance] Error bulk creating attendance: {e}")
        import traceback
        traceback.print_exc()
        return error_response(str(e), 500)
