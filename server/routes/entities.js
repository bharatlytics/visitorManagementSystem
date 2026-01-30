/**
 * Entities/Locations API
 * Matching Python app/api/entities.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId, validateRequiredFields } = require('../utils/helpers');
const { getDataProvider } = require('../services/data_provider');

/**
 * GET /api/locations
 * List all locations/entities for a company - respects data residency
 * Fetches from Platform when in platform mode (based on installation mappings)
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        // Use DataProvider for residency-aware fetching
        // This will check installation mappings and fetch from Platform if configured
        // Pass platformToken from session or header for Platform API calls
        let platformToken = req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        const dataProvider = getDataProvider(companyId, platformToken);
        const entities = await dataProvider.getEntities(companyId);

        console.log(`[entities.js] Fetched ${entities.length} entities for company ${companyId}`);

        // Return both 'locations' and 'entities' for frontend compatibility
        const result = convertObjectIds(entities);
        res.json({ locations: result, entities: result });
    } catch (error) {
        console.error('Error listing locations:', error);
        next(error);
    }
});


/**
 * GET /api/locations/:location_id
 * Get single location by ID
 */
router.get('/:location_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { location_id } = req.params;

        if (!isValidObjectId(location_id)) {
            return res.status(400).json({ error: 'Invalid location ID format' });
        }

        const location = await collections.locations().findOne({ _id: new ObjectId(location_id) });
        if (!location) {
            return res.status(404).json({ error: 'Location not found' });
        }

        res.json({ location: convertObjectIds(location) });
    } catch (error) {
        console.error('Error getting location:', error);
        next(error);
    }
});

/**
 * POST /api/locations
 * Create a new location
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'name']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        const locationDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            name: data.name,
            description: data.description || null,
            address: data.address || null,
            type: data.type || 'office',
            capacity: data.capacity || null,
            contactPerson: data.contactPerson || null,
            contactPhone: data.contactPhone || null,
            status: data.status || 'active',
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        const result = await collections.locations().insertOne(locationDoc);

        res.status(201).json({
            message: 'Location created successfully',
            _id: result.insertedId.toString(),
            location: convertObjectIds(locationDoc)
        });
    } catch (error) {
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Location with this name already exists' });
        }
        console.error('Error creating location:', error);
        next(error);
    }
});

/**
 * PUT /api/locations/:location_id
 * Update location
 */
router.put('/:location_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { location_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(location_id)) {
            return res.status(400).json({ error: 'Invalid location ID format' });
        }

        const updateFields = {};
        const allowedFields = ['name', 'description', 'address', 'type', 'capacity', 'contactPerson', 'contactPhone', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const result = await collections.locations().updateOne(
            { _id: new ObjectId(location_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Location not found' });
        }

        res.json({ message: 'Location updated successfully' });
    } catch (error) {
        console.error('Error updating location:', error);
        next(error);
    }
});

/**
 * DELETE /api/locations/:location_id
 * Delete location
 */
router.delete('/:location_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { location_id } = req.params;

        if (!isValidObjectId(location_id)) {
            return res.status(400).json({ error: 'Invalid location ID format' });
        }

        const result = await collections.locations().deleteOne({ _id: new ObjectId(location_id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Location not found' });
        }

        res.json({ message: 'Location deleted successfully' });
    } catch (error) {
        console.error('Error deleting location:', error);
        next(error);
    }
});

module.exports = router;
