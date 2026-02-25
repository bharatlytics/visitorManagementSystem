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

        const companyObjId = isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId;

        // Prevent duplicate device names within same company
        const companyQuery = isValidObjectId(data.companyId)
            ? { $or: [{ companyId: new ObjectId(data.companyId) }, { companyId: data.companyId }] }
            : { companyId: data.companyId };
        const existing = await collections.devices().findOne({
            ...companyQuery,
            deviceName: data.deviceName,
            status: { $ne: 'inactive' },
        });
        if (existing) {
            return res.status(409).json({ error: `A device named "${data.deviceName}" already exists.` });
        }

        // Validate IP address if provided
        if (data.ipAddress && !/^(\d{1,3}\.){3}\d{1,3}$/.test(data.ipAddress)) {
            return res.status(400).json({ error: 'Invalid IP address format (expected x.x.x.x)' });
        }

        const deviceDoc = {
            _id: new ObjectId(),
            companyId: companyObjId,
            deviceId: data.deviceId || `DEV-${Date.now()}`,
            deviceName: data.deviceName,
            deviceType: data.deviceType || 'kiosk',
            location: data.location || null,
            locationId: data.locationId ? new ObjectId(data.locationId) : null,
            ipAddress: data.ipAddress || null,
            firmwareVersion: data.firmwareVersion || null,
            osVersion: data.osVersion || null,
            zone: data.zone || null,
            notes: data.notes || null,
            status: 'active',
            locked: false,
            lastSeen: new Date(),
            capabilities: data.capabilities || ['face_recognition', 'qr_scan'],
            accessControl: data.accessControl || {
                allowedZones: [],
                allowedVisitorTypes: [],
                maxConcurrentVisitors: 50,
                operatingHours: null,
                requireApproval: false,
                allowWalkIns: true,
            },
            config: data.config || {},
            fcmToken: null,
            fcmTokenUpdatedAt: null,
            activatedAt: null,
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await collections.devices().insertOne(deviceDoc);

        res.status(201).json({
            message: 'Device registered successfully',
            device: convertObjectIds(deviceDoc),
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
        const allowedFields = [
            'deviceName', 'deviceType', 'location', 'locationId', 'status', 'capabilities', 'config',
            'accessControl', 'ipAddress', 'firmwareVersion', 'osVersion', 'zone', 'notes', 'locked'
        ];

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
 * PATCH /api/devices/:device_id/status
 * Quick status change (active / maintenance / inactive)
 */
router.patch('/:device_id/status', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const { status } = req.body;

        if (!isValidObjectId(device_id)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }

        const validStatuses = ['active', 'inactive', 'maintenance'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const result = await collections.devices().updateOne(
            { _id: new ObjectId(device_id) },
            { $set: { status, lastUpdated: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: `Device status changed to ${status}` });
    } catch (error) {
        console.error('Error changing device status:', error);
        next(error);
    }
});

/**
 * POST /api/devices/:device_id/send-notification
 * Send a push notification to a device via its FCM token.
 * Body: { title, body, data }
 */
router.post('/:device_id/send-notification', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const { title, body: notifBody, data } = req.body;

        if (!isValidObjectId(device_id)) {
            return res.status(400).json({ error: 'Invalid device ID format' });
        }

        const device = await collections.devices().findOne({ _id: new ObjectId(device_id) });
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        if (!device.fcmToken) {
            return res.status(400).json({ error: 'Device has no FCM token registered. Ensure the device app has called /api/device-api/fcm-token.' });
        }

        // Store the notification as a pending command (device picks up via heartbeat or push)
        const commandDoc = {
            _id: new ObjectId(),
            deviceId: device._id,
            command: 'notification',
            params: { title: title || 'VMS', body: notifBody || '', data: data || {} },
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
        };
        await collections.deviceCommands().insertOne(commandDoc);

        // FCM push would go here in production (firebase-admin SDK)
        // For now, we store the command and the device picks it up via heartbeat
        console.log(`[Devices] Notification queued for ${device.deviceName} (FCM: ${device.fcmToken.substring(0, 12)}...)`);

        res.json({
            message: 'Notification queued for device',
            commandId: commandDoc._id.toString(),
            deviceName: device.deviceName,
            fcmTokenRegistered: true,
        });
    } catch (error) {
        console.error('Error sending notification:', error);
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
        await collections.activationCodes().insertMany(codes);

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

// ─── QR Code & Activation ─────────────────────────────────────────

/**
 * POST /api/devices/qr-code
 * Generate a QR registration code for device onboarding.
 * Returns a JSON payload that encodes into a QR code:
 *   { activationUrl, code, companyId, expiresAt }
 * The device app scans this QR and calls /api/devices/activate.
 */
router.post('/qr-code', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, deviceName, deviceType, expiresInHours = 24 } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        // Generate a cryptographically-style activation code
        const code = `QR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

        const codeDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
            code,
            type: 'qr_registration',
            status: 'unused',
            deviceName: deviceName || null,
            deviceType: deviceType || 'kiosk',
            createdAt: new Date(),
            expiresAt
        };

        // Store in activationCodes collection
        await collections.activationCodes().insertOne(codeDoc);

        // Build the activation URL (frontend base + activation path)
        const baseUrl = process.env.APP_URL || req.protocol + '://' + req.get('host');
        const activationUrl = `${baseUrl}/api/devices/activate`;

        const qrPayload = {
            activationUrl,
            code,
            companyId,
            deviceName: deviceName || null,
            deviceType: deviceType || 'kiosk',
            expiresAt: expiresAt.toISOString()
        };

        res.json({
            message: 'QR registration code generated',
            qrPayload,
            qrString: JSON.stringify(qrPayload),
            code,
            expiresAt
        });
    } catch (error) {
        console.error('Error generating QR code:', error);
        next(error);
    }
});

/**
 * POST /api/devices/activate
 * Activate/register a device using an activation code.
 * Called by the device app after scanning the QR code.
 * Creates the device record and marks the code as used.
 */
router.post('/activate', async (req, res, next) => {
    try {
        const { code, deviceInfo } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Activation code is required' });
        }

        // Find the activation code
        let activationCode = null;
        try {
            activationCode = await collections.activationCodes().findOne({ code, status: 'unused' });
        } catch (e) {
            console.warn('Could not query activationCodes:', e.message);
        }

        if (!activationCode) {
            return res.status(404).json({ error: 'Invalid or expired activation code' });
        }

        // Check expiry
        if (new Date() > new Date(activationCode.expiresAt)) {
            return res.status(410).json({ error: 'Activation code has expired' });
        }

        // Create the device
        const deviceDoc = {
            _id: new ObjectId(),
            companyId: activationCode.companyId,
            deviceId: `DEV-${Date.now()}`,
            deviceName: activationCode.deviceName || deviceInfo?.deviceName || 'Unnamed Device',
            deviceType: activationCode.deviceType || deviceInfo?.deviceType || 'kiosk',
            location: deviceInfo?.location || null,
            status: 'active',
            activatedAt: new Date(),
            activatedWith: code,
            lastSeen: new Date(),
            lastHeartbeat: new Date(),
            capabilities: deviceInfo?.capabilities || ['face_recognition', 'qr_scan'],
            firmwareVersion: deviceInfo?.firmwareVersion || null,
            osVersion: deviceInfo?.osVersion || null,
            ipAddress: req.ip || null,
            config: deviceInfo?.config || {},
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await collections.devices().insertOne(deviceDoc);

        // Mark code as used
        try {
            await collections.activationCodes().updateOne(
                { _id: activationCode._id },
                { $set: { status: 'used', usedAt: new Date(), usedByDeviceId: deviceDoc._id } }
            );
        } catch (e) { /* ignore */ }

        res.status(201).json({
            message: 'Device activated successfully',
            device: convertObjectIds(deviceDoc)
        });
    } catch (error) {
        console.error('Error activating device:', error);
        next(error);
    }
});

// ─── Parameterized Routes (must come AFTER all static routes above) ─────────

/**
 * GET /api/devices/:device_id
 * Get single device by ID (supports both ObjectId and deviceId string)
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

// ─── Remote Control Commands ───────────────────────────────────────

/**
 * POST /api/devices/:device_id/command
 * Send a remote command to a device.
 * Supported commands: restart, lock, unlock, update, screenshot,
 *   set_config, maintenance_on, maintenance_off
 */
router.post('/:device_id/command', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const { command, params } = req.body;

        const validCommands = [
            'restart', 'lock', 'unlock', 'update', 'screenshot',
            'set_config', 'maintenance_on', 'maintenance_off',
            'clear_cache', 'sync_data'
        ];

        if (!command || !validCommands.includes(command)) {
            return res.status(400).json({
                error: `Invalid command. Valid commands: ${validCommands.join(', ')}`
            });
        }

        // Verify device exists
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

        // Create command record
        const commandDoc = {
            _id: new ObjectId(),
            deviceId: device._id,
            command,
            params: params || {},
            status: 'pending',
            sentBy: req.userId || 'system',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 min TTL
        };

        await collections.deviceCommands().insertOne(commandDoc);

        // If command affects device status, update immediately
        if (command === 'maintenance_on') {
            await collections.devices().updateOne(
                { _id: device._id },
                { $set: { status: 'maintenance', lastUpdated: new Date() } }
            );
        } else if (command === 'maintenance_off') {
            await collections.devices().updateOne(
                { _id: device._id },
                { $set: { status: 'active', lastUpdated: new Date() } }
            );
        } else if (command === 'lock') {
            await collections.devices().updateOne(
                { _id: device._id },
                { $set: { locked: true, lastUpdated: new Date() } }
            );
        } else if (command === 'unlock') {
            await collections.devices().updateOne(
                { _id: device._id },
                { $set: { locked: false, lastUpdated: new Date() } }
            );
        }

        res.json({
            message: `Command '${command}' sent to device`,
            commandId: commandDoc._id.toString(),
            status: 'pending'
        });
    } catch (error) {
        console.error('Error sending command:', error);
        next(error);
    }
});

/**
 * GET /api/devices/:device_id/commands
 * Get pending commands for a device (device polls this endpoint).
 * Returns commands with status=pending that haven't expired.
 */
router.get('/:device_id/commands', async (req, res, next) => {
    try {
        const { device_id } = req.params;

        // Find the device
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

        // Get pending commands
        let commands = [];
        try {
            commands = await collections.deviceCommands().find({
                deviceId: device._id,
                status: 'pending',
                expiresAt: { $gt: new Date() }
            }).sort({ createdAt: 1 }).toArray();
        } catch (e) { /* ignore */ }

        // Update device heartbeat since it's polling
        await collections.devices().updateOne(
            { _id: device._id },
            { $set: { lastSeen: new Date(), lastHeartbeat: new Date() } }
        );

        res.json({
            commands: commands.map(c => ({
                commandId: c._id.toString(),
                command: c.command,
                params: c.params || {},
                createdAt: c.createdAt,
                expiresAt: c.expiresAt
            }))
        });
    } catch (error) {
        console.error('Error fetching commands:', error);
        next(error);
    }
});

/**
 * POST /api/devices/:device_id/command/:command_id/ack
 * Acknowledge a command execution. Device calls this after executing a command.
 */
router.post('/:device_id/command/:command_id/ack', async (req, res, next) => {
    try {
        const { device_id, command_id } = req.params;
        const { success, result, error: execError } = req.body;

        if (!isValidObjectId(command_id)) {
            return res.status(400).json({ error: 'Invalid command ID' });
        }

        try {
            const updateResult = await collections.deviceCommands().updateOne(
                { _id: new ObjectId(command_id) },
                {
                    $set: {
                        status: success ? 'completed' : 'failed',
                        completedAt: new Date(),
                        result: result || null,
                        error: execError || null
                    }
                }
            );

            if (updateResult.matchedCount === 0) {
                return res.status(404).json({ error: 'Command not found' });
            }
        } catch (e) { /* ignore */ }

        res.json({ message: 'Command acknowledged' });
    } catch (error) {
        console.error('Error acknowledging command:', error);
        next(error);
    }
});

/**
 * GET /api/devices/:device_id/command-history
 * Get command history for a device (admin view).
 */
router.get('/:device_id/command-history', requireCompanyAccess, async (req, res, next) => {
    try {
        const { device_id } = req.params;
        const limit = parseInt(req.query.limit) || 50;

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

        let commands = [];
        try {
            commands = await collections.deviceCommands().find({ deviceId: device._id })
                .sort({ createdAt: -1 })
                .limit(limit)
                .toArray();
        } catch (e) { /* ignore */ }

        res.json({
            commands: commands.map(c => ({
                commandId: c._id.toString(),
                command: c.command,
                params: c.params || {},
                status: c.status,
                sentBy: c.sentBy,
                createdAt: c.createdAt,
                completedAt: c.completedAt || null,
                result: c.result || null,
                error: c.error || null
            }))
        });
    } catch (error) {
        console.error('Error fetching command history:', error);
        next(error);
    }
});

module.exports = router;
