"""
Employees API - Uses DataProvider for dual-mode support
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId

from app.auth import require_auth
from app.services import get_data_provider
from app.db import employees_collection

employees_bp = Blueprint('employees', __name__)


@employees_bp.route('', methods=['GET'])
@require_auth
def list_employees():
    """List employees - from platform or local DB based on mode"""
    company_id = request.args.get('companyId') or request.company_id
    print(f"[API/employees] GET /employees?companyId={company_id}")
    
    data_provider = get_data_provider(company_id)
    print(f"[API/employees] data_provider.is_connected = {data_provider.is_connected}")
    
    employees = data_provider.get_employees(company_id)
    print(f"[API/employees] Got {len(employees)} employees")
    
    # Convert ObjectIds to strings
    result = []
    for emp in employees:
        emp_dict = dict(emp) if hasattr(emp, 'items') else emp
        if '_id' in emp_dict and isinstance(emp_dict['_id'], ObjectId):
            emp_dict['_id'] = str(emp_dict['_id'])
        result.append(emp_dict)
    
    return jsonify(result)


@employees_bp.route('/<employee_id>', methods=['GET'])
@require_auth
def get_employee(employee_id):
    """Get single employee"""
    company_id = request.args.get('companyId') or request.company_id
    
    data_provider = get_data_provider(company_id)
    employee = data_provider.get_employee_by_id(employee_id, company_id)
    
    if not employee:
        return jsonify({'error': 'Employee not found'}), 404
    
    if '_id' in employee and isinstance(employee['_id'], ObjectId):
        employee['_id'] = str(employee['_id'])
    
    return jsonify(employee)


# Standalone mode only - create/update employees
@employees_bp.route('', methods=['POST'])
@require_auth
def create_employee():
    """Create employee (standalone mode only)"""
    from app.config import Config
    if Config.is_connected_mode():
        return jsonify({'error': 'Cannot create employees in connected mode'}), 400
    
    data = request.json or {}
    company_id = data.get('companyId') or request.company_id
    
    employee = {
        '_id': ObjectId(),
        'companyId': ObjectId(company_id),
        'employeeName': data.get('employeeName'),
        'email': data.get('email'),
        'phone': data.get('phone'),
        'department': data.get('department'),
        'designation': data.get('designation')
    }
    
    employees_collection.insert_one(employee)
    
    return jsonify({
        'id': str(employee['_id']),
        'message': 'Employee created'
    }), 201
