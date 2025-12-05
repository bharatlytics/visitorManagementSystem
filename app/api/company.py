"""
VMS Company API
"""
from flask import Blueprint, jsonify, request, session
from app.db import companies_collection
from app.auth import require_auth

company_bp = Blueprint('company', __name__)


@company_bp.route('', methods=['GET'])
@company_bp.route('/', methods=['GET'])
@require_auth
def get_company():
    """Get current company details"""
    company_id = request.company_id
    
    if not company_id:
        return jsonify({'error': 'No company context'}), 400
    
    return _get_company_details(company_id)


@company_bp.route('/<company_id>', methods=['GET'])
def get_company_by_id(company_id):
    """Get company details by ID (for connected mode)"""
    # Try to authenticate but don't require it
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        from app.auth import decode_token
        token = auth_header[7:]
        payload = decode_token(token)
        if payload:
            request.user_id = payload.get('user_id')
            request.company_id = payload.get('company_id')
    
    # Check session
    if session.get('user_id'):
        request.user_id = session.get('user_id')
        request.company_id = session.get('company_id')
    
    return _get_company_details(company_id)


def _get_company_details(company_id):
    """Helper to get company details"""
    from bson import ObjectId
    
    if not company_id or company_id == 'null' or company_id == 'undefined':
        return jsonify({'error': 'Invalid company ID'}), 400
    
    # Try local database first
    company = None
    try:
        company = companies_collection.find_one({'_id': ObjectId(company_id)})
    except:
        company = companies_collection.find_one({'companyId': company_id})
    
    if company:
        return jsonify({
            'company': {
                '_id': str(company.get('_id')),
                'name': company.get('companyName') or company.get('name'),
                'logo': company.get('logo'),
                'connected': bool(session.get('platform_token'))
            }
        })
    
    # For connected mode, return placeholder if company not in local DB
    if session.get('platform_token'):
        return jsonify({
            'company': {
                '_id': company_id,
                'name': session.get('company_name', 'Connected Company'),
                'logo': None,
                'connected': True
            }
        })
    
    # Try to fetch from platform if client is available
    try:
        from app.services.platform_client import platform_client
        if platform_client:
            company_data = platform_client.make_request(f'/companies/{company_id}')
            if company_data:
                return jsonify({
                    'company': {
                        '_id': company_id,
                        'name': company_data.get('name') or company_data.get('companyName'),
                        'logo': company_data.get('logo'),
                        'connected': True
                    }
                })
    except Exception as e:
        print(f"[Company] Platform fetch failed: {e}")
    
    return jsonify({'error': 'Company not found'}), 404
