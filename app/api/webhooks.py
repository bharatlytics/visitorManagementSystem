"""
Webhooks API

Webhook management for event notifications:
- Subscribe to VMS events
- Configure delivery endpoints
- Retry policies
- Webhook history and logs
"""
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
import json

from app.db import get_db
from app.auth import require_auth, require_company_access
from app.utils import get_current_utc

webhooks_bp = Blueprint('webhooks', __name__)


# Available webhook events
WEBHOOK_EVENTS = [
    'visitor.registered',
    'visitor.updated',
    'visitor.deleted',
    'visitor.blacklisted',
    'visit.scheduled',
    'visit.checked_in',
    'visit.checked_out',
    'visit.cancelled',
    'approval.requested',
    'approval.approved',
    'approval.rejected',
    'evacuation.triggered',
    'evacuation.ended',
    'security.blacklist_match',
    'security.alert'
]


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


def generate_webhook_secret():
    """Generate a secure webhook secret"""
    return secrets.token_hex(32)


def sign_payload(payload: dict, secret: str) -> str:
    """Create HMAC signature for webhook payload"""
    payload_bytes = json.dumps(payload, sort_keys=True, default=str).encode('utf-8')
    signature = hmac.new(secret.encode('utf-8'), payload_bytes, hashlib.sha256).hexdigest()
    return f"sha256={signature}"


@webhooks_bp.route('/events', methods=['GET'])
@require_company_access
def list_available_events():
    """List all available webhook events"""
    return jsonify({
        'events': WEBHOOK_EVENTS,
        'count': len(WEBHOOK_EVENTS)
    }), 200


@webhooks_bp.route('/subscriptions', methods=['GET'])
@require_company_access
def list_subscriptions():
    """List all webhook subscriptions for a company."""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        webhooks = db['webhooks']
        
        subs = list(webhooks.find({'companyId': company_id}))
        
        for sub in subs:
            sub.pop('secret', None)
        
        return jsonify({
            'subscriptions': convert_objectids(subs),
            'count': len(subs)
        }), 200
        
    except Exception as e:
        print(f"Error listing webhooks: {e}")
        return jsonify({'error': str(e)}), 500


@webhooks_bp.route('/subscriptions', methods=['POST'])
@require_company_access
def create_subscription():
    """Create a new webhook subscription."""
    try:
        data = request.json or {}
        company_id = data.get('companyId') or getattr(request, 'company_id', None)
        url = data.get('url')
        events = data.get('events', [])
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        if not url:
            return jsonify({'error': 'URL is required'}), 400
        if not events:
            return jsonify({'error': 'At least one event is required'}), 400
        
        invalid_events = [e for e in events if e not in WEBHOOK_EVENTS and e != '*']
        if invalid_events:
            return jsonify({'error': f'Invalid events: {invalid_events}'}), 400
        
        secret = generate_webhook_secret()
        
        db = get_db()
        webhooks = db['webhooks']
        
        webhook_doc = {
            '_id': ObjectId(),
            'companyId': company_id,
            'name': data.get('name', f'Webhook for {url}'),
            'url': url,
            'events': events,
            'secret': secret,
            'headers': data.get('headers', {}),
            'retryPolicy': data.get('retryPolicy', {
                'maxRetries': 3,
                'retryDelaySeconds': [60, 300, 900]
            }),
            'active': True,
            'createdAt': get_current_utc(),
            'createdBy': getattr(request, 'user_id', 'system'),
            'lastDelivery': None,
            'deliveryCount': 0,
            'failureCount': 0
        }
        
        webhooks.insert_one(webhook_doc)
        
        return jsonify({
            'message': 'Webhook subscription created',
            'subscriptionId': str(webhook_doc['_id']),
            'secret': secret,
            'events': events,
            'note': 'Store the secret securely. It will not be shown again.'
        }), 201
        
    except Exception as e:
        print(f"Error creating webhook: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@webhooks_bp.route('/subscriptions/<subscription_id>', methods=['DELETE'])
@require_company_access
def delete_subscription(subscription_id):
    """Delete a webhook subscription"""
    try:
        db = get_db()
        webhooks = db['webhooks']
        
        result = webhooks.delete_one({'_id': ObjectId(subscription_id)})
        
        if result.deleted_count == 0:
            return jsonify({'error': 'Subscription not found'}), 404
        
        return jsonify({'message': 'Subscription deleted'}), 200
        
    except Exception as e:
        print(f"Error deleting webhook: {e}")
        return jsonify({'error': str(e)}), 500


@webhooks_bp.route('/subscriptions/<subscription_id>/test', methods=['POST'])
@require_company_access
def test_webhook(subscription_id):
    """Send a test webhook delivery."""
    try:
        import requests as http_requests
        
        db = get_db()
        webhooks = db['webhooks']
        
        webhook = webhooks.find_one({'_id': ObjectId(subscription_id)})
        if not webhook:
            return jsonify({'error': 'Subscription not found'}), 404
        
        test_payload = {
            'event': 'webhook.test',
            'timestamp': get_current_utc().isoformat(),
            'data': {
                'message': 'This is a test webhook delivery',
                'subscriptionId': subscription_id
            }
        }
        
        signature = sign_payload(test_payload, webhook['secret'])
        
        headers = {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': 'webhook.test',
            'X-Webhook-Delivery-Id': str(ObjectId())
        }
        headers.update(webhook.get('headers', {}))
        
        try:
            response = http_requests.post(
                webhook['url'],
                json=test_payload,
                headers=headers,
                timeout=10
            )
            
            success = 200 <= response.status_code < 300
            
            return jsonify({
                'success': success,
                'statusCode': response.status_code,
                'message': 'Test delivery successful' if success else 'Test delivery failed'
            }), 200
            
        except Exception as delivery_error:
            return jsonify({
                'success': False,
                'error': str(delivery_error),
                'message': 'Failed to connect to webhook URL'
            }), 200
        
    except Exception as e:
        print(f"Error testing webhook: {e}")
        return jsonify({'error': str(e)}), 500


@webhooks_bp.route('/deliveries', methods=['GET'])
@require_company_access
def get_delivery_history():
    """Get webhook delivery history."""
    try:
        company_id = request.args.get('companyId') or getattr(request, 'company_id', None)
        subscription_id = request.args.get('subscriptionId')
        limit = int(request.args.get('limit', 50))
        
        if not company_id:
            return jsonify({'error': 'Company ID is required'}), 400
        
        db = get_db()
        deliveries = db['webhook_deliveries']
        
        query = {'companyId': company_id}
        if subscription_id:
            query['subscriptionId'] = ObjectId(subscription_id)
        
        history = list(deliveries.find(query).sort('timestamp', -1).limit(limit))
        
        return jsonify({
            'deliveries': convert_objectids(history),
            'count': len(history)
        }), 200
        
    except Exception as e:
        print(f"Error getting delivery history: {e}")
        return jsonify({'error': str(e)}), 500
