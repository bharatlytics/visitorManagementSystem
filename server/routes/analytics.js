/**
 * Analytics API
 * Visitor analytics and metrics
 * Matching Python app/api/analytics.py + advanced_analytics.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/analytics/summary
 * Get summary analytics
 */
router.get('/summary', requireCompanyAccess, async (req, res, next) => {
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

        const [
            totalVisits,
            uniqueVisitors,
            avgDuration,
            peakHours
        ] = await Promise.all([
            // Total visits in date range
            collections.visits().countDocuments({
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate }
            }),

            // Unique visitors
            collections.visits().distinct('visitorId', {
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate }
            }).then(arr => arr.length),

            // Average visit duration
            collections.visits().aggregate([
                {
                    $match: {
                        ...companyMatch,
                        actualArrival: { $ne: null },
                        actualDeparture: { $ne: null },
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $project: {
                        duration: { $subtract: ['$actualDeparture', '$actualArrival'] }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgDuration: { $avg: '$duration' }
                    }
                }
            ]).toArray().then(result => result[0]?.avgDuration || 0),

            // Peak hours
            collections.visits().aggregate([
                {
                    $match: {
                        ...companyMatch,
                        actualArrival: { $ne: null },
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $project: {
                        hour: { $hour: '$actualArrival' }
                    }
                },
                {
                    $group: {
                        _id: '$hour',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]).toArray()
        ]);

        res.json({
            summary: {
                totalVisits,
                uniqueVisitors,
                avgDurationMinutes: Math.round(avgDuration / 60000),
                peakHours: peakHours.map(h => ({ hour: h._id, count: h.count }))
            },
            dateRange: { startDate, endDate }
        });
    } catch (error) {
        console.error('Error fetching analytics summary:', error);
        next(error);
    }
});

/**
 * GET /api/analytics/visits-by-day
 * Get visits grouped by day
 */
router.get('/visits-by-day', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const days = parseInt(req.query.days) || 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const results = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                    checkedIn: {
                        $sum: { $cond: [{ $in: ['$status', ['checked_in', 'checked_out']] }, 1, 0] }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        res.json({
            visitsByDay: results.map(r => ({
                date: r._id,
                total: r.count,
                checkedIn: r.checkedIn
            }))
        });
    } catch (error) {
        console.error('Error fetching visits by day:', error);
        next(error);
    }
});

/**
 * GET /api/analytics/visits-by-purpose
 * Get visits grouped by purpose
 */
router.get('/visits-by-purpose', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const days = parseInt(req.query.days) || 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const results = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: { $ifNull: ['$purpose', 'Not specified'] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();

        res.json({
            visitsByPurpose: results.map(r => ({
                purpose: r._id,
                count: r.count
            }))
        });
    } catch (error) {
        console.error('Error fetching visits by purpose:', error);
        next(error);
    }
});

/**
 * GET /api/analytics/top-hosts
 * Get top host employees
 */
router.get('/top-hosts', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const limit = parseInt(req.query.limit) || 10;
        const days = parseInt(req.query.days) || 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const results = await collections.visits().aggregate([
            {
                $match: {
                    ...companyMatch,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: '$hostEmployeeId',
                    hostName: { $first: '$hostEmployeeName' },
                    visitorCount: { $sum: 1 }
                }
            },
            { $sort: { visitorCount: -1 } },
            { $limit: limit }
        ]).toArray();

        res.json({
            topHosts: results.map(r => ({
                hostId: r._id?.toString(),
                hostName: r.hostName || 'Unknown',
                visitorCount: r.visitorCount
            }))
        });
    } catch (error) {
        console.error('Error fetching top hosts:', error);
        next(error);
    }
});

/**
 * GET /api/analytics/visitor-types
 * Get breakdown by visitor type
 */
router.get('/visitor-types', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const results = await collections.visitors().aggregate([
            { $match: companyMatch },
            {
                $group: {
                    _id: { $ifNull: ['$visitorType', 'guest'] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({
            visitorTypes: results.map(r => ({
                type: r._id,
                count: r.count
            }))
        });
    } catch (error) {
        console.error('Error fetching visitor types:', error);
        next(error);
    }
});

module.exports = router;
