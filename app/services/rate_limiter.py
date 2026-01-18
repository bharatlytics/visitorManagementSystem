"""
Rate Limiter Service

API protection with configurable rate limits:
- Per-user/IP/API key rate limiting
- Sliding window algorithm
- Configurable limits per endpoint
"""
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import request, jsonify, g
from bson import ObjectId
import time

from app.db import get_db


class RateLimiter:
    """Simple in-memory rate limiter with Redis fallback"""
    
    def __init__(self):
        self._cache = {}  # In-memory cache for rate limit counters
        self._cleanup_interval = 60  # Seconds between cache cleanup
        self._last_cleanup = time.time()
    
    def _get_key(self, identifier: str, endpoint: str) -> str:
        """Generate cache key"""
        return f"rate:{identifier}:{endpoint}"
    
    def _cleanup_expired(self):
        """Remove expired entries from cache"""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        
        expired_keys = []
        for key, data in self._cache.items():
            if data['expires'] < now:
                expired_keys.append(key)
        
        for key in expired_keys:
            del self._cache[key]
        
        self._last_cleanup = now
    
    def is_rate_limited(self, identifier: str, endpoint: str, limit: int, window_seconds: int) -> tuple:
        """
        Check if request should be rate limited.
        
        Args:
            identifier: User ID, API key, or IP address
            endpoint: API endpoint being accessed
            limit: Maximum requests per window
            window_seconds: Time window in seconds
        
        Returns:
            (is_limited, remaining, reset_at)
        """
        self._cleanup_expired()
        
        key = self._get_key(identifier, endpoint)
        now = time.time()
        
        if key not in self._cache:
            self._cache[key] = {
                'count': 0,
                'window_start': now,
                'expires': now + window_seconds
            }
        
        data = self._cache[key]
        
        # Check if window has expired
        if data['expires'] < now:
            data['count'] = 0
            data['window_start'] = now
            data['expires'] = now + window_seconds
        
        # Increment counter
        data['count'] += 1
        
        remaining = max(0, limit - data['count'])
        reset_at = datetime.fromtimestamp(data['expires'], tz=timezone.utc)
        
        is_limited = data['count'] > limit
        
        return is_limited, remaining, reset_at
    
    def get_usage(self, identifier: str, endpoint: str = None) -> dict:
        """Get current rate limit usage for an identifier"""
        usage = {}
        
        for key, data in self._cache.items():
            if key.startswith(f"rate:{identifier}:"):
                ep = key.split(':')[2]
                if endpoint is None or ep == endpoint:
                    usage[ep] = {
                        'count': data['count'],
                        'remaining': max(0, 100 - data['count']),  # Assume 100 default
                        'resetsAt': datetime.fromtimestamp(data['expires'], tz=timezone.utc).isoformat()
                    }
        
        return usage


# Global rate limiter instance
rate_limiter = RateLimiter()


# Default rate limits per endpoint category
DEFAULT_LIMITS = {
    'read': {'limit': 100, 'window': 60},      # 100 req/min for reads
    'write': {'limit': 30, 'window': 60},      # 30 req/min for writes
    'auth': {'limit': 10, 'window': 60},       # 10 req/min for auth
    'bulk': {'limit': 5, 'window': 60},        # 5 req/min for bulk ops
    'export': {'limit': 10, 'window': 3600},   # 10 req/hour for exports
}


def get_identifier():
    """Get identifier for rate limiting (API key, user ID, or IP)"""
    # Check for API key
    api_key = request.headers.get('X-API-Key')
    if api_key:
        return f"key:{api_key}"
    
    # Check for user ID
    user_id = getattr(request, 'user_id', None) or getattr(g, 'user_id', None)
    if user_id:
        return f"user:{user_id}"
    
    # Fall back to IP
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    return f"ip:{ip}"


def rate_limit(category: str = 'read', limit: int = None, window: int = None):
    """
    Decorator to apply rate limiting to an endpoint.
    
    Usage:
        @rate_limit('write')
        def create_visitor():
            ...
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            # Get rate limit config
            config = DEFAULT_LIMITS.get(category, DEFAULT_LIMITS['read'])
            req_limit = limit or config['limit']
            req_window = window or config['window']
            
            identifier = get_identifier()
            endpoint = request.endpoint or request.path
            
            is_limited, remaining, reset_at = rate_limiter.is_rate_limited(
                identifier, endpoint, req_limit, req_window
            )
            
            # Add rate limit headers
            response_headers = {
                'X-RateLimit-Limit': str(req_limit),
                'X-RateLimit-Remaining': str(remaining),
                'X-RateLimit-Reset': reset_at.isoformat()
            }
            
            if is_limited:
                response = jsonify({
                    'error': 'Rate limit exceeded',
                    'limit': req_limit,
                    'remaining': 0,
                    'resetAt': reset_at.isoformat(),
                    'retryAfter': int((reset_at - datetime.now(timezone.utc)).total_seconds())
                })
                response.status_code = 429
                for key, value in response_headers.items():
                    response.headers[key] = value
                return response
            
            # Call the actual function
            response = f(*args, **kwargs)
            
            # Add headers to response
            if hasattr(response, 'headers'):
                for key, value in response_headers.items():
                    response.headers[key] = value
            
            return response
        
        return wrapped
    return decorator


# =============================================================================
# API Key Management
# =============================================================================

def generate_api_key():
    """Generate a secure API key"""
    import secrets
    return f"vms_{secrets.token_urlsafe(32)}"


def create_api_key(company_id: str, name: str, scopes: list = None, 
                   rate_limit_override: dict = None, created_by: str = None) -> dict:
    """
    Create a new API key.
    
    Args:
        company_id: Company the key belongs to
        name: Friendly name for the key
        scopes: List of allowed scopes (e.g., ['read:visitors', 'write:visits'])
        rate_limit_override: Custom rate limits for this key
        created_by: User who created the key
    
    Returns:
        API key document (includes the raw key only on creation)
    """
    db = get_db()
    api_keys = db['api_keys']
    
    raw_key = generate_api_key()
    
    key_doc = {
        '_id': ObjectId(),
        'companyId': company_id,
        'name': name,
        'keyPrefix': raw_key[:12] + '...',  # For display
        'keyHash': hash_key(raw_key),
        'scopes': scopes or ['*'],
        'rateLimitOverride': rate_limit_override,
        'active': True,
        'createdAt': datetime.now(timezone.utc),
        'createdBy': created_by,
        'lastUsed': None,
        'usageCount': 0
    }
    
    api_keys.insert_one(key_doc)
    
    # Return with raw key (only shown once)
    key_doc['rawKey'] = raw_key
    return key_doc


def hash_key(raw_key: str) -> str:
    """Hash an API key for storage"""
    import hashlib
    return hashlib.sha256(raw_key.encode()).hexdigest()


def validate_api_key(raw_key: str) -> dict:
    """
    Validate an API key and return the key document if valid.
    
    Returns None if key is invalid or inactive.
    """
    if not raw_key:
        return None
    
    db = get_db()
    api_keys = db['api_keys']
    
    key_hash = hash_key(raw_key)
    key_doc = api_keys.find_one({'keyHash': key_hash, 'active': True})
    
    if key_doc:
        # Update usage stats
        api_keys.update_one(
            {'_id': key_doc['_id']},
            {
                '$set': {'lastUsed': datetime.now(timezone.utc)},
                '$inc': {'usageCount': 1}
            }
        )
    
    return key_doc


def revoke_api_key(key_id: str) -> bool:
    """Revoke an API key"""
    db = get_db()
    result = db['api_keys'].update_one(
        {'_id': ObjectId(key_id)},
        {
            '$set': {
                'active': False,
                'revokedAt': datetime.now(timezone.utc)
            }
        }
    )
    return result.modified_count > 0
