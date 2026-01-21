"""
VMS Authentication Module

Supports:
- Local login (standalone mode)
- Platform SSO (connected mode)
"""
from flask import Blueprint, request, jsonify, session
import jwt
from datetime import datetime, timedelta
from functools import wraps
from passlib.hash import bcrypt

from app.config import Config
from app.db import users_collection
from app.services.platform_client import platform_client

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')


def create_token(user_id, company_id, role='employee', expires_hours=24):
    """Create JWT token with role"""
    payload = {
        'user_id': str(user_id),
        'company_id': str(company_id),
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=expires_hours),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm=Config.JWT_ALGORITHM)


def decode_token(token):
    """Decode and validate JWT token"""
    try:
        return jwt.decode(token, Config.JWT_SECRET, algorithms=[Config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def require_auth(f):
    """Authentication decorator - sets user_id, company_id, and user_role on request"""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check for Bearer token
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            payload = decode_token(token)
            if payload:
                request.user_id = payload.get('user_id')
                request.company_id = payload.get('company_id')
                request.user_role = payload.get('role', 'employee')
                return f(*args, **kwargs)
        
        # Check session
        if session.get('user_id'):
            request.user_id = session['user_id']
            request.company_id = session.get('company_id')
            request.user_role = session.get('user_role', 'employee')
            return f(*args, **kwargs)
        
        return jsonify({'error': 'Authentication required'}), 401
    return decorated


def require_company_access(f):
    """
    Authentication + Authorization decorator.
    
    Validates that:
    1. User is authenticated (has valid token/session)
    2. Requested companyId matches the user's company from token
    
    This prevents users from accessing data from other companies.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Step 1: Authenticate user
        token_company_id = None
        
        # Check for Bearer token
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            payload = decode_token(token)
            if not payload:
                return jsonify({'error': 'Invalid or expired token'}), 401
            
            token_company_id = payload.get('company_id')
            request.user_id = payload.get('user_id')
            request.company_id = token_company_id
        
        # Check session (fallback for browser)
        elif session.get('user_id'):
            token_company_id = session.get('company_id')
            request.user_id = session['user_id']
            request.company_id = token_company_id
        
        else:
            return jsonify({'error': 'Authentication required'}), 401
        
        # Step 2: Extract requested company ID from request
        requested_company_id = None
        
        # Check query parameters (GET requests)
        if request.args.get('companyId'):
            requested_company_id = request.args.get('companyId')
        
        # Check JSON body (POST/PATCH requests)
        elif request.is_json and request.json and request.json.get('companyId'):
            requested_company_id = request.json.get('companyId')
        
        # Check form data (multipart/form-data)
        elif request.form.get('companyId'):
            requested_company_id = request.form.get('companyId')
        
        if not requested_company_id:
            return jsonify({
                'error': 'Company ID required',
                'message': 'companyId must be provided in request'
            }), 400
        
        # Step 3: CRITICAL - Validate company access
        # Convert both to strings for comparison (handles ObjectId vs string)
        if str(token_company_id) != str(requested_company_id):
            return jsonify({
                'error': 'Access denied',
                'message': 'You can only access data from your own company',
                'yourCompanyId': str(token_company_id),
                'requestedCompanyId': str(requested_company_id)
            }), 403
        
        # Authorization passed - proceed with request
        return f(*args, **kwargs)
    
    return decorated



# =====================================
# Local Authentication (Standalone Mode)
# =====================================

@auth_bp.route('/login', methods=['POST'])
def login():
    """Local login for standalone mode"""
    data = request.json or {}
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    
    # Find user (case-insensitive email)
    user = users_collection.find_one({'email': email.lower()})
    if not user:
        # Try original case
        user = users_collection.find_one({'email': email})
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Check if user is active
    if user.get('status') == 'inactive':
        return jsonify({'error': 'Account is deactivated'}), 401
    if user.get('status') == 'invited':
        return jsonify({'error': 'Please accept your invitation first'}), 401
    
    # Verify password
    if not bcrypt.verify(password, user.get('password', '')):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Get user role
    role = user.get('role', 'employee')
    
    # Create token with role
    token = create_token(user['_id'], user.get('companyId'), role)
    
    # Set session with role
    session['user_id'] = str(user['_id'])
    session['company_id'] = str(user.get('companyId'))
    session['user_role'] = role
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'email': user['email'],
            'name': user.get('name'),
            'role': role,
            'companyId': str(user.get('companyId'))
        }
    })


@auth_bp.route('/verify-company', methods=['POST'])
def verify_company():
    """Verify if a company ID exists"""
    data = request.json or {}
    company_id = data.get('companyId')
    
    if not company_id:
        return jsonify({'error': 'Company ID required'}), 400
        
    from app.db import companies_collection
    from bson import ObjectId, errors
    
    try:
        if not ObjectId.is_valid(company_id):
             return jsonify({'error': 'Invalid Company ID format'}), 400
             
        company = companies_collection.find_one({'_id': ObjectId(company_id)})
        if company:
            return jsonify({
                'valid': True,
                'companyName': company.get('companyName', 'Unknown Company')
            })
        else:
            return jsonify({'error': 'Company not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@auth_bp.route('/register', methods=['POST'])
def register():
    """Register new user (standalone mode)"""
    data = request.json or {}
    
    # Common fields
    if not all(data.get(k) for k in ['email', 'password', 'name']):
        return jsonify({'error': 'Email, password, and name are required'}), 400
        
    # Check if email exists
    if users_collection.find_one({'email': data['email']}):
        return jsonify({'error': 'Email already registered'}), 400
        
    from app.db import companies_collection
    from bson import ObjectId
    
    company_id = None
    role = 'employee'
    
    # Mode 1: Join Existing Company
    if data.get('companyId'):
        try:
            c_id = ObjectId(data['companyId'])
            company = companies_collection.find_one({'_id': c_id})
            if not company:
                return jsonify({'error': 'Invalid Company ID'}), 400
            company_id = c_id
            role = 'employee'
        except:
            return jsonify({'error': 'Invalid Company ID format'}), 400
            
    # Mode 2: Create New Company
    elif data.get('companyName'):
        # Verify Admin Secret
        admin_secret = data.get('adminSecret')
        if admin_secret != '112233445566778899':
            return jsonify({'error': 'Invalid Admin Secret for new company registration'}), 403
            
        # Create company
        company = {
            '_id': ObjectId(),
            'companyName': data['companyName'],
            'createdAt': datetime.utcnow()
        }
        companies_collection.insert_one(company)
        company_id = company['_id']
        role = 'company_admin'  # First user of new company is company admin
    else:
        return jsonify({'error': 'Either Company ID (to join) or Company Name + Secret (to create) is required'}), 400
    
    # Create user
    user = {
        '_id': ObjectId(),
        'email': data['email'].lower(),
        'password': bcrypt.hash(data['password']),
        'name': data['name'],
        'companyId': company_id,
        'role': role,
        'status': 'active',
        'createdAt': datetime.utcnow()
    }
    users_collection.insert_one(user)
    
    # Create token with role
    token = create_token(user['_id'], company_id, role)
    
    # Set session with role
    session['user_id'] = str(user['_id'])
    session['company_id'] = str(company_id)
    session['user_role'] = role
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'email': user['email'],
            'name': user['name'],
            'role': role,
            'companyId': str(company_id)
        }
    }), 201


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Logout"""
    session.clear()
    return jsonify({'message': 'Logged out'})


# =====================================
# Platform SSO (Connected Mode)
# =====================================

@auth_bp.route('/platform-sso', methods=['GET', 'POST'])
def platform_sso():
    """
    Authenticate via Bharatlytics Platform SSO token.
    GET: Redirect from platform with token in query params
    POST: API call with token in body
    
    Expected token payload:
    {
        "user_id": "...",
        "user_email": "...",
        "user_name": "...",
        "company_id": "...",
        "company_name": "...",      # Optional but recommended
        "company_logo": "...",      # Optional - URL to company logo
    }
    """
    from flask import redirect
    
    # Get token from query params (GET) or body (POST)
    if request.method == 'GET':
        platform_token = request.args.get('token')
        company_id = request.args.get('companyId')
        # Also check for company details in query params (fallback)
        company_name = request.args.get('companyName')
        company_logo = request.args.get('companyLogo')
    else:
        data = request.json or {}
        platform_token = data.get('token')
        company_id = data.get('companyId')
        company_name = data.get('companyName')
        company_logo = data.get('companyLogo')
    
    if not platform_token:
        return jsonify({'error': 'Platform token required'}), 400
    
    # Decode the SSO token from platform
    try:
        # Use platform's JWT secret for SSO tokens
        payload = jwt.decode(platform_token, Config.PLATFORM_JWT_SECRET, algorithms=[Config.JWT_ALGORITHM])
        
        print(f"[SSO] Token payload: {payload}")  # Debug
        
        # Extract user info from token (camelCase primary, snake_case fallback)
        user_id = payload.get('userId') or payload.get('user_id')
        user_email = payload.get('userEmail') or payload.get('user_email')
        user_name = payload.get('userName') or payload.get('user_name')
        company_id = company_id or payload.get('companyId') or payload.get('company_id')
        
        # Extract company details (camelCase primary, snake_case fallback)
        company_name = company_name or payload.get('companyName') or payload.get('company_name')
        company_logo = company_logo or payload.get('companyLogo') or payload.get('company_logo')
        
        print(f"[SSO] Extracted - company_name: {company_name}, company_logo: {company_logo}")  # Debug
        
        # Store in session - this marks user as "connected mode"
        session['platform_token'] = platform_token
        session['company_id'] = company_id
        session['user_id'] = user_id
        session['user_email'] = user_email
        session['user_name'] = user_name
        session['company_name'] = company_name
        session['company_logo'] = company_logo
        
        print(f"[SSO] Session set: user_id={user_id}, company_id={company_id}, company_name={company_name}")
        
        # If GET request (redirect from platform), redirect to dashboard
        if request.method == 'GET':
            return redirect('/')
        
        # For POST requests (mobile/API), return JSON with VMS JWT token
        # Create VMS-specific JWT token for API access
        vms_token = create_token(user_id, company_id, expires_hours=24)
        
        return jsonify({
            'message': 'Platform SSO successful',
            'vmsToken': vms_token,  # JWT token for mobile API access
            'expiresIn': 86400,     # 24 hours in seconds
            'companyId': company_id,
            'company': {
                'id': company_id,
                'name': company_name,
                'logo': company_logo
            },
            'user': {
                'id': user_id,
                'email': user_email,
                'name': user_name
            }
        })
        
    except jwt.ExpiredSignatureError:
        return jsonify({'error': 'SSO token expired'}), 401
    except jwt.InvalidTokenError as e:
        return jsonify({'error': f'Invalid SSO token: {str(e)}'}), 401


@auth_bp.route('/me', methods=['GET'])
@require_auth
def get_current_user():
    """Get current authenticated user"""
    company_id = request.company_id
    is_connected = bool(session.get('platform_token'))
    
    response = {
        'user_id': request.user_id,
        'company_id': company_id,
        'connected': is_connected
    }
    
    # If connected to platform, include company details and return URL
    if is_connected and company_id:
        # Use platform WEB URL for exit navigation (browser URL, not API URL)
        platform_base = Config.PLATFORM_WEB_URL.rstrip('/')
        response['platform_url'] = f'{platform_base}/companies/{company_id}'
        response['company'] = {
            'id': company_id,
            'name': session.get('company_name'),
            'logo': session.get('company_logo')
        }
    
    return jsonify(response)
