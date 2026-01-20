/**
 * Webhooks API
 * Webhook management for integrations
 * Matching Python app/api/webhooks.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId, validateRequiredFields } = require('../utils/helpers');

/**
 * GET /api/webhooks
 * List all webhooks for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const db = getDb();
        let query;
        if (isValidObjectId(companyId)) {
            query = { companyId: new ObjectId(companyId) };
        } else {
            query = { companyId };
        }

        const webhooks = await db.collection('webhooks').find(query).toArray();

        res.json({ webhooks: convertObjectIds(webhooks) });
    } catch (error) {
        console.error('Error listing webhooks:', error);
        next(error);
    }
});

/**
 * POST /api/webhooks
 * Create a new webhook
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'url', 'events']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate URL
        try {
            new URL(data.url);
        } catch {
            return res.status(400).json({ error: 'Invalid webhook URL' });
        }

        // Validate events
        const validEvents = [
            'visitor.registered', 'visitor.updated', 'visitor.deleted',
            'visit.scheduled', 'visit.checked_in', 'visit.checked_out', 'visit.cancelled',
            'employee.registered', 'employee.updated', 'employee.deleted',
            'approval.requested', 'approval.approved', 'approval.rejected'
        ];

        const events = Array.isArray(data.events) ? data.events : [data.events];
        const invalidEvents = events.filter(e => !validEvents.includes(e) && e !== '*');
        if (invalidEvents.length > 0) {
            return res.status(400).json({ error: `Invalid events: ${invalidEvents.join(', ')}` });
        }

        const db = getDb();
        const webhookDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            url: data.url,
            events,
            secret: data.secret || generateSecret(),
            headers: data.headers || {},
            status: 'active',
            retryPolicy: {
                maxRetries: data.maxRetries || 3,
                retryDelay: data.retryDelay || 5000
            },
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await db.collection('webhooks').insertOne(webhookDoc);

        res.status(201).json({
            message: 'Webhook created successfully',
            _id: webhookDoc._id.toString(),
            secret: webhookDoc.secret
        });
    } catch (error) {
        console.error('Error creating webhook:', error);
        next(error);
    }
});

/**
 * PUT /api/webhooks/:webhook_id
 * Update webhook
 */
router.put('/:webhook_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { webhook_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(webhook_id)) {
            return res.status(400).json({ error: 'Invalid webhook ID format' });
        }

        const updateFields = {};
        const allowedFields = ['url', 'events', 'headers', 'status', 'retryPolicy'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const db = getDb();
        const result = await db.collection('webhooks').updateOne(
            { _id: new ObjectId(webhook_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Webhook not found' });
        }

        res.json({ message: 'Webhook updated successfully' });
    } catch (error) {
        console.error('Error updating webhook:', error);
        next(error);
    }
});

/**
 * DELETE /api/webhooks/:webhook_id
 * Delete webhook
 */
router.delete('/:webhook_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { webhook_id } = req.params;

        if (!isValidObjectId(webhook_id)) {
            return res.status(400).json({ error: 'Invalid webhook ID format' });
        }

        const db = getDb();
        const result = await db.collection('webhooks').deleteOne({ _id: new ObjectId(webhook_id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Webhook not found' });
        }

        res.json({ message: 'Webhook deleted successfully' });
    } catch (error) {
        console.error('Error deleting webhook:', error);
        next(error);
    }
});

/**
 * POST /api/webhooks/:webhook_id/test
 * Test webhook by sending a test event
 */
router.post('/:webhook_id/test', requireCompanyAccess, async (req, res, next) => {
    try {
        const { webhook_id } = req.params;

        if (!isValidObjectId(webhook_id)) {
            return res.status(400).json({ error: 'Invalid webhook ID format' });
        }

        const db = getDb();
        const webhook = await db.collection('webhooks').findOne({ _id: new ObjectId(webhook_id) });

        if (!webhook) {
            return res.status(404).json({ error: 'Webhook not found' });
        }

        // Send test event
        const testPayload = {
            event: 'test',
            timestamp: new Date().toISOString(),
            data: { message: 'This is a test webhook event' }
        };

        try {
            const response = await fetch(webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Secret': webhook.secret,
                    ...webhook.headers
                },
                body: JSON.stringify(testPayload)
            });

            res.json({
                success: response.ok,
                statusCode: response.status,
                message: response.ok ? 'Test webhook sent successfully' : 'Webhook endpoint returned error'
            });
        } catch (fetchError) {
            res.json({
                success: false,
                error: fetchError.message,
                message: 'Failed to reach webhook endpoint'
            });
        }
    } catch (error) {
        console.error('Error testing webhook:', error);
        next(error);
    }
});

// Helper function
function generateSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let secret = 'whsec_';
    for (let i = 0; i < 32; i++) {
        secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
}

module.exports = router;
