/**
 * GDPR Compliance API
 * 
 * Endpoints for GDPR and privacy compliance:
 * - Data export (right to access)
 * - Data deletion (right to be forgotten)
 * - Consent management
 */
const express = require('express');
const router = express.Router();
const { ObjectId, GridFSBucket } = require('mongodb');
const { collections, getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');

/**
 * Convert ObjectIds and Dates to strings recursively
 */
function convertObjectIds(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof ObjectId) return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(convertObjectIds);
    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertObjectIds(value);
        }
        return result;
    }
    return obj;
}

/**
 * GET /export/:visitorId
 * Export all data for a visitor (GDPR right to access)
 */
router.get('/export/:visitorId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId } = req.params;
        const companyId = req.query.companyId || req.companyId;
        const exportFormat = req.query.format || 'json';
        const includeVisits = req.query.includeVisits !== 'false';
        const includeImages = req.query.includeImages === 'true';

        // Get visitor
        const visitor = await collections.visitors.findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        const exportData = {
            exportedAt: new Date().toISOString(),
            exportType: 'GDPR_DATA_ACCESS',
            visitor: convertObjectIds(visitor)
        };

        // Get visits
        if (includeVisits) {
            const visits = await collections.visits.find({ visitorId: new ObjectId(visitorId) }).toArray();
            exportData.visits = convertObjectIds(visits);
            exportData.visitCount = visits.length;
        }

        // Get images as base64 (if requested)
        if (includeImages && visitor.visitorImages) {
            const db = getDb();
            const imageBucket = new GridFSBucket(db, { bucketName: 'visitorImages' });
            const images = {};

            for (const [position, imageId] of Object.entries(visitor.visitorImages)) {
                if (imageId) {
                    try {
                        const chunks = [];
                        const stream = imageBucket.openDownloadStream(new ObjectId(imageId));
                        for await (const chunk of stream) {
                            chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        images[position] = buffer.toString('base64');
                    } catch (err) {
                        // Skip if image not found
                    }
                }
            }
            exportData.images = images;
        }

        // Get audit trail
        const db = getDb();
        const auditLogs = await db.collection('audit_logs').find({
            entityType: 'visitor',
            entityId: visitorId
        }).sort({ timestamp: 1 }).toArray();
        exportData.auditTrail = convertObjectIds(auditLogs);

        if (exportFormat === 'json') {
            res.set({
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename=visitor_export_${visitorId}.json`
            });
            res.send(JSON.stringify(exportData, null, 2));
        } else {
            res.json(exportData);
        }

    } catch (error) {
        console.error('Error exporting visitor data:', error);
        next(error);
    }
});

/**
 * POST /deletion-request
 * Create a data deletion request (GDPR right to be forgotten)
 */
router.post('/deletion-request', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const companyId = data.companyId || req.companyId;
        const visitorId = data.visitorId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        if (!data.reason) {
            return res.status(400).json({ error: 'Reason is required' });
        }

        // Verify visitor exists
        const visitor = await collections.visitors.findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        const db = getDb();
        const deletionRequests = db.collection('gdpr_deletion_requests');

        // Check for existing pending request
        const existing = await deletionRequests.findOne({
            visitorId: new ObjectId(visitorId),
            status: 'pending'
        });

        if (existing) {
            return res.status(409).json({
                error: 'Deletion request already pending',
                requestId: existing._id.toString()
            });
        }

        const requestDoc = {
            _id: new ObjectId(),
            companyId,
            visitorId: new ObjectId(visitorId),
            visitorName: visitor.visitorName,
            visitorEmail: visitor.email,
            visitorPhone: visitor.phone,
            reason: data.reason,
            requestedBy: data.requestedBy || req.userId || 'visitor',
            contactEmail: data.email,
            status: 'pending',
            createdAt: new Date(),
            processedAt: null,
            processedBy: null
        };

        await deletionRequests.insertOne(requestDoc);

        res.status(201).json({
            message: 'Deletion request created',
            requestId: requestDoc._id.toString(),
            status: 'pending',
            note: 'Request will be processed within 30 days as per GDPR requirements'
        });

    } catch (error) {
        console.error('Error creating deletion request:', error);
        next(error);
    }
});

/**
 * DELETE /purge/:visitorId
 * Permanently delete all visitor data (GDPR right to be forgotten)
 */
router.delete('/purge/:visitorId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId } = req.params;
        const data = req.body || {};
        const companyId = req.query.companyId || req.companyId;

        if (data.confirmation !== 'PERMANENTLY DELETE') {
            return res.status(400).json({ error: 'Confirmation text must be "PERMANENTLY DELETE"' });
        }

        if (!data.reason) {
            return res.status(400).json({ error: 'Reason is required' });
        }

        // Get visitor before deletion
        const visitor = await collections.visitors.findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        const deletedItems = {
            visitor: false,
            visits: 0,
            images: 0,
            embeddings: 0,
            auditLogs: 0
        };

        const db = getDb();

        // Delete images
        if (visitor.visitorImages) {
            const imageBucket = new GridFSBucket(db, { bucketName: 'visitorImages' });
            for (const [position, imageId] of Object.entries(visitor.visitorImages)) {
                if (imageId) {
                    try {
                        await imageBucket.delete(new ObjectId(imageId));
                        deletedItems.images++;
                    } catch { /* ignore */ }
                }
            }
        }

        // Delete embeddings
        if (visitor.visitorEmbeddings) {
            const embeddingBucket = new GridFSBucket(db, { bucketName: 'visitorEmbeddings' });
            for (const [model, embData] of Object.entries(visitor.visitorEmbeddings)) {
                if (typeof embData === 'object' && embData?.fileId) {
                    try {
                        await embeddingBucket.delete(new ObjectId(embData.fileId));
                        deletedItems.embeddings++;
                    } catch { /* ignore */ }
                }
            }
        }

        // Delete visits
        const visitResult = await collections.visits.deleteMany({ visitorId: new ObjectId(visitorId) });
        deletedItems.visits = visitResult.deletedCount;

        // Anonymize audit logs
        await db.collection('audit_logs').updateMany(
            { entityType: 'visitor', entityId: visitorId },
            {
                $set: {
                    anonymized: true,
                    anonymizedAt: new Date(),
                    'details.visitorName': '[REDACTED]',
                    'details.phone': '[REDACTED]',
                    'details.email': '[REDACTED]'
                },
                $unset: {
                    before: '',
                    after: ''
                }
            }
        );

        // Delete visitor record
        await collections.visitors.deleteOne({ _id: new ObjectId(visitorId) });
        deletedItems.visitor = true;

        // Update deletion request if exists
        await db.collection('gdpr_deletion_requests').updateOne(
            { visitorId: new ObjectId(visitorId), status: 'pending' },
            {
                $set: {
                    status: 'completed',
                    processedAt: new Date(),
                    processedBy: req.userId || 'system'
                }
            }
        );

        res.json({
            message: 'Visitor data permanently deleted',
            visitorId,
            deletedItems
        });

    } catch (error) {
        console.error('Error purging visitor data:', error);
        next(error);
    }
});

/**
 * GET /deletion-requests
 * List all deletion requests for a company
 */
router.get('/deletion-requests', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const status = req.query.status;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const deletionRequests = db.collection('gdpr_deletion_requests');

        const query = { companyId };
        if (status) query.status = status;

        const requests = await deletionRequests.find(query)
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            requests: convertObjectIds(requests),
            count: requests.length
        });

    } catch (error) {
        console.error('Error listing deletion requests:', error);
        next(error);
    }
});

/**
 * POST /consent
 * Record visitor consent for data processing
 */
router.post('/consent', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const visitorId = data.visitorId;
        const consentType = data.consentType;
        const granted = data.granted;

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        if (!consentType) {
            return res.status(400).json({ error: 'Consent type is required' });
        }

        if (granted === null || granted === undefined) {
            return res.status(400).json({ error: 'Granted status is required' });
        }

        // Update visitor with consent record
        const consentRecord = {
            type: consentType,
            granted,
            method: data.method || 'digital',
            recordedAt: new Date(),
            ipAddress: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || ''
        };

        await collections.visitors.updateOne(
            { _id: new ObjectId(visitorId) },
            {
                $push: { consents: consentRecord },
                $set: { [`consent.${consentType}`]: granted }
            }
        );

        res.json({
            message: 'Consent recorded',
            visitorId,
            consentType,
            granted
        });

    } catch (error) {
        console.error('Error recording consent:', error);
        next(error);
    }
});

/**
 * POST /retention/run
 * Run data retention cleanup
 */
router.post('/retention/run', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.body?.companyId || req.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const settings = await db.collection('settings').findOne({ companyId });

        // Default retention periods (in days)
        const retention = {
            checkedOutVisits: settings?.retentionDays?.visits || 365,
            deletedVisitors: settings?.retentionDays?.deletedVisitors || 90,
            auditLogs: settings?.retentionDays?.auditLogs || 1095  // 3 years
        };

        const now = new Date();
        const deletedCounts = {};

        // Delete old checked-out visits
        const visitCutoff = new Date(now);
        visitCutoff.setDate(visitCutoff.getDate() - retention.checkedOutVisits);
        const visitResult = await collections.visits.deleteMany({
            companyId,
            status: 'checked_out',
            actualDeparture: { $lt: visitCutoff }
        });
        deletedCounts.visits = visitResult.deletedCount;

        // Delete visitors marked as deleted
        const visitorCutoff = new Date(now);
        visitorCutoff.setDate(visitorCutoff.getDate() - retention.deletedVisitors);
        const visitorResult = await collections.visitors.deleteMany({
            companyId,
            status: 'deleted',
            lastUpdated: { $lt: visitorCutoff }
        });
        deletedCounts.visitors = visitorResult.deletedCount;

        res.json({
            message: 'Retention cleanup completed',
            deleted: deletedCounts,
            retentionDays: retention
        });

    } catch (error) {
        console.error('Error running retention cleanup:', error);
        next(error);
    }
});

module.exports = router;
