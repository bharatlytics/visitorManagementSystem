/**
 * VMS Sync Pull API
 * 
 * Exposes endpoints for the Platform to pull data from VMS.
 * Platform controls when to pull - VMS just provides the data.
 * 
 * Endpoints:
 * - GET /api/sync/pull/employees/:id - Pull employee data
 * - GET /api/sync/pull/visitors/:id - Pull visitor data
 * - GET /api/sync/pull/health - Health check
 * 
 * Matching Python app/api/sync_pull.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');

const { getDb, getGridFSBucket } = require('../db');
const { isValidObjectId } = require('../utils/helpers');

// Platform secret for verifying sync tokens
const PLATFORM_SECRET = process.env.PLATFORM_SECRET || 'bharatlytics-platform-secret-2024';

/**
 * Verify that request comes from Platform for sync
 */
function verifyPlatformSyncRequest(req) {
    if (!req.headers['x-sync-request']) {
        return { valid: false, error: 'Missing X-Sync-Request header' };
    }

    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'Missing Authorization header' };
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const payload = jwt.verify(token, PLATFORM_SECRET, {
            algorithms: ['HS256'],
            audience: 'vms_app_v1'
        });

        if (payload.iss !== 'bharatlytics-platform') {
            return { valid: false, error: 'Invalid issuer' };
        }

        if (payload.type !== 'sync_pull') {
            return { valid: false, error: 'Invalid token type' };
        }

        return { valid: true, context: { companyId: payload.company_id } };
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return { valid: false, error: 'Token expired' };
        }
        return { valid: false, error: `Invalid token: ${err.message}` };
    }
}

/**
 * Get image from GridFS as base64
 */
async function getImageBase64(bucketName, imageId) {
    try {
        if (!imageId) return null;

        const bucket = getGridFSBucket(bucketName);
        const objId = isValidObjectId(imageId) ? new ObjectId(String(imageId)) : imageId;

        const chunks = [];
        const stream = bucket.openDownloadStream(objId);

        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (err) {
        console.error(`[SyncPull] Error reading image: ${err.message}`);
        return null;
    }
}

/**
 * GET /api/sync/pull/employees/:employee_id
 * Platform calls this to pull employee data for sync.
 * Returns full employee data including images as base64.
 */
router.get('/employees/:employee_id', async (req, res, next) => {
    try {
        // Verify platform request
        const verification = verifyPlatformSyncRequest(req);
        if (!verification.valid) {
            return res.status(401).json({ error: verification.error });
        }

        const { employee_id } = req.params;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID' });
        }

        const db = getDb();
        const employee = await db.collection('employees').findOne({ _id: new ObjectId(employee_id) });

        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Build response with images
        const images = employee.employeeImages || {};
        let photoBase64 = null;

        for (const position of ['front', 'center', 'left', 'right']) {
            if (images[position]) {
                photoBase64 = await getImageBase64('employeeImages', images[position]);
                if (photoBase64) break;
            }
        }

        const response = {
            id: String(employee._id),
            attributes: {
                name: employee.employeeName,
                email: employee.email || employee.employeeEmail,
                phone: employee.phone || employee.employeeMobile,
                employeeId: employee.employeeId,
                department: employee.department,
                designation: employee.designation || employee.employeeDesignation,
                photo: photoBase64
            },
            status: employee.status || 'active',
            blacklisted: employee.blacklisted || false,
            companyId: String(employee.companyId),
            hasPhoto: !!photoBase64,
            syncedFrom: 'vms_app_v1'
        };

        res.json(response);
    } catch (error) {
        console.error('Error in sync pull employee:', error);
        next(error);
    }
});

/**
 * GET /api/sync/pull/visitors/:visitor_id
 * Platform calls this to pull visitor data for sync.
 */
router.get('/visitors/:visitor_id', async (req, res, next) => {
    try {
        // Verify platform request
        const verification = verifyPlatformSyncRequest(req);
        if (!verification.valid) {
            return res.status(401).json({ error: verification.error });
        }

        const { visitor_id } = req.params;

        if (!isValidObjectId(visitor_id)) {
            return res.status(400).json({ error: 'Invalid visitor ID' });
        }

        const db = getDb();
        const visitor = await db.collection('visitors').findOne({ _id: new ObjectId(visitor_id) });

        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        // Build response with images
        const images = visitor.visitorImages || {};
        let photoBase64 = null;

        for (const position of ['center', 'front', 'left', 'right']) {
            if (images[position]) {
                photoBase64 = await getImageBase64('visitorImages', images[position]);
                if (photoBase64) break;
            }
        }

        const response = {
            id: String(visitor._id),
            attributes: {
                name: visitor.visitorName,
                email: visitor.email,
                phone: visitor.phone,
                organization: visitor.organization,
                visitorType: visitor.visitorType,
                photo: photoBase64
            },
            status: visitor.status || 'active',
            blacklisted: visitor.blacklisted || false,
            companyId: String(visitor.companyId),
            hasPhoto: !!photoBase64,
            syncedFrom: 'vms_app_v1'
        };

        res.json(response);
    } catch (error) {
        console.error('Error in sync pull visitor:', error);
        next(error);
    }
});

/**
 * GET /api/sync/pull/health
 * Health check for sync endpoints
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        app: 'vms_app_v1',
        endpoints: ['/employees/:id', '/visitors/:id']
    });
});

module.exports = router;
