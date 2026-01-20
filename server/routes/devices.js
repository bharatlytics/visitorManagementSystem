/**
 * Devices API
 * Device management for VMS
 * Matching Python app/api/devices.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId, validateRequiredFields } = require('../utils/helpers');

/**
 * GET /api/devices
 * List all devices for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const devices = await collections.devices().find(query).toArray();

        res.json({ devices: convertObjectIds(devices) });
    } catch (error) {
        console.error('Error listing devices:', error);
        next(error);
    }
});

/**
 * GET /api/devices/:device_id
 * Get single device by ID
 */
router.get('/:device_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;

        let device = null;

        if (isValidObjectId(device_id)) {
            device = await collections.devices().findOne({ _id: new ObjectId(device_id) });
        }

        if (!device) {
            device = await collections.devices().findOne({ deviceId: device_id });
        }

        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ device: convertObjectIds(device) });
    } catch (error) {
        console.error('Error getting device:', error);
        next(error);
    }
});

/**
 * POST /api/devices
 * Register a new device
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'deviceName']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        const deviceDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            deviceId: data.deviceId || `DEV-${Date.now()}`,
            deviceName: data.deviceName,
            deviceType: data.deviceType || 'kiosk',
            location: data.location || null,
            locationId: data.locationId ? new ObjectId(data.locationId) : null,
            status: 'active',
            lastSeen: new Date(),
            capabilities: data.capabilities || ['face_recognition', 'qr_scan'],
            config: data.config || {},
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        const result = await collections.devices().insertOne(deviceDoc);

        res.status(201).json({
            message: 'Device registered successfully',
            _id: result.insertedId.toString(),
            deviceId: deviceDoc.deviceId
        });
    } catch (error) {
        console.error('Error registering device:', error);
        next(error);
    }
});

/**
 * PUT /api/devices/:device_id
 * Update device
 */
router.put('/:device_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(device_id)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }

        const updateFields = {};
        const allowedFields = ['deviceName', 'deviceType', 'location', 'locationId', 'status', 'capabilities', 'config'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'locationId' && data[field]) {
                    updateFields[field] = new ObjectId(data[field]);
                } else {
                    updateFields[field] = data[field];
                }
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const result = await collections.devices().updateOne(
            { _id: new ObjectId(device_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device updated successfully' });
    } catch (error) {
        console.error('Error updating device:', error);
        next(error);
    }
});

/**
 * DELETE /api/devices/:device_id
 * Deactivate device
 */
router.delete('/:device_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;

        if (!isValidObjectId(device_id)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }

        const result = await collections.devices().updateOne(
            { _id: new ObjectId(device_id) },
            { $set: { status: 'inactive', lastUpdated: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device deactivated successfully' });
    } catch (error) {
        console.error('Error deactivating device:', error);
        next(error);
    }
});

/**
 * POST /api/devices/:device_id/heartbeat
 * Update device heartbeat
 */
router.post('/:device_id/heartbeat', async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const data = req.body || {};

        let query;
        if (isValidObjectId(device_id)) {
            query = { _id: new ObjectId(device_id) };
        } else {
            query = { deviceId: device_id };
        }

        const updateData = {
            lastSeen: new Date(),
            lastHeartbeat: new Date(),
            ...(data.status && { status: data.status }),
            ...(data.metrics && { metrics: data.metrics })
        };

        const result = await collections.devices().updateOne(query, { $set: updateData });

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Heartbeat recorded', timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Error recording heartbeat:', error);
        next(error);
    }
});

/**
 * GET /api/devices/list
 * List all devices - workaround for trailing slash issue
 */
router.get('/list', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const devices = await collections.devices().find(query).toArray();

        res.json({ devices: convertObjectIds(devices) });
    } catch (error) {
        console.error('Error listing devices:', error);
        next(error);
    }
});

/**
 * GET /api/devices/stats
 * Get device statistics for a company
 */
router.get('/stats', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const devices = await collections.devices().find(query).toArray();

        // Calculate stats
        const total = devices.length;
        const active = devices.filter(d => d.status === 'active').length;
        const inactive = devices.filter(d => d.status === 'inactive').length;
        const online = devices.filter(d => {
            if (!d.lastSeen) return false;
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            return new Date(d.lastSeen) > fiveMinutesAgo;
        }).length;
        const offline = total - online;

        // Group by type
        const byType = {};
        devices.forEach(d => {
            const type = d.deviceType || 'unknown';
            byType[type] = (byType[type] || 0) + 1;
        });

        res.json({
            stats: {
                total,
                active,
                inactive,
                online,
                offline,
                byType
            }
        });
    } catch (error) {
        console.error('Error fetching device stats:', error);
        next(error);
    }
});

/**
 * POST /api/devices/register
 * Register a new device (alias for POST /)
 */
router.post('/register', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'deviceName']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        const deviceDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            deviceId: data.deviceId || `DEV-${Date.now()}`,
            deviceName: data.deviceName,
            deviceType: data.deviceType || 'kiosk',
            location: data.location || null,
            locationId: data.locationId ? new ObjectId(data.locationId) : null,
            status: 'pending_activation',
            lastSeen: null,
            capabilities: data.capabilities || ['face_recognition', 'qr_scan'],
            config: data.config || {},
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        const result = await collections.devices().insertOne(deviceDoc);

        res.status(201).json({
            message: 'Device registered successfully',
            _id: result.insertedId.toString(),
            deviceId: deviceDoc.deviceId
        });
    } catch (error) {
        console.error('Error registering device:', error);
        next(error);
    }
});

/**
 * POST /api/devices/activation-codes
 * Generate activation codes for devices
 */
router.post('/activation-codes', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, count = 1, expiresInHours = 24 } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const codes = [];
        for (let i = 0; i < Math.min(count, 10); i++) {
            const code = {
                _id: new ObjectId(),
                companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                code: `ACT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
                status: 'unused',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
            };
            codes.push(code);
        }

        // Store activation codes
        try {
            await collections.activationCodes?.()?.insertMany(codes);
        } catch (e) {
            // Collection might not exist
        }

        res.json({
            message: `Generated ${codes.length} activation code(s)`,
            codes: codes.map(c => ({
                code: c.code,
                expiresAt: c.expiresAt
            }))
        });
    } catch (error) {
        console.error('Error generating activation codes:', error);
        next(error);
    }
});

/**
 * PATCH /api/devices/:device_id
 * Partial update device (frontend uses PATCH)
 */
router.patch('/:device_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(device_id)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }

        const updateFields = {};
        const allowedFields = ['deviceName', 'deviceType', 'location', 'locationId', 'status', 'capabilities', 'config'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'locationId' && data[field]) {
                    updateFields[field] = new ObjectId(data[field]);
                } else {
                    updateFields[field] = data[field];
                }
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const result = await collections.devices().updateOne(
            { _id: new ObjectId(device_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device updated successfully' });
    } catch (error) {
        console.error('Error updating device:', error);
        next(error);
    }
});

module.exports = router;

