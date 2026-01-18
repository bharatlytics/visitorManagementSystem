"""
Watchlist API

Enhanced watchlist system with categorized entries:
- VIP: Fast-track check-in, notify leadership
- Blacklist: Block entry, alert security
- Restricted: Extra verification required
- Banned: Permanent block, legal hold
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timezone
from enum import Enum

from app.db import get_db, visitor_collection
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc
from app.services.audit_logger import log_action

watchlist_bp = Blueprint('watchlist', __name__)


class WatchlistCategory(str, Enum):
    VIP = "vip"                    # Fast-track, VIP treatment
    BLACKLIST = "blacklist"        # Block entry, alert security
    RESTRICTED = "restricted"      # Extra verification needed
    BANNED = "banned"              # Permanent block, legal hold
    WATCHLIST = "watchlist"        # General monitoring


def get_watchlist_collection():
    """Get the watchlist collection"""
    return get_db()['watchlist']


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


@watchlist_bp.route('/entries', methods=['GET'])
@require_company_access
def list_watchlist_entries():
    """
    List all watchlist entries for a company.
    
    Query Parameters:
        companyId (required): Company ObjectId
        category (optional): Filter by category (vip, blacklist, restricted, banned)
        active (optional): Filter by active status (default: true)
        limit (optional): Number of records (default: 100)
    """
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        category = request.args.get('category')
        active = request.args.get('active', 'true').lower() == 'true'
        limit = int(request.args.get('limit', 100))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        watchlist_collection = get_watchlist_collection()
        
        query = {'companyId': company_id, 'active': active}
        if category:
            query['category'] = category
        
        entries = list(watchlist_collection.find(query).sort('createdAt', -1).limit(limit))
        
        # Count by category
        category_counts = {}
        for cat in WatchlistCategory:
            count = watchlist_collection.count_documents({
                'companyId': company_id,
                'category': cat.value,
                'active': True
            })
            category_counts[cat.value] = count
        
        return jsonify({
            'entries': convert_objectids(entries),
            'count': len(entries),
            'categoryCounts': category_counts
        }), 200
        
    except Exception as e:
        print(f"Error listing watchlist: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/entries', methods=['POST'])
@require_company_access
def add_watchlist_entry():
    """
    Add a person to the watchlist.
    
    Request Body:
        companyId (required): Company ObjectId
        category (required): vip, blacklist, restricted, banned, watchlist
        name (required): Person's name
        phone (optional): Phone number
        email (optional): Email address
        organization (optional): Organization
        reason (required for blacklist/banned): Reason for listing
        visitorId (optional): Link to existing visitor record
        idType (optional): ID document type
        idNumber (optional): ID document number
        expiresAt (optional): When the entry expires
        notes (optional): Additional notes
        photo (optional): Base64 encoded photo
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        category = data.get('category')
        if not category or category not in [c.value for c in WatchlistCategory]:
            return jsonify({'error': 'Valid category is required (vip, blacklist, restricted, banned, watchlist)'}), 400
        
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400
        
        if category in ['blacklist', 'banned'] and not data.get('reason'):
            return jsonify({'error': 'Reason is required for blacklist/banned entries'}), 400
        
        watchlist_collection = get_watchlist_collection()
        
        # Check if already exists with same phone/email
        if data.get('phone'):
            existing = watchlist_collection.find_one({
                'companyId': company_id,
                'phone': data['phone'],
                'active': True
            })
            if existing:
                return jsonify({
                    'error': 'Person already on watchlist',
                    'existingId': str(existing['_id']),
                    'existingCategory': existing.get('category')
                }), 409
        
        entry_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'category': category,
            'name': data['name'],
            'phone': data.get('phone'),
            'email': data.get('email'),
            'organization': data.get('organization'),
            'reason': data.get('reason'),
            'visitorId': ObjectId(data['visitorId']) if data.get('visitorId') else None,
            'idType': data.get('idType'),
            'idNumber': data.get('idNumber'),
            'expiresAt': datetime.fromisoformat(data['expiresAt'].replace('Z', '+00:00')) if data.get('expiresAt') else None,
            'notes': data.get('notes'),
            'hasPhoto': bool(data.get('photo')),
            'active': True,
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'system'),
            'lastUpdated': get_current_utc()
        }
        
        watchlist_collection.insert_one(entry_doc)
        
        # If linked to a visitor, update their status
        if data.get('visitorId') and category in ['blacklist', 'banned']:
            visitor_collection.update_one(
                {'_id': ObjectId(data['visitorId'])},
                {
                    '$set': {
                        'blacklisted': True,
                        'blacklistReason': data.get('reason'),
                        'blacklistedAt': get_current_utc(),
                        'watchlistCategory': category
                    }
                }
            )
        
        # Audit log
        log_action(
            action=f'watchlist.{category}_added',
            entity_type='watchlist',
            entity_id=entry_doc['_id'],
            company_id=company_id,
            user_id=getattr(request, 'user_id', None),
            details={
                'name': data['name'],
                'category': category,
                'reason': data.get('reason')
            },
            severity='warning' if category in ['blacklist', 'banned'] else 'info'
        )
        
        return jsonify({
            'message': f'Added to {category}',
            'entryId': str(entry_doc['_id']),
            'category': category
        }), 201
        
    except Exception as e:
        print(f"Error adding to watchlist: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/entries/<entry_id>', methods=['GET'])
@require_company_access
def get_watchlist_entry(entry_id):
    """Get details of a specific watchlist entry"""
    try:
        watchlist_collection = get_watchlist_collection()
        
        entry = watchlist_collection.find_one({'_id': ObjectId(entry_id)})
        if not entry:
            return jsonify({'error': 'Entry not found'}), 404
        
        # Get linked visitor if any
        visitor = None
        if entry.get('visitorId'):
            visitor = visitor_collection.find_one({'_id': entry['visitorId']})
        
        return jsonify({
            'entry': convert_objectids(entry),
            'linkedVisitor': convert_objectids(visitor) if visitor else None
        }), 200
        
    except Exception as e:
        print(f"Error getting watchlist entry: {e}")
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/entries/<entry_id>', methods=['PATCH'])
@require_company_access
def update_watchlist_entry(entry_id):
    """
    Update a watchlist entry.
    
    Request Body:
        category (optional): New category
        reason (optional): Updated reason
        notes (optional): Updated notes
        expiresAt (optional): New expiry date
    """
    try:
        data = request.json or {}
        watchlist_collection = get_watchlist_collection()
        
        entry = watchlist_collection.find_one({'_id': ObjectId(entry_id)})
        if not entry:
            return jsonify({'error': 'Entry not found'}), 404
        
        update_fields = {'lastUpdated': get_current_utc()}
        
        allowed_fields = ['category', 'reason', 'notes', 'name', 'phone', 'email', 'organization']
        for field in allowed_fields:
            if field in data:
                update_fields[field] = data[field]
        
        if 'expiresAt' in data:
            if data['expiresAt']:
                update_fields['expiresAt'] = datetime.fromisoformat(data['expiresAt'].replace('Z', '+00:00'))
            else:
                update_fields['expiresAt'] = None
        
        watchlist_collection.update_one(
            {'_id': ObjectId(entry_id)},
            {'$set': update_fields}
        )
        
        return jsonify({
            'message': 'Entry updated',
            'entryId': entry_id
        }), 200
        
    except Exception as e:
        print(f"Error updating watchlist entry: {e}")
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/entries/<entry_id>', methods=['DELETE'])
@require_company_access
def remove_from_watchlist(entry_id):
    """
    Remove (deactivate) a watchlist entry.
    
    Request Body (optional):
        reason: Reason for removal
    """
    try:
        data = request.json or {}
        watchlist_collection = get_watchlist_collection()
        
        entry = watchlist_collection.find_one({'_id': ObjectId(entry_id)})
        if not entry:
            return jsonify({'error': 'Entry not found'}), 404
        
        # Soft delete - just deactivate
        watchlist_collection.update_one(
            {'_id': ObjectId(entry_id)},
            {
                '$set': {
                    'active': False,
                    'deactivatedAt': get_current_utc(),
                    'deactivatedBy': getattr(request, 'user_id', 'system'),
                    'deactivationReason': data.get('reason')
                }
            }
        )
        
        # If linked to visitor, update their status
        if entry.get('visitorId') and entry.get('category') in ['blacklist', 'banned']:
            visitor_collection.update_one(
                {'_id': entry['visitorId']},
                {
                    '$set': {
                        'blacklisted': False,
                        'unblacklistedAt': get_current_utc()
                    },
                    '$unset': {
                        'watchlistCategory': ''
                    }
                }
            )
        
        # Audit log
        log_action(
            action=f'watchlist.{entry.get("category")}_removed',
            entity_type='watchlist',
            entity_id=entry_id,
            company_id=entry.get('companyId'),
            user_id=getattr(request, 'user_id', None),
            details={
                'name': entry.get('name'),
                'category': entry.get('category'),
                'removalReason': data.get('reason')
            }
        )
        
        return jsonify({
            'message': 'Removed from watchlist',
            'entryId': entry_id
        }), 200
        
    except Exception as e:
        print(f"Error removing from watchlist: {e}")
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/check', methods=['POST'])
@require_company_access
def check_against_watchlist():
    """
    Check if a person is on the watchlist.
    
    Used during visitor check-in to identify VIPs, blacklisted persons, etc.
    
    Request Body:
        companyId (required): Company ObjectId
        phone (optional): Phone number to check
        email (optional): Email to check
        name (optional): Name to check (fuzzy match)
        idNumber (optional): ID number to check
    
    Returns:
        Array of matching watchlist entries
    """
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        watchlist_collection = get_watchlist_collection()
        
        # Build OR query for various identifiers
        or_conditions = []
        
        if data.get('phone'):
            or_conditions.append({'phone': data['phone']})
        
        if data.get('email'):
            or_conditions.append({'email': data['email'].lower()})
        
        if data.get('idNumber'):
            or_conditions.append({'idNumber': data['idNumber']})
        
        if not or_conditions:
            return jsonify({'error': 'At least one identifier (phone, email, or idNumber) is required'}), 400
        
        query = {
            'companyId': company_id,
            'active': True,
            '$or': or_conditions
        }
        
        # Check for expired entries
        now = get_current_utc()
        query['$and'] = [
            {'$or': [
                {'expiresAt': None},
                {'expiresAt': {'$gt': now}}
            ]}
        ]
        
        matches = list(watchlist_collection.find(query))
        
        if matches:
            # Log the check
            for match in matches:
                if match.get('category') in ['blacklist', 'banned']:
                    log_action(
                        action='security.blacklist_match',
                        entity_type='watchlist',
                        entity_id=match['_id'],
                        company_id=company_id,
                        details={
                            'matchedName': match.get('name'),
                            'category': match.get('category'),
                            'searchPhone': data.get('phone'),
                            'searchEmail': data.get('email')
                        },
                        severity='warning'
                    )
        
        return jsonify({
            'matches': convert_objectids(matches),
            'matchCount': len(matches),
            'hasBlacklist': any(m.get('category') in ['blacklist', 'banned'] for m in matches),
            'hasVip': any(m.get('category') == 'vip' for m in matches),
            'hasRestricted': any(m.get('category') == 'restricted' for m in matches)
        }), 200
        
    except Exception as e:
        print(f"Error checking watchlist: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@watchlist_bp.route('/stats', methods=['GET'])
@require_company_access
def get_watchlist_stats():
    """Get watchlist statistics"""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        watchlist_collection = get_watchlist_collection()
        
        stats = {
            'total': watchlist_collection.count_documents({'companyId': company_id, 'active': True}),
            'byCategory': {}
        }
        
        for cat in WatchlistCategory:
            stats['byCategory'][cat.value] = watchlist_collection.count_documents({
                'companyId': company_id,
                'category': cat.value,
                'active': True
            })
        
        return jsonify(stats), 200
        
    except Exception as e:
        print(f"Error getting watchlist stats: {e}")
        return jsonify({'error': str(e)}), 500
