/**
 * Residency API
 * Handles Data Residency v3 operations:
 * - Federated queries from platform (when mode=app)
 * - Sync triggers (when mode=platform)
 * 
 * Matching Python app/api/residency_api.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { getDb } = require('../db');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');
const Config = require('../config');

/**
 * Verify the request is from the platform
 */
function verifyPlatformToken(token) {
    // In production, implement proper token verification
    // For now, check if token exists and is non-empty
    if (!token) {
        return false;
    }
    // TODO: Implement JWT verification or signature check
    return true;
}

/**
 * POST /api/residency/query/visitors
 * Handle federated query from platform.
 * 
 * Platform calls this endpoint when:
 * - Residency mode is 'app' (federated)
 * - Other apps request visitor data
 */
router.post('/query/visitors', async (req, res, next) => {
    try {
        // Verify request is from platform
        const platformToken = req.headers['x-platform-token'];
        if (!verifyPlatformToken(platformToken)) {
            return res.status(401).json({ error: 'Unauthorized - Invalid platform token' });
        }

        const queryParams = req.body || {};

        // Extract query parameters
        const filters = queryParams.filters || {};
        const fields = queryParams.fields || [];
        const limit = Math.min(queryParams.limit || 100, 500);
        const offset = queryParams.offset || 0;
        const companyId = queryParams.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        // Build MongoDB query
        const db = getDb();
        const mongoQuery = {};

        // Handle companyId (both ObjectId and string)
        if (isValidObjectId(companyId)) {
            mongoQuery.$or = [
                { companyId: new ObjectId(companyId) },
                { companyId }
            ];
        } else {
            mongoQuery.companyId = companyId;
        }

        // Apply filters
        if (filters.status) {
            mongoQuery.status = filters.status;
        }
        if (filters.blacklisted !== undefined) {
            mongoQuery.blacklisted = filters.blacklisted;
        }
        if (filters.visitorType) {
            mongoQuery.visitorType = filters.visitorType;
        }
        if (filters.ids && Array.isArray(filters.ids)) {
            try {
                mongoQuery._id = { $in: filters.ids.map(id => new ObjectId(id)) };
            } catch {
                // Ignore invalid IDs
            }
        }

        // Query database
        const visitors = await db.collection('visitors')
            .find(mongoQuery)
            .skip(offset)
            .limit(limit)
            .toArray();

        const total = await db.collection('visitors').countDocuments(mongoQuery);

        // Field mapping
        const fieldMapping = {
            name: 'visitorName',
            phone: 'phone',
            email: 'email',
            photo: 'visitorImages',
            company: 'organization',
            embedding: 'visitorEmbeddings'
        };

        // Build response with only requested fields
        const result = visitors.map(visitor => {
            const record = { id: String(visitor._id) };

            for (const field of fields) {
                const internalField = fieldMapping[field] || field;

                // Special handling for embedding field
                if (field === 'embedding' && visitor.visitorEmbeddings) {
                    const embeddings = visitor.visitorEmbeddings;
                    const normalizedEmbeddings = {};

                    if (typeof embeddings === 'object') {
                        for (const [model, embData] of Object.entries(embeddings)) {
                            if (typeof embData === 'object' && embData.status === 'done') {
                                normalizedEmbeddings[model] = {
                                    embeddingId: embData.embeddingId ? String(embData.embeddingId) : '',
                                    status: embData.status,
                                    model
                                };
                            }
                        }
                    }

                    if (Object.keys(normalizedEmbeddings).length > 0) {
                        record.embedding = normalizedEmbeddings;
                    }
                    continue;
                }

                if (visitor[internalField] !== undefined) {
                    let value = visitor[internalField];

                    // Handle ObjectId
                    if (value instanceof ObjectId) {
                        value = String(value);
                    }
                    // Handle Date
                    else if (value instanceof Date) {
                        value = value.toISOString();
                    }
                    // Handle dict with ObjectIds
                    else if (typeof value === 'object' && value !== null) {
                        value = Object.fromEntries(
                            Object.entries(value).map(([k, v]) => [
                                k,
                                v instanceof ObjectId ? String(v) : v
                            ])
                        );
                    }

                    record[field] = value;
                }
            }

            return record;
        });

        res.json({
            actors: result,
            count: result.length,
            total,
            offset,
            limit
        });
    } catch (error) {
        console.error('Error in residency query visitors:', error);
        next(error);
    }
});

/**
 * POST /api/residency/sync/visitors
 * Trigger visitor data sync to platform.
 * 
 * Called to sync visitor data when residency mode is 'platform'.
 */
router.post('/sync/visitors', async (req, res, next) => {
    try {
        const data = req.body || {};
        const syncMode = data.mode || 'incremental';
        const since = data.since;

        const db = getDb();

        // Get company ID from installation
        const installation = await db.collection('installations').findOne({});
        if (!installation) {
            return res.status(400).json({ error: 'No installation found' });
        }

        const companyId = installation.company_id || installation.companyId;

        // Build query
        const mongoQuery = {};
        if (isValidObjectId(companyId)) {
            mongoQuery.$or = [
                { companyId: new ObjectId(companyId) },
                { companyId }
            ];
        } else {
            mongoQuery.companyId = companyId;
        }

        if (syncMode === 'incremental' && since) {
            try {
                const sinceDate = new Date(since);
                mongoQuery.lastUpdated = { $gte: sinceDate };
            } catch {
                // Ignore invalid date
            }
        }

        const visitors = await db.collection('visitors').find(mongoQuery).toArray();

        // Prepare batch for sync
        const syncBatch = visitors.map(visitor => {
            const syncData = {
                type: 'visitor',
                id: String(visitor._id),
                data: {
                    name: visitor.visitorName,
                    phone: visitor.phone,
                    email: visitor.email,
                    company: visitor.organization
                },
                operation: 'upsert'
            };

            // Include photo reference if available
            if (visitor.visitorImages && visitor.visitorImages.center) {
                syncData.data.photo = String(visitor.visitorImages.center);
            }

            // Include embedding if available
            if (visitor.visitorEmbeddings) {
                for (const [model, embData] of Object.entries(visitor.visitorEmbeddings)) {
                    if (embData && embData.status === 'done') {
                        syncData.data.embedding = {
                            model,
                            id: embData.embeddingId
                        };
                        break;
                    }
                }
            }

            return syncData;
        });

        // Note: Actual platform sync would call integration_client.sync_actors_batch
        // For now, return the prepared data
        res.json({
            message: 'Sync prepared',
            mode: syncMode,
            total: visitors.length,
            syncBatch: syncBatch.length,
            note: 'Platform sync would be triggered here'
        });
    } catch (error) {
        console.error('Error in residency sync visitors:', error);
        next(error);
    }
});

/**
 * POST /api/residency/sync/visitors/:visitor_id
 * Sync a single visitor to platform.
 */
router.post('/sync/visitors/:visitor_id', async (req, res, next) => {
    try {
        const { visitor_id } = req.params;

        if (!isValidObjectId(visitor_id)) {
            return res.status(400).json({ error: 'Invalid visitor ID' });
        }

        const db = getDb();
        const visitor = await db.collection('visitors').findOne({ _id: new ObjectId(visitor_id) });

        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        // Prepare sync data
        const syncData = {
            type: 'visitor',
            id: String(visitor._id),
            data: {
                name: visitor.visitorName,
                phone: visitor.phone,
                email: visitor.email,
                company: visitor.organization
            },
            operation: 'upsert'
        };

        // Note: Actual platform sync would call integration_client.sync_actor
        res.json({
            message: 'Visitor sync prepared',
            syncData,
            note: 'Platform sync would be triggered here'
        });
    } catch (error) {
        console.error('Error in residency sync single visitor:', error);
        next(error);
    }
});

module.exports = router;
