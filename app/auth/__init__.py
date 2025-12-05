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


def create_token(user_id, company_id, expires_hours=24):
    """Create JWT token"""
    payload = {
        'user_id': str(user_id),
        'company_id': str(company_id),
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
    """Authentication decorator"""
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
                return f(*args, **kwargs)
        
        # Check session
        if session.get('user_id'):
            request.user_id = session['user_id']
            request.company_id = session.get('company_id')
            return f(*args, **kwargs)
        
        return jsonify({'error': 'Authentication required'}), 401
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
    
    # Find user
    user = users_collection.find_one({'email': email})
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Verify password
    if not bcrypt.verify(password, user.get('password', '')):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Create token
    token = create_token(user['_id'], user.get('companyId'))
    
    # Set session
    session['user_id'] = str(user['_id'])
    session['company_id'] = str(user.get('companyId'))
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'email': user['email'],
            'name': user.get('name'),
            'companyId': str(user.get('companyId'))
        }
    })


@auth_bp.route('/register', methods=['POST'])
def register():
    """Register new user (standalone mode)"""
    data = request.json or {}
    
    required = ['email', 'password', 'name', 'companyName']
    if not all(data.get(k) for k in required):
        return jsonify({'error': f'Required fields: {required}'}), 400
    
    # Check if email exists
    if users_collection.find_one({'email': data['email']}):
        return jsonify({'error': 'Email already registered'}), 400
    
    from app.db import companies_collection
    from bson import ObjectId
    
    # Create company
    company = {
        '_id': ObjectId(),
        'companyName': data['companyName'],
        'createdAt': datetime.utcnow()
    }
    companies_collection.insert_one(company)
    
    # Create user
    user = {
        '_id': ObjectId(),
        'email': data['email'],
        'password': bcrypt.hash(data['password']),
        'name': data['name'],
        'companyId': company['_id'],
        'role': 'admin',
        'createdAt': datetime.utcnow()
    }
    users_collection.insert_one(user)
    
    # Create token
    token = create_token(user['_id'], company['_id'])
    
    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'email': user['email'],
            'name': user['name'],
            'companyId': str(company['_id'])
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
    """
    from flask import redirect
    
    # Get token from query params (GET) or body (POST)
    if request.method == 'GET':
        platform_token = request.args.get('token')
        company_id = request.args.get('companyId')
    else:
        data = request.json or {}
        platform_token = data.get('token')
        company_id = data.get('companyId')
    
    if not platform_token:
        return jsonify({'error': 'Platform token required'}), 400
    
    # Decode the SSO token from platform
    try:
        # Use platform's JWT secret for SSO tokens
        payload = jwt.decode(platform_token, Config.PLATFORM_JWT_SECRET, algorithms=[Config.JWT_ALGORITHM])
        
        # Extract user info from token
        user_id = payload.get('user_id')
        user_email = payload.get('user_email')
        user_name = payload.get('user_name')
        company_id = company_id or payload.get('company_id')
        
        # Store in session - this marks user as "connected mode"
        session['platform_token'] = platform_token
        session['company_id'] = company_id
        session['user_id'] = user_id
        session['user_email'] = user_email
        session['user_name'] = user_name
        
        print(f"[SSO] Session set: user_id={user_id}, company_id={company_id}, email={user_email}")
        
        # If GET request (redirect from platform), redirect to dashboard
        if request.method == 'GET':
            return redirect('/dashboard.html')
        
        return jsonify({
            'message': 'Platform SSO successful',
            'companyId': company_id,
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
    return jsonify({
        'user_id': request.user_id,
        'company_id': request.company_id,
        'connected': bool(session.get('platform_token'))
    })
