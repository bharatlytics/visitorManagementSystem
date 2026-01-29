"""
Simple Data Provider Endpoints for VMS Frontend

These endpoints provide a simple interface for the VMS frontend to fetch
employees and entities using the data_provider service which handles
residency-aware data fetching.
"""
from flask import Blueprint, request, jsonify
from app.services.data_provider import DataProvider
from app.auth import require_auth

data_endpoints_bp = Blueprint('data_endpoints', __name__)


@data_endpoints_bp.route('/employees', methods=['GET'])
@require_auth
def get_employees():
    """
    Get employees for the current company.
    Uses data_provider which respects residency mode and manifest mappings.
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return jsonify({'error': 'companyId is required'}), 400
        
        provider = DataProvider(company_id)
        employees = provider.get_employees(company_id)
        
        return jsonify({
            'employees': employees,
            'count': len(employees)
        })
    except Exception as e:
        print(f"[data_endpoints] Error fetching employees: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@data_endpoints_bp.route('/entities', methods=['GET'])
@require_auth
def get_entities():
    """
    Get entities (locations) for the current company.
    Uses data_provider which respects residency mode and manifest mappings.
    """
    try:
        company_id = request.args.get('companyId')
        if not company_id:
            return jsonify({'error': 'companyId is required'}), 400
        
        provider = DataProvider(company_id)
        entities = provider.get_entities(company_id)
        
        return jsonify({
            'entities': entities,
            'count': len(entities)
        })
    except Exception as e:
        print(f"[data_endpoints] Error fetching entities: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
