/**
 * Emergency Evacuation API
 * 
 * Provides endpoints for emergency response and evacuation management:
 * - Real-time list of all on-site visitors
 * - Evacuation mode trigger
 * - Muster point check-in
 * - Headcount and status tracking
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
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
 * GET /evacuation-list
 * Get real-time list of all currently checked-in visitors
 */
router.get('/evacuation-list', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const locationId = req.query.locationId;
        const includeEmployees = req.query.includeEmployees === 'true';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        // Build query for checked-in visits
        const query = { status: 'checked_in' };

        try {
            const companyOid = new ObjectId(companyId);
            query.$or = [{ companyId: companyOid }, { companyId: companyId }];
        } catch {
            query.companyId = companyId;
        }

        if (locationId) {
            try {
                query.locationId = new ObjectId(locationId);
            } catch {
                query.locationId = locationId;
            }
        }

        // Fetch all checked-in visits
        const db = getDb();
        const visits = await db.collection('visits').find(query).toArray();

        const evacuationList = [];
        for (const visit of visits) {
            // Get visitor details
            let visitor = null;
            if (visit.visitorId) {
                try {
                    visitor = await db.collection('visitors').findOne({ _id: new ObjectId(visit.visitorId) });
                } catch {
                    visitor = await db.collection('visitors').findOne({ _id: visit.visitorId });
                }
            }

            // Get host employee details
            let host = null;
            const hostId = visit.hostEmployeeId;
            if (hostId) {
                try {
                    host = await db.collection('employees').findOne({ _id: new ObjectId(hostId) });
                } catch {
                    host = await db.collection('employees').findOne({ employeeId: hostId });
                }
            }

            evacuationList.push({
                visitId: visit._id.toString(),
                visitorId: visit.visitorId?.toString() || '',
                visitorName: visit.visitorName || (visitor?.visitorName || 'Unknown'),
                visitorPhone: visitor?.phone || '',
                visitorOrganization: visitor?.organization || '',
                hostEmployeeId: hostId?.toString() || '',
                hostEmployeeName: visit.hostEmployeeName || (host?.employeeName || 'Unknown'),
                hostEmployeePhone: host?.phone || '',
                hostEmployeeEmail: host?.email || '',
                locationId: visit.locationId?.toString() || '',
                locationName: visit.locationName || 'Main Building',
                checkInTime: visit.actualArrival,
                checkInMethod: visit.checkInMethod || 'unknown',
                purpose: visit.purpose || '',
                accessZones: visit.accessAreas || [],
                evacuationStatus: visit.evacuationStatus || 'on_site',
                musterPoint: visit.musterPoint,
                musterCheckInTime: visit.musterCheckInTime
            });
        }

        // Calculate summary
        const totalOnSite = evacuationList.length;
        const evacuatedCount = evacuationList.filter(e => e.evacuationStatus === 'evacuated').length;
        const missingCount = evacuationList.filter(e => e.evacuationStatus === 'missing').length;

        res.json({
            evacuationList: convertObjectIds(evacuationList),
            summary: {
                totalOnSite,
                evacuatedCount,
                missingCount,
                accountedFor: evacuatedCount,
                percentAccountedFor: totalOnSite > 0 ? Math.round((evacuatedCount / totalOnSite * 100) * 10) / 10 : 100
            },
            generatedAt: new Date().toISOString(),
            companyId
        });

    } catch (error) {
        console.error('Error getting evacuation list:', error);
        next(error);
    }
});

/**
 * POST /trigger
 * Trigger evacuation mode for a company/location
 */
router.post('/trigger', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const companyId = data.companyId || req.companyId;
        const locationId = data.locationId;
        const reason = data.reason || 'emergency';
        const musterPoints = data.musterPoints || ['Main Assembly Point'];

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const evacuationsCollection = db.collection('evacuations');

        // Check if evacuation already in progress
        const activeEvacuation = await evacuationsCollection.findOne({
            companyId,
            status: 'in_progress'
        });

        if (activeEvacuation) {
            return res.status(409).json({
                error: 'Evacuation already in progress',
                evacuationId: activeEvacuation._id.toString(),
                startedAt: activeEvacuation.startedAt
            });
        }

        const now = new Date();

        // Create evacuation record
        const evacuationDoc = {
            _id: new ObjectId(),
            companyId,
            locationId,
            reason,
            musterPoints,
            status: 'in_progress',
            startedAt: now,
            startedBy: req.userId || 'system',
            endedAt: null,
            totalVisitors: 0,
            totalEvacuated: 0
        };

        await evacuationsCollection.insertOne(evacuationDoc);

        // Build query for visits to update
        const visitQuery = { status: 'checked_in' };
        try {
            const companyOid = new ObjectId(companyId);
            visitQuery.$or = [{ companyId: companyOid }, { companyId: companyId }];
        } catch {
            visitQuery.companyId = companyId;
        }

        if (locationId) {
            visitQuery.locationId = locationId;
        }

        // Count visitors
        const visitsCollection = db.collection('visits');
        const visitorCount = await visitsCollection.countDocuments(visitQuery);

        // Update all checked-in visits with evacuation status
        await visitsCollection.updateMany(visitQuery, {
            $set: {
                evacuationStatus: 'on_site',
                evacuationId: evacuationDoc._id,
                evacuationStartedAt: now
            }
        });

        // Update evacuation record with visitor count
        await evacuationsCollection.updateOne(
            { _id: evacuationDoc._id },
            { $set: { totalVisitors: visitorCount } }
        );

        res.status(201).json({
            message: 'Evacuation triggered successfully',
            evacuationId: evacuationDoc._id.toString(),
            totalVisitors: visitorCount,
            musterPoints,
            status: 'in_progress',
            startedAt: evacuationDoc.startedAt.toISOString()
        });

    } catch (error) {
        console.error('Error triggering evacuation:', error);
        next(error);
    }
});

/**
 * POST /muster-checkin
 * Check in a visitor at a muster/assembly point
 */
router.post('/muster-checkin', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const visitId = data.visitId;
        const musterPoint = data.musterPoint || 'Main Assembly Point';
        const method = data.method || 'manual';

        if (!visitId) {
            return res.status(400).json({ error: 'Visit ID is required' });
        }

        // Find the visit
        const db = getDb();
        const visitsCollection = db.collection('visits');
        const visit = await visitsCollection.findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status !== 'checked_in') {
            return res.status(400).json({ error: 'Visitor is not currently checked in' });
        }

        if (visit.evacuationStatus === 'evacuated') {
            return res.json({
                message: 'Visitor already checked in at muster point',
                musterPoint: visit.musterPoint,
                musterCheckInTime: visit.musterCheckInTime
            });
        }

        const now = new Date();

        // Update visit with muster check-in
        await visitsCollection.updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    evacuationStatus: 'evacuated',
                    musterPoint,
                    musterCheckInTime: now,
                    musterCheckInMethod: method
                }
            }
        );

        // Update evacuation record counter
        if (visit.evacuationId) {
            const db = getDb();
            await db.collection('evacuations').updateOne(
                { _id: visit.evacuationId },
                { $inc: { totalEvacuated: 1 } }
            );
        }

        res.json({
            message: 'Muster check-in successful',
            visitId,
            visitorName: visit.visitorName || 'Unknown',
            musterPoint,
            checkedInAt: now.toISOString(),
            method
        });

    } catch (error) {
        console.error('Error during muster check-in:', error);
        next(error);
    }
});

/**
 * GET /status
 * Get current evacuation status and headcount
 */
router.get('/status', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const evacuationId = req.query.evacuationId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const evacuationsCollection = db.collection('evacuations');

        // Find evacuation
        let evacuation;
        if (evacuationId) {
            evacuation = await evacuationsCollection.findOne({ _id: new ObjectId(evacuationId) });
        } else {
            evacuation = await evacuationsCollection.findOne(
                { companyId, status: 'in_progress' },
                { sort: { startedAt: -1 } }
            );
        }

        if (!evacuation) {
            return res.json({
                active: false,
                message: 'No active evacuation',
                lastEvacuation: null
            });
        }

        // Get real-time counts from visits
        const visitsCollection = db.collection('visits');
        const evacuatedCount = await visitsCollection.countDocuments({
            evacuationId: evacuation._id,
            evacuationStatus: 'evacuated'
        });

        const onSiteCount = await visitsCollection.countDocuments({
            evacuationId: evacuation._id,
            evacuationStatus: 'on_site'
        });

        // Get list of missing visitors
        const missingVisitors = await visitsCollection.find({
            evacuationId: evacuation._id,
            evacuationStatus: 'on_site'
        }).toArray();

        const missingList = [];
        for (const visit of missingVisitors) {
            let visitor = null;
            if (visit.visitorId) {
                try {
                    visitor = await db.collection('visitors').findOne({ _id: new ObjectId(visit.visitorId) });
                } catch { /* ignore */ }
            }

            let host = null;
            if (visit.hostEmployeeId) {
                try {
                    host = await db.collection('employees').findOne({ _id: new ObjectId(visit.hostEmployeeId) });
                } catch {
                    host = await db.collection('employees').findOne({ employeeId: visit.hostEmployeeId });
                }
            }

            missingList.push({
                visitId: visit._id.toString(),
                visitorName: visit.visitorName || (visitor?.visitorName || 'Unknown'),
                visitorPhone: visitor?.phone || '',
                hostEmployeeName: host?.employeeName || '',
                hostEmployeePhone: host?.phone || '',
                lastKnownLocation: visit.locationName || 'Unknown',
                checkInTime: visit.actualArrival
            });
        }

        const totalVisitors = evacuatedCount + onSiteCount;

        res.json({
            active: evacuation.status === 'in_progress',
            evacuationId: evacuation._id.toString(),
            reason: evacuation.reason || 'emergency',
            startedAt: evacuation.startedAt,
            musterPoints: evacuation.musterPoints || [],
            counts: {
                total: totalVisitors,
                evacuated: evacuatedCount,
                missing: onSiteCount,
                percentSafe: totalVisitors > 0 ? Math.round((evacuatedCount / totalVisitors * 100) * 10) / 10 : 100
            },
            missingVisitors: convertObjectIds(missingList),
            status: evacuation.status
        });

    } catch (error) {
        console.error('Error getting evacuation status:', error);
        next(error);
    }
});

/**
 * POST /end
 * End an active evacuation
 */
router.post('/end', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const companyId = data.companyId || req.companyId;
        const evacuationId = data.evacuationId;
        const notes = data.notes || '';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const evacuationsCollection = db.collection('evacuations');

        // Find evacuation
        let evacuation;
        if (evacuationId) {
            evacuation = await evacuationsCollection.findOne({ _id: new ObjectId(evacuationId) });
        } else {
            evacuation = await evacuationsCollection.findOne({
                companyId,
                status: 'in_progress'
            });
        }

        if (!evacuation) {
            return res.status(404).json({ error: 'No active evacuation found' });
        }

        const now = new Date();

        // Get final counts
        const visitsCollection = db.collection('visits');
        const finalEvacuated = await visitsCollection.countDocuments({
            evacuationId: evacuation._id,
            evacuationStatus: 'evacuated'
        });

        const finalMissing = await visitsCollection.countDocuments({
            evacuationId: evacuation._id,
            evacuationStatus: 'on_site'
        });

        // End evacuation
        await evacuationsCollection.updateOne(
            { _id: evacuation._id },
            {
                $set: {
                    status: 'completed',
                    endedAt: now,
                    endedBy: req.userId || 'system',
                    endNotes: notes,
                    finalEvacuated,
                    finalMissing
                }
            }
        );

        // Clear evacuation status from visits
        await visitsCollection.updateMany(
            { evacuationId: evacuation._id },
            {
                $set: {
                    evacuationEnded: true,
                    evacuationEndedAt: now
                },
                $unset: {
                    evacuationStatus: ''
                }
            }
        );

        const durationSeconds = (now - evacuation.startedAt) / 1000;

        res.json({
            message: 'Evacuation ended successfully',
            evacuationId: evacuation._id.toString(),
            duration: {
                seconds: Math.round(durationSeconds),
                minutes: Math.round(durationSeconds / 60 * 10) / 10
            },
            finalCounts: {
                evacuated: finalEvacuated,
                missing: finalMissing,
                total: finalEvacuated + finalMissing
            },
            endedAt: now.toISOString()
        });

    } catch (error) {
        console.error('Error ending evacuation:', error);
        next(error);
    }
});

/**
 * GET /history
 * Get history of past evacuations
 */
router.get('/history', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;
        const limit = parseInt(req.query.limit || '20');
        const offset = parseInt(req.query.offset || '0');

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const evacuationsCollection = db.collection('evacuations');

        const evacuations = await evacuationsCollection.find({ companyId })
            .sort({ startedAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();

        const total = await evacuationsCollection.countDocuments({ companyId });

        res.json({
            evacuations: convertObjectIds(evacuations),
            total,
            limit,
            offset
        });

    } catch (error) {
        console.error('Error getting evacuation history:', error);
        next(error);
    }
});

module.exports = router;
