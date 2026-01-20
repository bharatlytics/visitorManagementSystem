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
            category: data.category || 'blacklist', // blacklist, watchlist, vip
            severity: data.severity || 'medium', // low, medium, high
            addedBy: data.addedBy || 'system',
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

        res.json({ entry: convertObjectIds(entry) });
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
        const allowedFields = ['name', 'phone', 'email', 'idType', 'idNumber', 'reason', 'category', 'severity', 'status', 'notes', 'expiresAt'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'expiresAt' && data[field]) {
                    updateFields[field] = new Date(data[field]);
                } else {
                    updateFields[field] = data[field];
                }
            }
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
 * DELETE /api/watchlist/:entry_id
 * Remove from watchlist
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

        res.json({ message: 'Removed from watchlist successfully' });
    } catch (error) {
        console.error('Error removing from watchlist:', error);
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
