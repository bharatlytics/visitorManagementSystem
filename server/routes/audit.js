/**
 * Audit API
 * 
 * REST endpoints for accessing audit logs:
 * - Search and filter audit logs
 * - Export for compliance
 * - Get entity-specific history
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
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
 * GET /logs
 * Search audit logs with filters
 */
router.get('/logs', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        // Build query
        const query = { companyId };

        if (req.query.action) query.action = req.query.action;
        if (req.query.entityType) query.entityType = req.query.entityType;
        if (req.query.entityId) query.entityId = req.query.entityId;
        if (req.query.userId) query['user.id'] = req.query.userId;
        if (req.query.severity) query.severity = req.query.severity;

        // Date range
        if (req.query.startDate || req.query.endDate) {
            query.timestamp = {};
            if (req.query.startDate) {
                query.timestamp.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                query.timestamp.$lte = new Date(req.query.endDate);
            }
        }

        const limit = Math.min(parseInt(req.query.limit || '100'), 1000);
        const offset = parseInt(req.query.offset || '0');

        const db = getDb();
        const auditCollection = db.collection('audit_logs');

        const logs = await auditCollection.find(query)
            .sort({ timestamp: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();

        const total = await auditCollection.countDocuments(query);

        res.json({
            logs: convertObjectIds(logs),
            total,
            limit,
            offset
        });

    } catch (error) {
        console.error('Error searching audit logs:', error);
        next(error);
    }
});

/**
 * GET /entity/:entityType/:entityId
 * Get complete audit history for a specific entity
 */
router.get('/entity/:entityType/:entityId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entityType, entityId } = req.params;
        const companyId = req.query.companyId || req.companyId;

        const db = getDb();
        const auditCollection = db.collection('audit_logs');

        const query = {
            entityType,
            entityId
        };
        if (companyId) query.companyId = companyId;

        const logs = await auditCollection.find(query)
            .sort({ timestamp: -1 })
            .toArray();

        res.json({
            entityType,
            entityId,
            history: convertObjectIds(logs),
            count: logs.length
        });

    } catch (error) {
        console.error('Error getting entity audit history:', error);
        next(error);
    }
});

/**
 * GET /export
 * Export audit logs for compliance
 */
router.get('/export', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const exportFormat = req.query.format || 'json';
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start and end dates are required' });
        }

        const query = {
            companyId,
            timestamp: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            }
        };

        const db = getDb();
        const auditCollection = db.collection('audit_logs');

        const logs = await auditCollection.find(query)
            .sort({ timestamp: 1 })
            .toArray();

        const convertedLogs = convertObjectIds(logs);

        if (exportFormat === 'csv') {
            // Generate CSV
            const headers = ['timestamp', 'action', 'entityType', 'entityId', 'userId', 'userName', 'severity', 'ip'];
            const csvRows = [headers.join(',')];

            for (const log of convertedLogs) {
                csvRows.push([
                    log.timestamp || '',
                    log.action || '',
                    log.entityType || '',
                    log.entityId || '',
                    log.user?.id || '',
                    log.user?.name || '',
                    log.severity || '',
                    log.client?.ip || ''
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            }

            res.set({
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename=audit_logs_${startDate.substring(0, 10)}_to_${endDate.substring(0, 10)}.csv`
            });
            res.send(csvRows.join('\n'));
        } else {
            res.set({
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename=audit_logs_${startDate.substring(0, 10)}_to_${endDate.substring(0, 10)}.json`
            });
            res.send(JSON.stringify({ logs: convertedLogs }, null, 2));
        }

    } catch (error) {
        console.error('Error exporting audit logs:', error);
        next(error);
    }
});

/**
 * GET /summary
 * Get summary statistics of audit logs
 */
router.get('/summary', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const days = parseInt(req.query.days || '7');

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const db = getDb();
        const auditCollection = db.collection('audit_logs');

        const query = {
            companyId,
            timestamp: { $gte: startDate }
        };

        // Aggregate by action
        const actionCounts = await auditCollection.aggregate([
            { $match: query },
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        // Aggregate by severity
        const severityCounts = await auditCollection.aggregate([
            { $match: query },
            { $group: { _id: '$severity', count: { $sum: 1 } } }
        ]).toArray();

        const total = await auditCollection.countDocuments(query);

        const byAction = {};
        actionCounts.forEach(item => { byAction[item._id] = item.count; });

        const bySeverity = {};
        severityCounts.forEach(item => { bySeverity[item._id] = item.count; });

        res.json({
            period: `Last ${days} days`,
            totalActions: total,
            byAction,
            bySeverity
        });

    } catch (error) {
        console.error('Error getting audit summary:', error);
        next(error);
    }
});

/**
 * GET /security-events
 * Get security-related audit events
 */
router.get('/security-events', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const days = parseInt(req.query.days || '7');

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const db = getDb();
        const auditCollection = db.collection('audit_logs');

        // Security-related actions
        const securityActions = [
            'auth.login_failed',
            'security.blacklist_match',
            'security.unauthorized_access',
            'security.suspicious_activity',
            'visitor.blacklisted',
            'evacuation.triggered'
        ];

        const query = {
            companyId,
            timestamp: { $gte: startDate },
            $or: [
                { action: { $in: securityActions } },
                { severity: { $in: ['warning', 'critical'] } }
            ]
        };

        const events = await auditCollection.find(query)
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();

        res.json({
            securityEvents: convertObjectIds(events),
            count: events.length,
            period: `Last ${days} days`
        });

    } catch (error) {
        console.error('Error getting security events:', error);
        next(error);
    }
});

module.exports = router;
