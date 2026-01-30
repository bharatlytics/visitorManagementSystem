/**
 * Visitors API - Full VMS functionality
 * Handles visitor registration, listing, updates, visits, and images
 * Matching Python app/api/visitors.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId, GridFSBucket } = require('mongodb');
const QRCode = require('qrcode');
const multer = require('multer');

const { collections, getDb, getGridFSBucket } = require('../db');
const { getDataProvider } = require('../services/data_provider');
const Config = require('../config');
const { requireAuth, requireCompanyAccess } = require('../middleware/auth');
const {
    validateRequiredFields,
    validateEmailFormat,
    validatePhoneFormat,
    getCurrentUTC,
    convertObjectIds,
    parseObjectId,
    isValidObjectId,
    rewriteEmbeddingUrls
} = require('../utils/helpers');

// Multer for file uploads (memory storage for GridFS)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sync visitor to platform actors collection with images
 */
async function syncVisitorToPlatform(visitorData, companyId, includeImages = true, platformToken) {
    try {
        // Build attributes
        const attributes = {
            name: visitorData.visitorName,
            visitorName: visitorData.visitorName,
            email: visitorData.email,
            phone: visitorData.phone,
            organization: visitorData.organization,
            visitorType: visitorData.visitorType || 'guest',
        };

        // Include image as base64 if available
        let photoData = null;
        if (includeImages && visitorData.visitorImages) {
            const images = visitorData.visitorImages;
            for (const position of ['center', 'front', 'left', 'right']) {
                if (images[position]) {
                    try {
                        const bucket = getGridFSBucket('visitorImages');
                        const imageId = new ObjectId(images[position]);
                        const chunks = [];
                        const downloadStream = bucket.openDownloadStream(imageId);

                        for await (const chunk of downloadStream) {
                            chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        photoData = buffer.toString('base64');
                        console.log(`[sync_visitor] Included ${position} image (${buffer.length} bytes)`);
                        break;
                    } catch (e) {
                        console.log(`[sync_visitor] Error reading ${position} image: ${e.message}`);
                        continue;
                    }
                }
            }
        }

        if (photoData) {
            attributes.photo = `data:image/jpeg;base64,${photoData}`;
        }

        const actorData = {
            companyId: String(companyId),
            actorType: 'visitor',
            attributes,
            sourceAppId: 'vms_app_v1',
            sourceActorId: String(visitorData._id),
            status: 'active',
            metadata: {
                hasPhoto: Boolean(photoData),
                sourceApp: 'vms_app_v1'
            }
        };

        if (!platformToken) {
            console.log('[sync_visitor] No platform token');
            return { success: false, error: 'No platform token' };
        }

        const response = await fetch(`${Config.PLATFORM_API_URL}/bharatlytics/v1/actors`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${platformToken}`,
                'Content-Type': 'application/json',
                'X-App-Id': 'vms_app_v1',
                'X-Source-App': 'vms_app_v1'
            },
            body: JSON.stringify(actorData)
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`[sync_visitor] Synced: ${visitorData.visitorName} (photo: ${Boolean(photoData)})`);
            return {
                success: true,
                actorId: result._id || result.actorId,
                hasPhoto: Boolean(photoData)
            };
        } else {
            const text = await response.text();
            console.log(`[sync_visitor] Failed: ${response.status}`);
            return { success: false, error: text.substring(0, 200) };
        }
    } catch (e) {
        console.log(`[sync_visitor] Error: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Check if visitor has overlapping visit
 */
async function hasOverlappingVisit(visitorId, newStart, newEnd) {
    const overlap = await collections.visits().findOne({
        visitorId: new ObjectId(visitorId),
        status: { $in: ['scheduled', 'checked_in'] },
        $or: [
            { expectedArrival: { $lt: newEnd }, expectedDeparture: { $gt: newStart } }
        ]
    });
    return overlap !== null;
}

/**
 * Build visitor document
 */
function buildVisitorDoc(data, imageDict, embeddingsDict, documentDict) {
    const companyId = isValidObjectId(data.companyId)
        ? new ObjectId(data.companyId)
        : data.companyId;

    return {
        _id: new ObjectId(),
        companyId,
        visitorName: data.visitorName,
        phone: data.phone,
        email: data.email || null,
        organization: data.organization || null,
        visitorType: data.visitorType || 'guest',
        idType: data.idType || null,
        idNumber: data.idNumber || null,
        hostEmployeeId: isValidObjectId(data.hostEmployeeId)
            ? new ObjectId(data.hostEmployeeId)
            : data.hostEmployeeId,
        purpose: data.purpose || null,
        status: data.status || 'active',
        blacklisted: data.blacklisted === 'true' || data.blacklisted === true || false,
        blacklistReason: data.blacklistReason || null,
        visitorImages: imageDict,
        visitorEmbeddings: embeddingsDict,
        documents: documentDict,
        visits: [],
        createdAt: new Date(),
        lastUpdated: new Date()
    };
}

/**
 * Build visit document
 */
function buildVisitDoc(visitorId, companyId, hostEmployeeId, purpose, expectedArrival, expectedDeparture, options = {}) {
    return {
        _id: new ObjectId(),
        visitorId: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId),
        companyId: companyId instanceof ObjectId ? companyId : new ObjectId(companyId),
        hostEmployeeId: hostEmployeeId instanceof ObjectId ? hostEmployeeId : new ObjectId(hostEmployeeId),
        purpose: purpose || '',
        expectedArrival: expectedArrival instanceof Date ? expectedArrival : new Date(expectedArrival),
        expectedDeparture: expectedDeparture instanceof Date ? expectedDeparture : new Date(expectedDeparture),
        actualArrival: null,
        actualDeparture: null,
        status: options.approved ? 'scheduled' : 'pending_approval',
        hostEmployeeName: options.hostEmployeeName || null,
        hostEmployeeCode: options.hostEmployeeCode || null,
        visitorName: options.visitorName || null,
        visitorMobile: options.visitorMobile || null,
        vehicleNumber: options.vehicleNumber || null,
        numberOfPersons: options.numberOfPersons || 1,
        belongings: options.belongings || [],
        createdAt: new Date(),
        lastUpdated: new Date()
    };
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/visitors
 * List all visitors for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        // Query with both string and ObjectId to handle inconsistent data
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        console.log(`[Visitors] Querying with:`, query);
        const visitors = await collections.visitors().find(query).toArray();
        console.log(`[Visitors] Found ${visitors.length} visitors`);

        // Rewrite download URLs to VMS proxy URLs (using shared utility)
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        // Pass Config.PLATFORM_API_URL to generate direct links
        rewriteEmbeddingUrls(visitors, baseUrl, 'visitors', Config.PLATFORM_API_URL);

        // Convert ObjectIds to strings
        const result = convertObjectIds(visitors);

        res.json({ visitors: result });
    } catch (error) {
        console.error('Error listing visitors:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/list
 * Alias for GET /api/visitors - avoids trailing slash redirect issues
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

        const visitors = await collections.visitors().find(query).toArray();

        // Rewrite download URLs to VMS proxy URLs (using shared utility)
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        // Pass Config.PLATFORM_API_URL to generate direct links
        rewriteEmbeddingUrls(visitors, baseUrl, 'visitors', Config.PLATFORM_API_URL);

        res.json({ visitors: convertObjectIds(visitors) });
    } catch (error) {
        console.error('Error listing visitors:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/visits
 * List all visits for a company
 * NOTE: This must come BEFORE /:visitor_id to avoid "visits" being matched as a visitor_id
 */
router.get('/visits', requireCompanyAccess, async (req, res, next) => {
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

        const visitorId = req.query.visitorId;
        if (visitorId && isValidObjectId(visitorId)) {
            query.visitorId = new ObjectId(visitorId);
        }

        const visits = await collections.visits()
            .find(query)
            .sort({ expectedArrival: -1 })
            .toArray();

        res.json({ visits: convertObjectIds(visits) });
    } catch (error) {
        console.error('Error listing visits:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/:id
 * Get a single visitor by ID
 */
router.get('/:visitor_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitor_id } = req.params;

        if (!isValidObjectId(visitor_id)) {
            return res.status(400).json({ error: 'Invalid visitor ID format' });
        }

        const visitor = await collections.visitors().findOne({ _id: new ObjectId(visitor_id) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        res.json({ visitor: convertObjectIds(visitor) });
    } catch (error) {
        console.error('Error getting visitor:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/images/:image_id
 * Serve a visitor image from GridFS
 */
router.get('/images/:image_id', async (req, res, next) => {
    try {
        const { image_id } = req.params;

        if (!isValidObjectId(image_id)) {
            return res.status(400).json({ error: 'Invalid image ID format' });
        }

        const bucket = getGridFSBucket('visitorImages');
        const downloadStream = bucket.openDownloadStream(new ObjectId(image_id));

        res.set('Content-Type', 'image/jpeg');
        res.set('Content-Disposition', `inline; filename=${image_id}.jpg`);

        downloadStream.pipe(res);

        downloadStream.on('error', () => {
            res.status(404).json({ error: 'Image not found' });
        });
    } catch (error) {
        console.error('Error serving visitor image:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/visits/qr/:visit_id
 * Generate and serve QR code for a visit
 */
router.get('/visits/qr/:visit_id', async (req, res, next) => {
    try {
        const { visit_id } = req.params;

        const qrBuffer = await QRCode.toBuffer(visit_id, {
            type: 'png',
            width: 300,
            margin: 2
        });

        res.set('Content-Type', 'image/png');
        res.set('Content-Disposition', `inline; filename=visit_${visit_id}.png`);
        res.send(qrBuffer);
    } catch (error) {
        console.error('Error generating QR code:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/register
 * Register a new visitor
 */
const registerFields = upload.fields([
    { name: 'left', maxCount: 1 },
    { name: 'right', maxCount: 1 },
    { name: 'center', maxCount: 1 },
    { name: 'front', maxCount: 1 },
    { name: 'pan_card', maxCount: 1 },
    { name: 'aadhar_card', maxCount: 1 },
    { name: 'driving_license', maxCount: 1 },
    { name: 'passport', maxCount: 1 },
    { name: 'embedding', maxCount: 1 }
]);

router.post('/register', requireCompanyAccess, registerFields, async (req, res, next) => {
    try {
        const data = req.body;

        // Validate required fields
        const requiredFields = ['companyId', 'visitorName', 'phone', 'hostEmployeeId'];
        const validation = validateRequiredFields(data, requiredFields);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email/phone
        if (data.email && !validateEmailFormat(data.email)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }
        if (!validatePhoneFormat(data.phone)) {
            return res.status(400).json({ error: 'Invalid phone number format.' });
        }

        // Check for existing visitor with same phone
        const companyId = data.companyId;
        const existingQuery = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId), phone: data.phone }
            : { companyId, phone: data.phone };

        const existingVisitor = await collections.visitors().findOne(existingQuery);
        if (existingVisitor) {
            return res.json({
                message: 'Visitor already registered with this phone number',
                _id: existingVisitor._id.toString(),
                visitorId: existingVisitor._id.toString(),
                visitorName: existingVisitor.visitorName,
                existing: true
            });
        }

        // Verify host employee exists
        const hostId = data.hostEmployeeId;
        let hostEmployee = null;

        // Use DataProvider to fetch employee (handles residency automatically)
        const residencyCheckToken = req.headers['x-platform-token'] || req.session?.platformToken;

        // DataProvider handles the import at top level now
        const dataProvider = getDataProvider(companyId, residencyCheckToken);

        try {
            hostEmployee = await dataProvider.getEmployeeById(hostId);
        } catch (e) {
            console.log(`[register_visitor] Error fetching host employee: ${e.message}`);
        }

        if (!hostEmployee) {
            return res.status(400).json({ error: 'Host employee not found or not active.' });
        }

        // Check status (handle both local and platform formats)
        // Local: status field
        // Platform: attributes.status or status field
        const status = hostEmployee.status || (hostEmployee.attributes && hostEmployee.attributes.status) || 'active';
        const isBlacklisted = hostEmployee.blacklisted === true || hostEmployee.blacklisted === 'true';

        if (status !== 'active' || isBlacklisted) {
            return res.status(400).json({ error: 'Host employee not found or not active.' });
        }

        // Process face images
        const imageDict = {};
        const hasImages = false;
        const facePositions = ['left', 'right', 'center', 'front'];

        for (const position of facePositions) {
            if (req.files && req.files[position]) {
                const file = req.files[position][0];
                const bucket = getGridFSBucket('visitorImages');

                const uploadStream = bucket.openUploadStream(`${companyId}_${position}_face.jpg`, {
                    metadata: {
                        companyId,
                        type: `face_image_${position}`,
                        timestamp: new Date()
                    }
                });

                uploadStream.write(file.buffer);
                uploadStream.end();

                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', resolve);
                    uploadStream.on('error', reject);
                });

                imageDict[position] = uploadStream.id;
            }
        }

        // Handle base64 images from webcam
        const base64Mapping = { faceCenter: 'center', faceLeft: 'left', faceRight: 'right' };
        for (const [formKey, position] of Object.entries(base64Mapping)) {
            if (data[formKey]) {
                let base64Data = data[formKey];
                if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                }
                const imageBuffer = Buffer.from(base64Data, 'base64');

                const bucket = getGridFSBucket('visitorImages');
                const uploadStream = bucket.openUploadStream(`${companyId}_${position}_face.jpg`, {
                    metadata: {
                        companyId,
                        type: `face_image_${position}`,
                        source: 'webcam',
                        timestamp: new Date()
                    }
                });

                uploadStream.write(imageBuffer);
                uploadStream.end();

                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', resolve);
                    uploadStream.on('error', reject);
                });

                imageDict[position] = uploadStream.id;
            }
        }

        // Process ID documents
        const documentDict = {};
        const docTypes = ['pan_card', 'aadhar_card', 'driving_license', 'passport'];
        for (const docType of docTypes) {
            if (req.files && req.files[docType]) {
                const file = req.files[docType][0];
                const bucket = getGridFSBucket('visitorImages');

                const uploadStream = bucket.openUploadStream(`${companyId}_${docType}.jpg`, {
                    metadata: {
                        companyId,
                        type: `${docType}_image`,
                        timestamp: new Date()
                    }
                });

                uploadStream.write(file.buffer);
                uploadStream.end();

                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', resolve);
                    uploadStream.on('error', reject);
                });

                documentDict[docType] = uploadStream.id;
            }
        }

        // Build visitor document
        const visitorDoc = buildVisitorDoc(data, imageDict, {}, documentDict);

        // Insert visitor
        const result = await collections.visitors().insertOne(visitorDoc);
        const visitorId = result.insertedId;

        // Queue embedding job if images exist
        const embeddingsDict = {};
        if (Object.keys(imageDict).length > 0) {
            embeddingsDict.buffalo_l = {
                status: 'queued',
                queuedAt: new Date()
            };

            await collections.embeddingJobs().insertOne({
                companyId: new ObjectId(companyId),
                visitorId,
                model: 'buffalo_l',
                status: 'queued',
                createdAt: new Date(),
                params: {}
            });

            await collections.visitors().updateOne(
                { _id: visitorId },
                { $set: { visitorEmbeddings: embeddingsDict } }
            );
        }

        // Sync to Platform (if connected)
        let platformSync = { status: 'skipped', message: 'No platform token' };
        const platformToken = req.headers['x-platform-token'] || req.session?.platformToken;

        if (platformToken) {
            console.log(`[register_visitor] Syncing visitor ${visitorId} to platform...`);
            // We use the visitorDoc but need to ensure _id is set (it is)
            const syncResult = await syncVisitorToPlatform(visitorDoc, companyId, true, platformToken);

            if (syncResult.success) {
                platformSync = { status: 'success', actorId: syncResult.actorId };
            } else {
                platformSync = { status: 'failed', error: syncResult.error };
                console.error(`[register_visitor] Platform sync failed: ${syncResult.error}`);
            }
        }

        res.status(201).json({
            message: 'Visitor registration successful',
            _id: visitorId.toString(),
            embeddingStatus: Object.fromEntries(
                Object.entries(embeddingsDict).map(([k, v]) => [k, v.status || 'unknown'])
            ),
            hasBiometric: Object.keys(imageDict).length > 0,
            dataResidency: 'app',
            federatedAccess: '/api/query/visitors',
            platformSync
        });
    } catch (error) {
        console.error('Error in register_visitor:', error);
        next(error);
    }
});

/**
 * PATCH /api/visitors/update
 * Update visitor details
 */
router.patch('/update', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;
        const visitorId = data.visitorId;

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        if (!isValidObjectId(visitorId)) {
            return res.status(400).json({ error: 'Invalid visitor ID format' });
        }

        const visitor = await collections.visitors().findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        const updateFields = {};
        const allowedFields = ['visitorName', 'email', 'phone', 'organization', 'idType', 'idNumber', 'purpose', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        // Validate email/phone if provided
        if (updateFields.email && !validateEmailFormat(updateFields.email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (updateFields.phone && !validatePhoneFormat(updateFields.phone)) {
            return res.status(400).json({ error: 'Invalid phone format' });
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        await collections.visitors().updateOne(
            { _id: new ObjectId(visitorId) },
            { $set: updateFields }
        );

        res.json({ message: 'Visitor updated successfully' });
    } catch (error) {
        console.error('Error updating visitor:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/blacklist
 * Blacklist a visitor
 */
router.post('/blacklist', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId, reason = 'No reason provided' } = req.body;

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        const result = await collections.visitors().updateOne(
            { _id: new ObjectId(visitorId) },
            {
                $set: {
                    blacklisted: true,
                    blacklistReason: reason,
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        res.json({ message: 'Visitor blacklisted successfully' });
    } catch (error) {
        console.error('Error blacklisting visitor:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/unblacklist
 * Remove visitor from blacklist
 */
router.post('/unblacklist', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId } = req.body;

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        const result = await collections.visitors().updateOne(
            { _id: new ObjectId(visitorId) },
            {
                $set: {
                    blacklisted: false,
                    blacklistReason: '',
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        res.json({ message: 'Visitor unblacklisted successfully' });
    } catch (error) {
        console.error('Error unblacklisting visitor:', error);
        next(error);
    }
});

/**
 * DELETE /api/visitors/delete
 * Soft delete a visitor
 */
router.delete('/delete', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId } = req.body;

        if (!visitorId) {
            return res.status(400).json({ error: 'Visitor ID is required' });
        }

        const visitor = await collections.visitors().findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        // Soft delete
        await collections.visitors().updateOne(
            { _id: new ObjectId(visitorId) },
            {
                $set: {
                    status: 'deleted',
                    deletedAt: new Date(),
                    lastUpdated: new Date()
                }
            }
        );

        // Cancel scheduled visits
        await collections.visits().updateMany(
            { visitorId: new ObjectId(visitorId), status: 'scheduled' },
            {
                $set: {
                    status: 'cancelled',
                    cancelReason: 'Visitor deleted',
                    lastUpdated: new Date()
                }
            }
        );

        res.json({ message: 'Visitor deleted successfully' });
    } catch (error) {
        console.error('Error deleting visitor:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/:visitorId/schedule-visit
 * Schedule a visit for a visitor
 */
router.post('/:visitorId/schedule-visit', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitorId } = req.params;
        const data = req.body;

        // Validate required fields
        const requiredFields = ['companyId', 'hostEmployeeId', 'expectedArrival'];
        const validation = validateRequiredFields(data, requiredFields);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Parse dates
        const arrival = new Date(data.expectedArrival);
        const departure = new Date(data.expectedDeparture || data.expectedArrival);

        // Check for overlapping visit
        if (await hasOverlappingVisit(visitorId, arrival, departure)) {
            return res.status(409).json({ error: 'Visitor already has an overlapping visit.' });
        }

        // Fetch visitor
        const visitor = await collections.visitors().findOne({ _id: new ObjectId(visitorId) });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found.' });
        }

        if (visitor.blacklisted) {
            return res.status(403).json({
                error: `Visitor is blacklisted. Reason: ${visitor.blacklistReason || 'No reason provided'}`
            });
        }

        // Fetch host employee
        const hostId = data.hostEmployeeId;
        let hostEmployee = null;

        if (isValidObjectId(hostId)) {
            hostEmployee = await collections.employees().findOne({ _id: new ObjectId(hostId) });
        }
        if (!hostEmployee) {
            hostEmployee = await collections.employees().findOne({ employeeId: hostId });
        }
        if (!hostEmployee) {
            return res.status(404).json({ error: 'Host employee not found.' });
        }

        // Build visit document
        const visitDoc = buildVisitDoc(
            visitorId,
            data.companyId,
            hostEmployee._id,
            data.purpose || '',
            arrival,
            departure,
            {
                approved: data.approved || true,
                hostEmployeeName: hostEmployee.employeeName,
                hostEmployeeCode: hostEmployee.employeeId,
                visitorName: visitor.visitorName,
                visitorMobile: visitor.phone,
                vehicleNumber: data.vehicleNumber,
                numberOfPersons: data.numberOfPersons || 1,
                belongings: data.belongings || []
            }
        );

        // Add extra fields
        visitDoc.visitType = data.visitType || 'single';
        visitDoc.accessAreas = (data.accessAreas || []).filter(id => isValidObjectId(id)).map(id => new ObjectId(id));
        visitDoc.assets = data.assets || {};
        visitDoc.facilities = data.facilities || {};
        visitDoc.vehicle = data.vehicle || {};
        visitDoc.compliance = data.compliance || {};
        visitDoc.notes = data.notes || '';

        const result = await collections.visits().insertOne(visitDoc);
        const visitId = result.insertedId;

        // Update visitor's visits list
        await collections.visitors().updateOne(
            { _id: new ObjectId(visitorId) },
            { $push: { visits: visitId.toString() } }
        );

        // Fetch and return the visit
        const visit = await collections.visits().findOne({ _id: visitId });
        const visitResponse = convertObjectIds(visit);
        visitResponse.qrCode = visitResponse._id;
        visitResponse.qrCodeUrl = `/api/visitors/visits/qr/${visitResponse._id}`;

        res.status(201).json({
            message: 'Visit scheduled successfully',
            visit: visitResponse
        });
    } catch (error) {
        console.error('Error in schedule_visit:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/visits/:visitId/check-in
 * Check in a visitor
 */
router.post('/visits/:visitId/check-in', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitId } = req.params;
        const data = req.body;

        if (!data.checkInMethod) {
            return res.status(400).json({ error: 'Check-in method is required.' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found.' });
        }

        if (visit.status !== 'scheduled') {
            return res.status(400).json({ error: 'Visit is not in scheduled state.' });
        }

        await collections.visits().updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    status: 'checked_in',
                    checkInMethod: data.checkInMethod,
                    actualArrival: new Date(),
                    lastUpdated: new Date()
                }
            }
        );

        res.json({
            message: 'Check-in successful',
            visitId
        });
    } catch (error) {
        console.error('Error in check_in:', error);
        next(error);
    }
});

/**
 * POST /api/visitors/visits/:visitId/check-out
 * Check out a visitor
 */
router.post('/visits/:visitId/check-out', requireCompanyAccess, async (req, res, next) => {
    try {
        const { visitId } = req.params;

        const visit = await collections.visits().findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found.' });
        }

        if (visit.status !== 'checked_in') {
            return res.status(400).json({ error: 'Visit is not checked in.' });
        }

        await collections.visits().updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    status: 'checked_out',
                    actualDeparture: new Date(),
                    lastUpdated: new Date()
                }
            }
        );

        res.json({
            message: 'Check-out successful',
            visitId
        });
    } catch (error) {
        console.error('Error in check_out:', error);
        next(error);
    }
});

/**
 * GET /api/visitors/embeddings/:embedding_id
 * Download visitor embedding file.
 * Proxies to Platform API when not found locally (matching Python implementation).
 */
router.get('/embeddings/:embedding_id', async (req, res, next) => {
    try {
        const { embedding_id } = req.params;

        console.log(`[serve_visitor_embedding] embedding_id=${embedding_id}`);

        // First try local GridFS (for app mode embeddings)
        if (isValidObjectId(embedding_id)) {
            try {
                const bucket = getGridFSBucket('visitorEmbeddings');
                const files = await bucket.find({ _id: new ObjectId(embedding_id) }).toArray();

                if (files && files.length > 0) {
                    console.log(`[serve_visitor_embedding] Found in local GridFS: ${files[0].filename}`);
                    const downloadStream = bucket.openDownloadStream(new ObjectId(embedding_id));

                    res.set('Content-Type', 'application/octet-stream');
                    res.set('Content-Disposition', `attachment; filename=${embedding_id}.npy`);
                    downloadStream.pipe(res);
                    return;
                } else {
                    console.log(`[serve_visitor_embedding] Not found in local GridFS, checking platform...`);
                }
            } catch (localError) {
                console.log(`[serve_visitor_embedding] Error checking local GridFS: ${localError.message}`);
            }
        }

        // Proxy to Platform API (for platform mode embeddings)
        const axios = require('axios');
        const jwt = require('jsonwebtoken');

        const companyId = req.query.companyId || '6827296ab6e06b08639107c4';
        const platformSecret = Config.PLATFORM_JWT_SECRET || Config.JWT_SECRET;

        const payload = {
            sub: 'vms_app_v1',
            companyId,
            iss: 'vms',
            exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
        };
        const platformToken = jwt.sign(payload, platformSecret, { algorithm: 'HS256' });

        const platformUrl = `${Config.PLATFORM_API_URL}/bharatlytics/v1/actors/embeddings/${embedding_id}`;
        console.log(`[serve_visitor_embedding] Proxying to platform: ${platformUrl}`);

        const response = await axios.get(platformUrl, {
            headers: { 'Authorization': `Bearer ${platformToken}` },
            responseType: 'stream',
            timeout: 30000
        });

        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', response.headers['content-disposition'] || `attachment; filename=${embedding_id}.npy`);
        response.data.pipe(res);
    } catch (error) {
        console.error(`[serve_visitor_embedding] Error: ${error.message}`);
        res.status(404).json({ error: 'Embedding not found' });
    }
});

module.exports = router;
