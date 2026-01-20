/**
 * Mobile API
 * Mobile-specific endpoints for VMS app
 * Matching Python app/api/mobile_api.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getGridFSBucket } = require('../db');
const { requireAuth, requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * POST /api/mobile/sync
 * Sync data between mobile app and server
 */
router.post('/sync', requireAuth, async (req, res, next) => {
    try {
        const { companyId, lastSyncTime, entities } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const syncTime = lastSyncTime ? new Date(lastSyncTime) : new Date(0);
        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const updates = {};
        const entitiesToSync = entities || ['employees', 'visitors', 'visits', 'settings'];

        for (const entity of entitiesToSync) {
            if (entity === 'employees') {
                updates.employees = await collections.employees()
                    .find({ ...companyMatch, lastUpdated: { $gt: syncTime } })
                    .project({ employeeImages: 0, employeeEmbeddings: 0 })
                    .toArray();
            } else if (entity === 'visitors') {
                updates.visitors = await collections.visitors()
                    .find({ ...companyMatch, lastUpdated: { $gt: syncTime } })
                    .project({ visitorImages: 0, visitorEmbeddings: 0 })
                    .toArray();
            } else if (entity === 'visits') {
                updates.visits = await collections.visits()
                    .find({ ...companyMatch, lastUpdated: { $gt: syncTime } })
                    .toArray();
            } else if (entity === 'settings') {
                const settings = await collections.settings().findOne(companyMatch);
                if (settings && settings.lastUpdated > syncTime) {
                    updates.settings = settings;
                }
            }
        }

        res.json({
            syncTime: new Date().toISOString(),
            updates: convertObjectIds(updates)
        });
    } catch (error) {
        console.error('Error syncing data:', error);
        next(error);
    }
});

/**
 * POST /api/mobile/quick-checkin
 * Quick check-in for walk-in visitors
 */
router.post('/quick-checkin', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, visitorName, phone, hostEmployeeId, purpose } = req.body;

        if (!companyId || !visitorName || !hostEmployeeId) {
            return res.status(400).json({ error: 'companyId, visitorName, and hostEmployeeId are required' });
        }

        const companyOid = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;

        // Check if visitor exists
        let visitor = null;
        if (phone) {
            visitor = await collections.visitors().findOne({
                companyId: companyOid,
                phone
            });
        }

        // Create visitor if not exists
        if (!visitor) {
            const visitorDoc = {
                _id: new ObjectId(),
                companyId: companyOid,
                visitorName,
                phone: phone || null,
                hostEmployeeId: isValidObjectId(hostEmployeeId) ? new ObjectId(hostEmployeeId) : hostEmployeeId,
                visitorType: 'walk-in',
                status: 'active',
                createdAt: new Date(),
                lastUpdated: new Date()
            };
            await collections.visitors().insertOne(visitorDoc);
            visitor = visitorDoc;
        }

        // Create check-in visit
        const visitDoc = {
            _id: new ObjectId(),
            visitorId: visitor._id,
            companyId: companyOid,
            hostEmployeeId: isValidObjectId(hostEmployeeId) ? new ObjectId(hostEmployeeId) : hostEmployeeId,
            visitorName,
            purpose: purpose || 'Walk-in visit',
            expectedArrival: new Date(),
            actualArrival: new Date(),
            status: 'checked_in',
            checkInMethod: 'mobile_quick',
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await collections.visits().insertOne(visitDoc);

        res.status(201).json({
            message: 'Quick check-in successful',
            visitId: visitDoc._id.toString(),
            visitorId: visitor._id.toString()
        });
    } catch (error) {
        console.error('Error in quick check-in:', error);
        next(error);
    }
});

/**
 * GET /api/mobile/today
 * Get today's visits and stats for mobile dashboard
 */
router.get('/today', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const [
            scheduledVisits,
            checkedInVisits,
            completedVisits,
            upcomingVisits
        ] = await Promise.all([
            collections.visits().countDocuments({
                ...companyMatch,
                status: 'scheduled',
                expectedArrival: { $gte: startOfDay, $lte: endOfDay }
            }),
            collections.visits().countDocuments({
                ...companyMatch,
                status: 'checked_in'
            }),
            collections.visits().countDocuments({
                ...companyMatch,
                status: 'checked_out',
                actualDeparture: { $gte: startOfDay }
            }),
            collections.visits()
                .find({
                    ...companyMatch,
                    status: 'scheduled',
                    expectedArrival: { $gte: new Date(), $lte: endOfDay }
                })
                .sort({ expectedArrival: 1 })
                .limit(10)
                .toArray()
        ]);

        res.json({
            stats: {
                scheduled: scheduledVisits,
                checkedIn: checkedInVisits,
                completed: completedVisits
            },
            upcomingVisits: convertObjectIds(upcomingVisits)
        });
    } catch (error) {
        console.error('Error fetching today data:', error);
        next(error);
    }
});

/**
 * POST /api/mobile/face-match
 * Match face against registered visitors/employees
 */
router.post('/face-match', requireAuth, async (req, res, next) => {
    try {
        // This would integrate with face recognition service
        // For now, return placeholder
        res.json({
            matches: [],
            message: 'Face matching requires integration with embedding worker'
        });
    } catch (error) {
        console.error('Error in face match:', error);
        next(error);
    }
});

/**
 * GET /api/mobile/embeddings/download
 * Download embeddings for offline face matching
 */
router.get('/embeddings/download', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const lastSync = req.query.lastSync ? new Date(req.query.lastSync) : new Date(0);

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        // Get employees with embeddings
        const employees = await collections.employees()
            .find({
                ...companyMatch,
                'employeeEmbeddings.buffalo_l.status': 'done',
                lastUpdated: { $gt: lastSync }
            })
            .project({
                _id: 1,
                employeeId: 1,
                employeeName: 1,
                'employeeEmbeddings.buffalo_l.embeddingId': 1,
                'employeeEmbeddings.buffalo_l.downloadUrl': 1
            })
            .toArray();

        // Get visitors with embeddings
        const visitors = await collections.visitors()
            .find({
                ...companyMatch,
                'visitorEmbeddings.buffalo_l.status': 'done',
                lastUpdated: { $gt: lastSync }
            })
            .project({
                _id: 1,
                visitorName: 1,
                phone: 1,
                'visitorEmbeddings.buffalo_l.embeddingId': 1,
                'visitorEmbeddings.buffalo_l.downloadUrl': 1
            })
            .toArray();

        res.json({
            syncTime: new Date().toISOString(),
            employees: convertObjectIds(employees),
            visitors: convertObjectIds(visitors)
        });
    } catch (error) {
        console.error('Error fetching embeddings:', error);
        next(error);
    }
});

module.exports = router;
