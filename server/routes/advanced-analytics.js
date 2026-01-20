/**
 * Advanced Analytics API
 * Detailed analytics and reporting endpoints
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/advanced-analytics/dashboard
 * Main analytics dashboard data
 */
router.get('/dashboard', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        // Parallel queries for dashboard stats
        const [totalVisits, uniqueVisitors, avgDuration, peakHour] = await Promise.all([
            // Total visits in range
            collections.visits().countDocuments({
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate }
            }),
            // Unique visitors count (approximate)
            collections.visits().distinct('visitorId', {
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate }
            }).then(ids => ids.length),
            // Average duration
            collections.visits().aggregate([
                {
                    $match: {
                        ...companyMatch,
                        createdAt: { $gte: startDate, $lte: endDate },
                        checkOut: { $exists: true }
                    }
                },
                {
                    $project: {
                        duration: { $subtract: ['$checkOut', '$checkIn'] }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgDuration: { $avg: '$duration' }
                    }
                }
            ]).toArray().then(r => r[0]?.avgDuration ? Math.round(r[0].avgDuration / (1000 * 60)) : 0),
            // Peak hour calculation
            collections.visits().aggregate([
                {
                    $match: {
                        ...companyMatch,
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $project: {
                        hour: { $hour: '$createdAt' }
                    }
                },
                {
                    $group: {
                        _id: '$hour',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]).toArray().then(r => r[0] ? `${r[0]._id}:00` : 'N/A')
        ]);

        res.json({
            summary: {
                totalVisits,
                uniqueVisitors,
                avgDuration,
                peakHour
            }
        });
    } catch (error) {
        console.error('Error fetching analytics dashboard:', error);
        next(error);
    }
});

/**
 * GET /api/advanced-analytics/trends
 * Visit trends over time
 */
router.get('/trends', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        const interval = req.query.interval || 'day'; // day, week, month

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const trends = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: interval === 'month' ? '%Y-%m' : '%Y-%m-%d',
                            date: '$createdAt'
                        }
                    },
                    visits: { $sum: 1 },
                    uniqueVisitors: { $addToSet: '$visitorId' }
                }
            },
            {
                $project: {
                    date: '$_id',
                    visits: 1,
                    visitors: { $size: '$uniqueVisitors' },
                    _id: 0
                }
            },
            { $sort: { date: 1 } }
        ]).toArray();

        res.json({ trends });
    } catch (error) {
        console.error('Error fetching analytics trends:', error);
        next(error);
    }
});

/**
 * GET /api/advanced-analytics/peak-hours
 * Peak traffic hours analysis
 */
router.get('/peak-hours', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const peakHours = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $project: {
                    hour: { $hour: '$createdAt' },
                    dayOfWeek: { $dayOfWeek: '$createdAt' }
                }
            },
            {
                $group: {
                    _id: { hour: '$hour', day: '$dayOfWeek' },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    hour: '$_id.hour',
                    day: '$_id.day',
                    count: 1,
                    _id: 0
                }
            },
            { $sort: { day: 1, hour: 1 } }
        ]).toArray();

        res.json({ peakHours });
    } catch (error) {
        console.error('Error fetching peak hours:', error);
        next(error);
    }
});

/**
 * GET /api/advanced-analytics/visitor-types
 * Breakdown of visits by visitor type
 */
router.get('/visitor-types', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const visitorTypes = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $lookup: {
                    from: 'visitors',
                    localField: 'visitorId',
                    foreignField: '_id',
                    as: 'visitor'
                }
            },
            { $unwind: { path: '$visitor', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { $ifNull: ['$visitor.visitorType', 'Unknown'] },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    type: '$_id',
                    count: 1,
                    _id: 0
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({ visitorTypes });
    } catch (error) {
        console.error('Error fetching visitor types:', error);
        next(error);
    }
});

/**
 * GET /api/advanced-analytics/host-stats
 * Statistics by host
 */
router.get('/host-stats', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        const limit = parseInt(req.query.limit) || 10;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const hostStats = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$hostEmployeeId',
                    hostName: { $first: '$hostEmployeeName' },
                    visits: { $sum: 1 },
                    lastVisit: { $max: '$createdAt' }
                }
            },
            {
                $match: {
                    _id: { $ne: null }
                }
            },
            { $sort: { visits: -1 } },
            { $limit: limit },
            {
                $project: {
                    hostId: '$_id',
                    hostName: 1,
                    visits: 1,
                    lastVisit: 1,
                    _id: 0
                }
            }
        ]).toArray();

        res.json({ hostStats });
    } catch (error) {
        console.error('Error fetching host stats:', error);
        next(error);
    }
});

/**
 * GET /api/advanced-analytics/compliance
 * Compliance statistics
 */
router.get('/compliance', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const [overstayed, rejected, watchlistHits] = await Promise.all([
            // Overstayed visits (not checked out after 12 hours)
            collections.visits().countDocuments({
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate },
                checkOut: { $exists: false },
                createdAt: { $lt: new Date(Date.now() - 12 * 60 * 60 * 1000) }
            }),
            // Rejected visits
            collections.visits().countDocuments({
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate },
                status: 'rejected'
            }),
            // Watchlist hits (approvals that were auto-rejected or flagged)
            collections.approvals?.()?.countDocuments({
                ...companyMatch,
                requestedAt: { $gte: startDate, $lte: endDate },
                $or: [{ status: 'rejected' }, { flagged: true }]
            }) || 0
        ]);

        res.json({
            compliance: {
                overstayed,
                rejected,
                watchlistHits,
                complianceScore: Math.max(0, 100 - (overstayed * 2 + rejected + watchlistHits * 5)) // Arbitrary score calculation
            }
        });
    } catch (error) {
        console.error('Error fetching compliance stats:', error);
        next(error);
    }
});

module.exports = router;
