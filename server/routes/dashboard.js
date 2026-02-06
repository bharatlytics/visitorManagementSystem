/**
 * Dashboard API
 * Statistics and metrics for VMS dashboard
 * Supports data residency - fetches from Platform or local VMS based on company settings
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { isValidObjectId } = require('../utils/helpers');
const { getDataProvider } = require('../services/data_provider');

/**
 * GET /api/dashboard/stats
 * Get dashboard statistics - residency-aware
 */
router.get('/stats', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        // Get platform token for residency-aware fetching
        let platformToken = req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Use DataProvider for residency-aware employee/visitor counts
        const dataProvider = getDataProvider(companyId, platformToken);

        // Get employees and visitors from appropriate source (Platform or local)
        const [employees, visitors] = await Promise.all([
            dataProvider.getEmployees(companyId),
            dataProvider.getVisitors(companyId)
        ]);

        const totalEmployees = employees.filter(e => e.status !== 'deleted').length;
        const totalVisitors = visitors.filter(v => v.status !== 'deleted').length;

        // Visits are always in local VMS DB
        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        // Get today's date range
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Parallel queries for visit stats (visits always in VMS DB)
        const [
            activeVisits,
            todayVisits,
            pendingApprovals,
            checkedInToday
        ] = await Promise.all([
            collections.visits().countDocuments({ ...companyQuery, status: 'checked_in' }),
            collections.visits().countDocuments({
                ...companyQuery,
                expectedArrival: { $gte: startOfDay, $lte: endOfDay }
            }),
            collections.visits().countDocuments({ ...companyQuery, status: 'pending_approval' }),
            collections.visits().countDocuments({
                ...companyQuery,
                status: { $in: ['checked_in', 'checked_out'] },
                actualArrival: { $gte: startOfDay }
            })
        ]);

        res.json({
            totalVisitors,
            totalEmployees,
            activeVisits,
            todayVisits,
            pendingApprovals,
            checkedInToday,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        next(error);
    }
});

/**
 * GET /api/dashboard/recent-visits
 * Get recent visits
 */
router.get('/recent-visits', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const limit = parseInt(req.query.limit) || 10;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const visits = await collections.visits()
            .find(companyQuery)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        // Convert ObjectIds
        const result = visits.map(visit => ({
            ...visit,
            _id: visit._id.toString(),
            visitorId: visit.visitorId?.toString(),
            companyId: visit.companyId?.toString(),
            hostEmployeeId: visit.hostEmployeeId?.toString()
        }));

        res.json({ visits: result });
    } catch (error) {
        console.error('Error fetching recent visits:', error);
        next(error);
    }
});

/**
 * GET /api/dashboard/visit-trends
 * Get visit trends over time
 */
router.get('/visit-trends', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const days = parseInt(req.query.days) || 7;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const trends = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        res.json({
            trends: trends.map(t => ({ date: t._id, count: t.count })),
            startDate: startDate.toISOString(),
            endDate: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching visit trends:', error);
        next(error);
    }
});

// Alias for /visit-trends (some frontends call /trends instead)
router.get('/trends', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const days = parseInt(req.query.days) || 7;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const trends = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        res.json({
            trends: trends.map(t => ({ date: t._id, count: t.count })),
            startDate: startDate.toISOString(),
            endDate: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching visit trends:', error);
        next(error);
    }
});

/**
 * GET /api/dashboard/active-visitors
 * Get currently checked-in visitors
 */
router.get('/active-visitors', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const activeVisits = await collections.visits()
            .find({ ...companyQuery, status: 'checked_in' })
            .toArray();

        // Get visitor details for each active visit
        const visitorIds = activeVisits.map(v => v.visitorId).filter(Boolean);
        const visitors = await collections.visitors()
            .find({ _id: { $in: visitorIds } })
            .toArray();

        const visitorMap = new Map(visitors.map(v => [v._id.toString(), v]));

        const result = activeVisits.map(visit => ({
            visitId: visit._id.toString(),
            visitorId: visit.visitorId?.toString(),
            visitorName: visit.visitorName || visitorMap.get(visit.visitorId?.toString())?.visitorName,
            hostEmployeeName: visit.hostEmployeeName,
            purpose: visit.purpose,
            checkInTime: visit.actualArrival,
            accessAreas: visit.accessAreas
        }));

        res.json({ activeVisitors: result, count: result.length });
    } catch (error) {
        console.error('Error fetching active visitors:', error);
        next(error);
    }
});

module.exports = router;
