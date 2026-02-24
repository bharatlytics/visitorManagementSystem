/**
 * Device-Facing API
 * Endpoints for kiosk/tablet devices to operate as VMS check-in stations.
 * All routes use requireDeviceAuth — device sends X-Device-Id header.
 * Mount at /api/device-api
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const multer = require('multer');

const { collections, getGridFSBucket } = require('../db');
const { requireDeviceAuth } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 }
});

// All routes require device auth
router.use(requireDeviceAuth);

// ─── Device Config ────────────────────────────────────────────────

/**
 * GET /api/device-api/config
 * Device fetches its configuration, company info, and available features.
 */
router.get('/config', async (req, res) => {
    try {
        const device = req.device;
        const companyId = req.companyId;

        // Get company info
        let company = null;
        try {
            if (isValidObjectId(companyId)) {
                company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
            }
            if (!company) {
                company = await collections.companies().findOne({ _id: companyId });
            }
        } catch (e) { /* ignore */ }

        // Get company settings
        let settings = null;
        try {
            const query = isValidObjectId(companyId)
                ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
                : { companyId };
            settings = await collections.settings().findOne(query);
        } catch (e) { /* ignore */ }

        res.json({
            device: {
                _id: device._id?.toString(),
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                location: device.location,
                status: device.status,
                capabilities: device.capabilities || [],
                config: device.config || {},
                locked: device.locked || false,
            },
            company: company ? {
                _id: company._id?.toString(),
                name: company.name,
                logo: company.logo || null,
            } : null,
            settings: settings ? {
                visitorTypes: settings.visitorTypes || [],
                idTypes: settings.idTypes || [],
                checkInFields: settings.checkInFields || [],
                requirePhoto: settings.requirePhoto || false,
                requireApproval: settings.requireApproval || false,
            } : null,
            serverTime: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[DeviceAPI] Error fetching config:', error);
        res.status(500).json({ error: 'Failed to fetch device config' });
    }
});

// ─── Today's Visits ───────────────────────────────────────────────

/**
 * GET /api/device-api/visits/today
 * Fetch today's scheduled and checked-in visits for the lobby screen.
 * Query: ?status=scheduled|checked_in|all (default: all)
 */
router.get('/visits/today', async (req, res) => {
    try {
        const companyId = req.companyId;
        const statusFilter = req.query.status;

        // Build date range for today (start of day to end of day)
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        // Filter by date
        query.expectedArrival = { $gte: startOfDay, $lte: endOfDay };

        // Filter by status if specified
        if (statusFilter && statusFilter !== 'all') {
            query.status = statusFilter;
        } else {
            query.status = { $in: ['scheduled', 'checked_in', 'approved'] };
        }

        const visits = await collections.visits()
            .find(query)
            .sort({ expectedArrival: 1 })
            .toArray();

        // Enrich with visitor names
        const visitorIds = visits.map(v => v.visitorId).filter(Boolean);
        const visitors = {};
        if (visitorIds.length > 0) {
            const vDocs = await collections.visitors().find({
                _id: { $in: visitorIds.map(id => isValidObjectId(id) ? new ObjectId(id) : id) }
            }).toArray();
            vDocs.forEach(v => { visitors[v._id.toString()] = v; });
        }

        const enriched = visits.map(visit => ({
            ...convertObjectIds(visit),
            visitorName: visitors[visit.visitorId?.toString()]?.visitorName || visit.visitorName || 'Unknown',
            visitorPhone: visitors[visit.visitorId?.toString()]?.phone || null,
            visitorOrganization: visitors[visit.visitorId?.toString()]?.organization || null,
        }));

        res.json({
            visits: enriched,
            total: enriched.length,
            date: now.toISOString().split('T')[0],
        });
    } catch (error) {
        console.error('[DeviceAPI] Error fetching today visits:', error);
        res.status(500).json({ error: 'Failed to fetch visits' });
    }
});

// ─── Check-in / Check-out ─────────────────────────────────────────

/**
 * POST /api/device-api/visits/:visitId/check-in
 * Kiosk performs check-in for a visitor.
 */
router.post('/visits/:visitId/check-in', async (req, res) => {
    try {
        const { visitId } = req.params;

        if (!isValidObjectId(visitId)) {
            return res.status(400).json({ error: 'Invalid visit ID' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status === 'checked_in') {
            return res.status(400).json({ error: 'Visitor already checked in' });
        }

        const now = new Date();
        await collections.visits().updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    status: 'checked_in',
                    checkInTime: now,
                    checkInDeviceId: req.device._id,
                    checkInDeviceName: req.device.deviceName,
                    lastUpdated: now,
                }
            }
        );

        res.json({
            status: 'success',
            message: 'Check-in successful',
            visitId,
            checkInTime: now.toISOString(),
            deviceName: req.device.deviceName,
        });
    } catch (error) {
        console.error('[DeviceAPI] Check-in error:', error);
        res.status(500).json({ error: 'Check-in failed' });
    }
});

/**
 * POST /api/device-api/visits/:visitId/check-out
 * Kiosk performs check-out for a visitor.
 */
router.post('/visits/:visitId/check-out', async (req, res) => {
    try {
        const { visitId } = req.params;

        if (!isValidObjectId(visitId)) {
            return res.status(400).json({ error: 'Invalid visit ID' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status !== 'checked_in') {
            return res.status(400).json({ error: 'Visitor is not checked in' });
        }

        const now = new Date();
        const checkInTime = visit.checkInTime ? new Date(visit.checkInTime) : now;
        const durationMs = now - checkInTime;
        const durationMinutes = Math.round(durationMs / 60000);

        await collections.visits().updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    status: 'checked_out',
                    checkOutTime: now,
                    checkOutDeviceId: req.device._id,
                    checkOutDeviceName: req.device.deviceName,
                    duration: durationMinutes,
                    lastUpdated: now,
                }
            }
        );

        res.json({
            status: 'success',
            message: 'Check-out successful',
            visitId,
            checkOutTime: now.toISOString(),
            duration: durationMinutes,
            deviceName: req.device.deviceName,
        });
    } catch (error) {
        console.error('[DeviceAPI] Check-out error:', error);
        res.status(500).json({ error: 'Check-out failed' });
    }
});

// ─── Walk-in Visitor Registration ─────────────────────────────────

/**
 * POST /api/device-api/visitors/register
 * Register a walk-in visitor from the kiosk.
 * Supports multipart/form-data for photo uploads.
 */
router.post('/visitors/register', upload.fields([
    { name: 'center', maxCount: 1 },
    { name: 'left', maxCount: 1 },
    { name: 'right', maxCount: 1 },
]), async (req, res) => {
    try {
        const data = req.body;
        const companyId = req.companyId;

        if (!data.visitorName || !data.phone) {
            return res.status(400).json({ error: 'visitorName and phone are required' });
        }

        // Check for existing visitor by phone
        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const existing = await collections.visitors().findOne({
            ...companyQuery,
            phone: data.phone,
            status: { $ne: 'deleted' },
        });

        if (existing) {
            return res.json({
                message: 'Visitor already registered',
                _id: existing._id.toString(),
                visitorName: existing.visitorName,
                existing: true,
            });
        }

        // Store face images in GridFS if provided
        const imageDict = {};
        const files = req.files || {};
        const { getGridFSBucket } = require('../server/db');

        for (const pose of ['left', 'center', 'right']) {
            if (files[pose] && files[pose][0]) {
                const file = files[pose][0];
                const bucket = getGridFSBucket('visitorImages');
                if (bucket) {
                    const uploadStream = bucket.openUploadStream(`visitor_${pose}_${Date.now()}.jpg`, {
                        contentType: file.mimetype,
                    });
                    uploadStream.end(file.buffer);
                    imageDict[pose] = uploadStream.id;
                }
            }
        }

        // Create visitor document
        const visitorDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
            visitorName: data.visitorName,
            phone: data.phone,
            email: data.email || null,
            organization: data.organization || null,
            visitorType: data.visitorType || 'general',
            purpose: data.purpose || null,
            status: 'active',
            blacklisted: false,
            registeredByDevice: req.device._id,
            registeredByDeviceName: req.device.deviceName,
            visitorImages: Object.keys(imageDict).length > 0 ? imageDict : undefined,
            createdAt: new Date(),
            lastUpdated: new Date(),
        };

        await collections.visitors().insertOne(visitorDoc);

        // Optionally auto-create a visit
        let visitId = null;
        if (data.hostEmployeeId || data.autoCheckIn) {
            const visitDoc = {
                _id: new ObjectId(),
                companyId: visitorDoc.companyId,
                visitorId: visitorDoc._id,
                visitorName: visitorDoc.visitorName,
                hostEmployeeId: data.hostEmployeeId || null,
                purpose: data.purpose || 'Walk-in',
                visitType: data.visitorType || 'general',
                status: data.autoCheckIn ? 'checked_in' : 'scheduled',
                expectedArrival: new Date(),
                checkInTime: data.autoCheckIn ? new Date() : null,
                checkInDeviceId: data.autoCheckIn ? req.device._id : null,
                checkInDeviceName: data.autoCheckIn ? req.device.deviceName : null,
                createdAt: new Date(),
                lastUpdated: new Date(),
            };
            await collections.visits().insertOne(visitDoc);
            visitId = visitDoc._id.toString();
        }

        res.status(201).json({
            message: 'Visitor registered successfully',
            _id: visitorDoc._id.toString(),
            visitorName: visitorDoc.visitorName,
            visitId,
            registeredAt: visitorDoc.createdAt.toISOString(),
            deviceName: req.device.deviceName,
        });
    } catch (error) {
        console.error('[DeviceAPI] Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ─── Search ───────────────────────────────────────────────────────

/**
 * GET /api/device-api/visitors/search?q=phone_or_name
 * Search visitors by phone number or name (for returning visitors).
 */
router.get('/visitors/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const companyId = req.companyId;
        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const visitors = await collections.visitors().find({
            ...companyQuery,
            status: { $nin: ['deleted', 'archived'] },
            $or: [
                { phone: { $regex: q, $options: 'i' } },
                { visitorName: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ]
        }).limit(20).toArray();

        res.json({
            visitors: convertObjectIds(visitors.map(v => ({
                _id: v._id,
                visitorName: v.visitorName,
                phone: v.phone,
                email: v.email,
                organization: v.organization,
                visitorType: v.visitorType,
                blacklisted: v.blacklisted,
            }))),
            total: visitors.length,
        });
    } catch (error) {
        console.error('[DeviceAPI] Visitor search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /api/device-api/employees/search?q=name_or_id
 * Search host employees by name or employee ID (for host selection at kiosk).
 */
router.get('/employees/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const companyId = req.companyId;
        const companyQuery = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const employees = await collections.employees().find({
            ...companyQuery,
            status: { $nin: ['deleted', 'archived'] },
            $or: [
                { employeeName: { $regex: q, $options: 'i' } },
                { name: { $regex: q, $options: 'i' } },
                { employeeId: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ]
        }).limit(20).toArray();

        res.json({
            employees: convertObjectIds(employees.map(e => ({
                _id: e._id,
                employeeName: e.employeeName || e.name,
                employeeId: e.employeeId,
                email: e.email,
                department: e.department,
                designation: e.designation,
            }))),
            total: employees.length,
        });
    } catch (error) {
        console.error('[DeviceAPI] Employee search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// ─── Heartbeat ────────────────────────────────────────────────────

/**
 * POST /api/device-api/heartbeat
 * Combined heartbeat + metrics upload.
 * Device status is also updated via requireDeviceAuth on every request.
 */
router.post('/heartbeat', async (req, res) => {
    try {
        const data = req.body || {};

        const updateFields = {
            lastSeen: new Date(),
            lastHeartbeat: new Date(),
        };

        if (data.metrics) updateFields.metrics = data.metrics;
        if (data.firmwareVersion) updateFields.firmwareVersion = data.firmwareVersion;
        if (data.osVersion) updateFields.osVersion = data.osVersion;
        if (data.ipAddress) updateFields.ipAddress = data.ipAddress;
        if (data.batteryLevel !== undefined) updateFields.batteryLevel = data.batteryLevel;

        await collections.devices().updateOne(
            { _id: req.device._id },
            { $set: updateFields }
        );

        // Check for pending commands
        let pendingCommands = [];
        try {
            pendingCommands = await collections.deviceCommands().find({
                deviceId: req.device._id,
                status: 'pending',
                expiresAt: { $gt: new Date() },
            }).sort({ createdAt: 1 }).toArray();
        } catch (e) { /* ignore */ }

        res.json({
            message: 'Heartbeat recorded',
            timestamp: new Date().toISOString(),
            pendingCommands: pendingCommands.map(c => ({
                commandId: c._id.toString(),
                command: c.command,
                params: c.params || {},
            })),
        });
    } catch (error) {
        console.error('[DeviceAPI] Heartbeat error:', error);
        res.status(500).json({ error: 'Heartbeat failed' });
    }
});

module.exports = router;
