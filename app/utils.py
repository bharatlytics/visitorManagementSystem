"""
VMS Utility Functions
Validation, datetime handling, and response helpers
"""
from datetime import datetime, timezone
import re


def validate_required_fields(data, required_fields):
    """Check if all required fields are present and non-empty"""
    missing = []
    for field in required_fields:
        if field not in data or not data[field]:
            missing.append(field)
    if missing:
        return False, f"Missing required fields: {', '.join(missing)}"
    return True, None


def error_response(message, status_code=400):
    """Return a standardized error response"""
    from flask import jsonify
    return jsonify({'error': message}), status_code


def validate_email_format(email):
    """Validate email format"""
    if not email:
        return True  # Empty email is valid (optional field)
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_phone_format(phone):
    """Validate phone number format (flexible for international)"""
    if not phone:
        return False
    # Allow digits, spaces, dashes, parentheses, and plus sign
    pattern = r'^[\d\s\-\(\)\+]{7,20}$'
    return bool(re.match(pattern, phone))


def is_unique_email(email, collection, company_id, exclude_id=None):
    """Check if email is unique within company"""
    from bson import ObjectId
    if not email:
        return True
    query = {'email': email, 'companyId': ObjectId(company_id)}
    if exclude_id:
        query['_id'] = {'$ne': ObjectId(exclude_id)}
    return collection.find_one(query) is None


def is_unique_phone(phone, collection, company_id, exclude_id=None):
    """Check if phone is unique within company"""
    from bson import ObjectId
    if not phone:
        return True
    query = {'phone': phone, 'companyId': ObjectId(company_id)}
    if exclude_id:
        query['_id'] = {'$ne': ObjectId(exclude_id)}
    return collection.find_one(query) is None


def parse_datetime(dt_string):
    """Parse datetime string to UTC datetime object"""
    if isinstance(dt_string, datetime):
        if dt_string.tzinfo is None:
            return dt_string.replace(tzinfo=timezone.utc)
        return dt_string
    
    # Try different formats
    formats = [
        '%Y-%m-%dT%H:%M:%S.%fZ',
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S.%f%z',
        '%Y-%m-%dT%H:%M:%S%z',
        '%Y-%m-%dT%H:%M:%S.%f',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d'
    ]
    
    # Handle ISO format with Z suffix
    if isinstance(dt_string, str):
        dt_string = dt_string.replace('Z', '+00:00')
    
    for fmt in formats:
        try:
            dt = datetime.strptime(dt_string.replace('+00:00', ''), fmt.replace('%z', ''))
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    
    # Last resort: try fromisoformat
    try:
        dt = datetime.fromisoformat(dt_string.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except:
        raise ValueError(f"Unable to parse datetime: {dt_string}")


def format_datetime(dt):
    """Format datetime to ISO string"""
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def get_current_utc():
    """Get current UTC datetime"""
    return datetime.now(timezone.utc)


def convert_dates_to_iso(obj):
    """Recursively convert datetime objects to ISO strings"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: convert_dates_to_iso(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_dates_to_iso(item) for item in obj]
    return obj


# ============================================================================
# Embedding Helper Functions
# ============================================================================

def generate_embedding_url(embedding_id, actor_type, base_url=None):
    """
    Generate embedding download URL - ALWAYS uses VMS backend.
    
    Args:
        embedding_id: GridFS file ID (string)
        actor_type: 'visitor' or 'employee'
        base_url: Request base URL (e.g., 'http://localhost:5001')
                  If None, will be extracted from current request
    
    Returns:
        VMS URL that will proxy to platform if needed
    """
    from flask import request
    
    if not base_url:
        base_url = request.url_root.rstrip('/')
    
    # ALWAYS return VMS URL - backend handles proxying
    return f"{base_url}/api/{actor_type}s/embeddings/{embedding_id}"


def format_embedding_response(embeddings_dict, actor_type, base_url=None):
    """
    Format embeddings dictionary with download URLs.
    
    Args:
        embeddings_dict: Dictionary of embeddings {model: embedding_data}
        actor_type: 'visitor' or 'employee'
        base_url: Request base URL (optional)
    
    Returns:
        Formatted dictionary with downloadUrl added to each embedding
    """
    if not embeddings_dict:
        return {}
    
    formatted = {}
    for model, emb_data in embeddings_dict.items():
        if isinstance(emb_data, dict) and emb_data.get('embeddingId'):
            formatted[model] = {
                'status': emb_data.get('status', 'unknown'),
                'embeddingId': str(emb_data.get('embeddingId')),
                'downloadUrl': generate_embedding_url(
                    str(emb_data.get('embeddingId')), 
                    actor_type, 
                    base_url
                ),
                'createdAt': emb_data.get('createdAt'),
                'finishedAt': emb_data.get('finishedAt')
            }
        else:
            # Keep original data if not properly formatted
            formatted[model] = emb_data
    
    return formatted
