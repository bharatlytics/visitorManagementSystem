/**
 * Watchlist API
 * Blacklist and watchlist management
 * Matching Python app/api/watchlist.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId, validateRequiredFields } = require('../utils/helpers');

/**
 * GET /api/watchlist
 * List all watchlist entries for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const db = getDb();
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const watchlist = await db.collection('watchlist')
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await db.collection('watchlist').countDocuments(query);

        res.json({
            watchlist: convertObjectIds(watchlist),
            total,
            limit,
            skip
        });
    } catch (error) {
        console.error('Error listing watchlist:', error);
        next(error);
    }
});

/**
 * POST /api/watchlist
 * Add a person to watchlist
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'name']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        const db = getDb();
        const watchlistDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            name: data.name,
            phone: data.phone || null,
            email: data.email || null,
            idType: data.idType || null,
            idNumber: data.idNumber || null,
            reason: data.reason || 'No reason provided',
            category: data.category || 'blacklist', // blacklist, watchlist, vip, restricted
            severity: data.severity || 'medium', // low, medium, high
            entityType: data.entityType || null, // visitor, employee
            entityId: data.entityId && isValidObjectId(data.entityId) ? new ObjectId(data.entityId) : (data.entityId || null),
            statusHistory: [{ status: 'active', changedAt: new Date(), changedBy: data.addedBy || req.user?.name || 'system', reason: data.reason || '' }],
            addedBy: data.addedBy || req.user?.name || 'system',
            status: 'active',
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            notes: data.notes || null,
            imageId: data.imageId || null,
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await db.collection('watchlist').insertOne(watchlistDoc);

        res.status(201).json({
            message: 'Added to watchlist successfully',
            _id: watchlistDoc._id.toString(),
            entry: convertObjectIds(watchlistDoc)
        });
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        next(error);
    }
});

/**
 * GET /api/watchlist/:entry_id
 * Get single watchlist entry
 */
router.get('/:entry_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entry_id } = req.params;

        if (!isValidObjectId(entry_id)) {
            return res.status(400).json({ error: 'Invalid entry ID format' });
        }

        const db = getDb();
        const entry = await db.collection('watchlist').findOne({ _id: new ObjectId(entry_id) });

        if (!entry) {
            return res.status(404).json({ error: 'Watchlist entry not found' });
        }

        // If linked to a visitor or employee, enrich with their data
        let linkedEntity = null;
        if (entry.entityId && entry.entityType) {
            try {
                const eid = isValidObjectId(entry.entityId) ? new ObjectId(entry.entityId) : entry.entityId;
                const col = entry.entityType === 'employee' ? 'employees' : 'visitors';
                linkedEntity = await db.collection(col).findOne({ _id: eid });
                if (linkedEntity) linkedEntity = convertObjectIds(linkedEntity);
            } catch (e) { /* ignore lookup failures */ }
        }

        res.json({ entry: convertObjectIds(entry), linkedEntity });
    } catch (error) {
        console.error('Error getting watchlist entry:', error);
        next(error);
    }
});

/**
 * PUT /api/watchlist/:entry_id
 * Update watchlist entry
 */
router.put('/:entry_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entry_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(entry_id)) {
            return res.status(400).json({ error: 'Invalid entry ID format' });
        }

        const updateFields = {};
        const allowedFields = ['name', 'phone', 'email', 'idType', 'idNumber', 'reason', 'category', 'severity', 'status', 'notes', 'expiresAt', 'entityType', 'entityId'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'expiresAt' && data[field]) {
                    updateFields[field] = new Date(data[field]);
                } else if (field === 'entityId' && data[field] && isValidObjectId(data[field])) {
                    updateFields[field] = new ObjectId(data[field]);
                } else {
                    updateFields[field] = data[field];
                }
            }
        }

        // Track status changes in history
        if (data.status) {
            const historyEntry = {
                status: data.status,
                changedAt: new Date(),
                changedBy: data.changedBy || req.user?.name || 'system',
                reason: data.statusChangeReason || ''
            };
            // Use $push for statusHistory alongside $set
            const db2 = getDb();
            await db2.collection('watchlist').updateOne(
                { _id: new ObjectId(entry_id) },
                { $push: { statusHistory: historyEntry } }
            );
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const db = getDb();
        const result = await db.collection('watchlist').updateOne(
            { _id: new ObjectId(entry_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Watchlist entry not found' });
        }

        res.json({ message: 'Watchlist entry updated successfully' });
    } catch (error) {
        console.error('Error updating watchlist:', error);
        next(error);
    }
});

/**
 * PATCH /api/watchlist/:entry_id/status
 * Quick status change (e.g. active → cleared, cleared → active)
 */
router.patch('/:entry_id/status', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entry_id } = req.params;
        const { status, reason } = req.body;

        if (!isValidObjectId(entry_id)) {
            return res.status(400).json({ error: 'Invalid entry ID format' });
        }

        const validStatuses = ['active', 'cleared', 'expired'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const db = getDb();
        const historyEntry = {
            status,
            changedAt: new Date(),
            changedBy: req.user?.name || 'system',
            reason: reason || ''
        };

        const result = await db.collection('watchlist').updateOne(
            { _id: new ObjectId(entry_id) },
            {
                $set: { status, lastUpdated: new Date() },
                $push: { statusHistory: historyEntry }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Watchlist entry not found' });
        }

        res.json({ message: `Status changed to ${status}`, status });
    } catch (error) {
        console.error('Error changing watchlist status:', error);
        next(error);
    }
});

/**
 * DELETE /api/watchlist/:entry_id
 * Permanently remove from watchlist
 */
router.delete('/:entry_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entry_id } = req.params;

        if (!isValidObjectId(entry_id)) {
            return res.status(400).json({ error: 'Invalid entry ID format' });
        }

        const db = getDb();
        const result = await db.collection('watchlist').deleteOne({ _id: new ObjectId(entry_id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Watchlist entry not found' });
        }

        res.json({ message: 'Permanently removed from watchlist' });
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        next(error);
    }
});

/**
 * GET /api/watchlist/alerts
 * Escalation alerts — blacklisted/restricted persons with recent activity
 */
router.get('/alerts', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const companyMatch = isValidObjectId(companyId) ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] } : { companyId };

        // Get all active blacklisted/restricted entries
        const dangerEntries = await db.collection('watchlist').find({
            ...companyMatch,
            status: 'active',
            category: { $in: ['blacklist', 'restricted'] }
        }).toArray();

        if (dangerEntries.length === 0) {
            return res.json({ alerts: [], totalDanger: 0 });
        }

        const alerts = [];

        for (const entry of dangerEntries) {
            let recentActivity = [];

            // Build match conditions: by entityId or by name/phone
            if (entry.entityType === 'visitor' || !entry.entityType) {
                // Search visits by visitorId or name/phone
                const visitQuery = { ...companyMatch, createdAt: { $gte: since } };
                const orConds = [];
                if (entry.entityId) {
                    const eid = isValidObjectId(entry.entityId) ? new ObjectId(entry.entityId) : entry.entityId;
                    orConds.push({ visitorId: eid });
                    orConds.push({ visitorId: entry.entityId.toString() });
                }
                if (entry.name) orConds.push({ visitorName: { $regex: entry.name, $options: 'i' } });
                if (entry.phone) orConds.push({ visitorMobile: entry.phone });
                if (entry.phone) orConds.push({ phone: entry.phone });

                if (orConds.length > 0) {
                    visitQuery.$or = orConds;
                    const visits = await db.collection('visits').find(visitQuery).sort({ createdAt: -1 }).limit(3).toArray();
                    recentActivity.push(...visits.map(v => ({
                        type: 'visit',
                        date: v.createdAt || v.expectedArrival,
                        status: v.status,
                        purpose: v.purpose || '',
                        host: v.hostEmployeeName || '',
                        location: v.locationName || '',
                    })));
                }
            }

            if (entry.entityType === 'employee' || !entry.entityType) {
                // Search attendance by employeeId or name
                const attQuery = { ...companyMatch, date: { $gte: since } };
                const orConds = [];
                if (entry.entityId) {
                    const eid = isValidObjectId(entry.entityId) ? new ObjectId(entry.entityId) : entry.entityId;
                    orConds.push({ employeeId: eid });
                    orConds.push({ employeeId: entry.entityId.toString() });
                }
                if (entry.name) orConds.push({ employeeName: { $regex: entry.name, $options: 'i' } });

                if (orConds.length > 0) {
                    attQuery.$or = orConds;
                    const att = await db.collection('attendance').find(attQuery).sort({ date: -1 }).limit(3).toArray();
                    recentActivity.push(...att.map(a => ({
                        type: 'attendance',
                        date: a.date || a.checkIn,
                        status: a.checkOut ? 'checked-out' : 'checked-in',
                        checkIn: a.checkIn,
                        checkOut: a.checkOut,
                        source: a.source || '',
                        deviceId: a.deviceId || '',
                    })));
                }
            }

            if (recentActivity.length > 0) {
                // Sort by date descending
                recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date));
                alerts.push({
                    entryId: entry._id.toString(),
                    name: entry.name,
                    phone: entry.phone,
                    category: entry.category,
                    severity: entry.severity,
                    reason: entry.reason,
                    entityType: entry.entityType || 'unknown',
                    lastSeen: recentActivity[0].date,
                    lastSeenType: recentActivity[0].type,
                    activityCount: recentActivity.length,
                    recentActivity: recentActivity.slice(0, 3),
                });
            }
        }

        // Sort alerts by most recent first
        alerts.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

        res.json({
            alerts,
            totalDanger: dangerEntries.length,
            alertCount: alerts.length,
            periodDays: days,
        });
    } catch (error) {
        console.error('Error fetching watchlist alerts:', error);
        next(error);
    }
});

/**
 * GET /api/watchlist/:entry_id/activity
 * Get recent activity (visits + attendance) for a watchlist entry
 */
router.get('/:entry_id/activity', requireCompanyAccess, async (req, res, next) => {
    try {
        const { entry_id } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        if (!isValidObjectId(entry_id)) {
            return res.status(400).json({ error: 'Invalid entry ID format' });
        }

        const db = getDb();
        const entry = await db.collection('watchlist').findOne({ _id: new ObjectId(entry_id) });

        if (!entry) {
            return res.status(404).json({ error: 'Watchlist entry not found' });
        }

        const companyMatch = entry.companyId
            ? (isValidObjectId(entry.companyId) ? { $or: [{ companyId: new ObjectId(entry.companyId) }, { companyId: entry.companyId.toString() }] } : { companyId: entry.companyId })
            : {};

        const activity = [];

        // ─── Search Visits ────────────────────────────────────────
        const visitOrConds = [];
        if (entry.entityId && entry.entityType === 'visitor') {
            const eid = isValidObjectId(entry.entityId) ? new ObjectId(entry.entityId) : entry.entityId;
            visitOrConds.push({ visitorId: eid });
            visitOrConds.push({ visitorId: entry.entityId.toString() });
        }
        if (entry.name) visitOrConds.push({ visitorName: { $regex: entry.name, $options: 'i' } });
        if (entry.phone) visitOrConds.push({ visitorMobile: entry.phone });
        if (entry.phone) visitOrConds.push({ phone: entry.phone });

        if (visitOrConds.length > 0) {
            const visits = await db.collection('visits').find({
                ...companyMatch,
                $or: visitOrConds,
            }).sort({ createdAt: -1 }).limit(limit).toArray();

            activity.push(...visits.map(v => ({
                _id: v._id.toString(),
                type: 'visit',
                date: v.createdAt || v.expectedArrival,
                status: v.status || 'unknown',
                purpose: v.purpose || '',
                host: v.hostEmployeeName || '',
                location: v.locationName || '',
                checkIn: v.actualArrival || null,
                checkOut: v.actualDeparture || null,
                visitorName: v.visitorName || '',
            })));
        }

        // ─── Search Attendance ────────────────────────────────────
        const attOrConds = [];
        if (entry.entityId && entry.entityType === 'employee') {
            const eid = isValidObjectId(entry.entityId) ? new ObjectId(entry.entityId) : entry.entityId;
            attOrConds.push({ employeeId: eid });
            attOrConds.push({ employeeId: entry.entityId.toString() });
        }
        if (entry.name) attOrConds.push({ employeeName: { $regex: entry.name, $options: 'i' } });

        if (attOrConds.length > 0) {
            const att = await db.collection('attendance').find({
                ...companyMatch,
                $or: attOrConds,
            }).sort({ date: -1 }).limit(limit).toArray();

            activity.push(...att.map(a => ({
                _id: a._id.toString(),
                type: 'attendance',
                date: a.date || a.checkIn,
                status: a.checkOut ? 'checked-out' : 'checked-in',
                checkIn: a.checkIn || null,
                checkOut: a.checkOut || null,
                hoursWorked: a.hoursWorked || null,
                source: a.source || '',
                deviceId: a.deviceId || '',
                employeeName: a.employeeName || '',
            })));
        }

        // Sort all activity by date descending and take top N
        activity.sort((a, b) => new Date(b.date) - new Date(a.date));
        const trimmed = activity.slice(0, limit);

        res.json({
            activity: trimmed,
            total: trimmed.length,
            entityType: entry.entityType || 'unknown',
            name: entry.name,
        });
    } catch (error) {
        console.error('Error fetching watchlist activity:', error);
        next(error);
    }
});

/**
 * POST /api/watchlist/check
 * Check if a person is on watchlist
 */
router.post('/check', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, phone, email, name } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const companyQuery = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;

        const orConditions = [];
        if (phone) orConditions.push({ phone });
        if (email) orConditions.push({ email });
        if (name) orConditions.push({ name: { $regex: name, $options: 'i' } });

        if (orConditions.length === 0) {
            return res.status(400).json({ error: 'At least one of phone, email, or name is required' });
        }

        const match = await db.collection('watchlist').findOne({
            companyId: companyQuery,
            status: 'active',
            $or: orConditions
        });

        res.json({
            onWatchlist: Boolean(match),
            entry: match ? convertObjectIds(match) : null
        });
    } catch (error) {
        console.error('Error checking watchlist:', error);
        next(error);
    }
});

module.exports = router;
