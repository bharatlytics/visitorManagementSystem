/**
 * Enterprise Employee Management API
 * Full CRUD operations with data residency support
 * Matching Python app/api/employees.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const multer = require('multer');

const { collections, getDb, getGridFSBucket } = require('../db');
const Config = require('../config');
const { requireAuth, requireCompanyAccess } = require('../middleware/auth');
const {
    validateRequiredFields,
    validateEmailFormat,
    validatePhoneFormat,
    convertObjectIds,
    isValidObjectId,
    getCurrentUTC,
    rewriteEmbeddingUrls
} = require('../utils/helpers');
const { getDataProvider } = require('../services/data_provider');

// Multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sync employee to platform actors collection with images
 */
async function syncEmployeeToPlatform(employeeData, companyId, includeImages = true, platformToken) {
    try {
        // Build attributes
        const attributes = {
            name: employeeData.employeeName,
            employeeName: employeeData.employeeName,
            email: employeeData.email,
            phone: employeeData.phone,
            designation: employeeData.designation,
            department: employeeData.department,
            employeeId: employeeData.employeeId,
            actorType: 'employee'
        };

        // Include all available images
        const actorImages = {};
        let photoData = null; // Primary photo for attributes

        if (includeImages && employeeData.employeeImages) {
            const images = employeeData.employeeImages;
            const positions = ['front', 'center', 'left', 'right', 'side'];

            for (const position of positions) {
                if (images[position]) {
                    try {
                        const bucket = getGridFSBucket('employeeImages');
                        const imageId = new ObjectId(images[position]);
                        const chunks = [];
                        const downloadStream = bucket.openDownloadStream(imageId);

                        for await (const chunk of downloadStream) {
                            chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        const base64Img = `data:image/jpeg;base64,${buffer.toString('base64')}`;

                        // Add to actorImages map
                        actorImages[position] = base64Img;
                        console.log(`[sync_employee] Prepared ${position} image (${buffer.length} bytes)`);

                        // Set primary photo if not set (prioritize front, then center via loop order - wait, strictly prioritize front/center)
                    } catch (e) {
                        console.log(`[sync_employee] Error reading ${position} image: ${e.message}`);
                    }
                }
            }

            // Set primary photo for attributes (prioritize front -> center -> others)
            if (actorImages.front) photoData = actorImages.front;
            else if (actorImages.center) photoData = actorImages.center;
            else if (actorImages.left) photoData = actorImages.left;
            else if (actorImages.right) photoData = actorImages.right;
            else if (actorImages.side) photoData = actorImages.side;
        }

        if (photoData) {
            attributes.photo = photoData;
        }

        const actorData = {
            companyId: String(companyId),
            actorType: 'employee',
            attributes,
            actorImages, // Include all images here
            sourceAppId: 'vms_app_v1',
            sourceActorId: String(employeeData._id),
            status: employeeData.status || 'active',
            metadata: {
                hasPhoto: Boolean(photoData),
                sourceApp: 'vms_app_v1'
            }
        };

        if (!platformToken) {
            console.log('[sync_employee] No platform token');
            return { success: false, error: 'No platform token' };
        }

        console.log(`[sync_employee] Syncing to ${Config.PLATFORM_API_URL}/bharatlytics/v1/actors`);

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
            console.log(`[sync_employee] Synced: ${employeeData.employeeName} (photo: ${Boolean(photoData)})`);
            return {
                success: true,
                actorId: result._id || result.actorId,
                hasPhoto: Boolean(photoData)
            };
        } else {
            const text = await response.text();
            console.log(`[sync_employee] Failed: ${response.status} - ${text.substring(0, 200)}`);
            return { success: false, error: text.substring(0, 200) };
        }
    } catch (e) {
        console.log(`[sync_employee] Error: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Build employee document
 */
function buildEmployeeDoc(data, imageDict = {}, embeddingsDict = {}) {
    const companyId = isValidObjectId(data.companyId)
        ? new ObjectId(data.companyId)
        : data.companyId;

    return {
        _id: new ObjectId(),
        companyId,
        employeeId: data.employeeId || `EMP-${Date.now()}`, // Simple generation if not provided
        employeeName: data.employeeName,
        email: data.email || data.employeeEmail || null,
        phone: data.phone || data.employeePhone || null,
        designation: data.designation || null,
        department: data.department || null,
        status: data.status || 'active',
        blacklisted: data.blacklisted === 'true' || data.blacklisted === true || false,
        blacklistReason: data.blacklistReason || null,
        employeeImages: imageDict,
        employeeEmbeddings: embeddingsDict,
        createdAt: new Date(),
        lastUpdated: new Date()
    };
}


// =============================================================================
/**
 * GET /api/employees
 * List employees - respects data residency (fetches from Platform or VMS DB)
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        // Use DataProvider for residency-aware fetching
        // Pass platformToken from session or header for Platform API calls
        let platformToken = req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }
        // Force rebuild for config change

        const dataProvider = getDataProvider(companyId, platformToken);
        let employees = await dataProvider.getEmployees(companyId);

        // Filter by status if provided
        if (req.query.status) {
            employees = employees.filter(emp => emp.status === req.query.status);
        }

        // Exclude deleted by default
        if (!req.query.includeDeleted) {
            employees = employees.filter(emp => emp.status !== 'deleted');
        }

        // Filter active and non-blacklisted for host selection
        if (req.query.hostsOnly === 'true') {
            employees = employees.filter(emp =>
                emp.status === 'active' && !emp.blacklisted
            );
        }

        // Rewrite download URLs to direct Platform URLs to avoid invalid proxy timeouts
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        // Pass Config.PLATFORM_API_URL to generate direct links
        rewriteEmbeddingUrls(employees, baseUrl, 'employees', Config.PLATFORM_API_URL);

        // Return as direct array (matching Python API format)
        res.json(convertObjectIds(employees));
    } catch (error) {
        console.error('Error listing employees:', error);
        next(error);
    }
});


/**
 * GET /api/employees/:employee_id
 * Get single employee by ID
 */
router.get('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;

        let employee = null;

        // Try ObjectId first
        if (isValidObjectId(employee_id)) {
            employee = await collections.employees().findOne({ _id: new ObjectId(employee_id) });
        }

        // Fallback to employeeId field
        if (!employee) {
            employee = await collections.employees().findOne({ employeeId: employee_id });
        }

        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ employee: convertObjectIds(employee) });
    } catch (error) {
        console.error('Error getting employee:', error);
        next(error);
    }
});

/**
 * POST /api/employees
 * Create employee (JSON body)
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const requiredFields = ['companyId', 'employeeName'];
        const validation = validateRequiredFields(data, requiredFields);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email if provided
        if (data.email && !validateEmailFormat(data.email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const employeeDoc = buildEmployeeDoc(data);
        const result = await collections.employees().insertOne(employeeDoc);

        // Sync to Platform (if connected)
        let platformSync = { status: 'skipped', message: 'No platform token' };
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;

        // Fallback to Bearer token
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        if (platformToken) {
            console.log(`[create_employee] Syncing employee ${result.insertedId} to platform...`);
            const syncResult = await syncEmployeeToPlatform(employeeDoc, data.companyId, false, platformToken); // No images in simple create

            if (syncResult.success) {
                platformSync = { status: 'success', actorId: syncResult.actorId };
            } else {
                platformSync = { status: 'failed', error: syncResult.error };
            }
        }

        res.status(201).json({
            message: 'Employee created successfully',
            _id: result.insertedId.toString(),
            employeeId: employeeDoc.employeeId,
            platformSync
        });
    } catch (error) {
        console.error('Error creating employee:', error);
        next(error);
    }
});

/**
 * POST /api/employees/register
 * Register employee with face images
 */
const registerFields = upload.fields([
    { name: 'left', maxCount: 1 },
    { name: 'right', maxCount: 1 },
    { name: 'center', maxCount: 1 },
    { name: 'front', maxCount: 1 },
    { name: 'side', maxCount: 1 },
    { name: 'embedding', maxCount: 1 }
]);

router.post('/register', requireCompanyAccess, registerFields, async (req, res, next) => {
    try {
        const data = req.body;

        const requiredFields = ['companyId', 'employeeName'];
        const validation = validateRequiredFields(data, requiredFields);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email if provided
        const email = data.email || data.employeeEmail;
        if (email && !validateEmailFormat(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const companyId = data.companyId;

        // Process face images
        const imageDict = {};
        const facePositions = ['left', 'right', 'center', 'front', 'side'];

        for (const position of facePositions) {
            if (req.files && req.files[position]) {
                const file = req.files[position][0];
                const bucket = getGridFSBucket('employeeImages');

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

        // Handle base64 images
        const base64Mapping = { faceCenter: 'center', faceLeft: 'left', faceRight: 'right' };
        for (const [formKey, position] of Object.entries(base64Mapping)) {
            if (data[formKey]) {
                let base64Data = data[formKey];
                if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                }
                const imageBuffer = Buffer.from(base64Data, 'base64');

                const bucket = getGridFSBucket('employeeImages');
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

        // UNCHANGED: Start processing embeddings below

        // Process pre-calculated embedding (from mobile)
        const initialEmbeddingsDict = {};
        if (req.files && req.files['embedding']) {
            try {
                const file = req.files['embedding'][0];
                const version = data.embeddingVersion || 'mobile_facenet_v1';
                const bucket = getGridFSBucket('employeeEmbeddings');

                const uploadStream = bucket.openUploadStream(`${companyId}_${version}.bin`, {
                    metadata: {
                        companyId,
                        model: version,
                        type: 'embedding',
                        timestamp: new Date()
                    }
                });

                uploadStream.write(file.buffer);
                uploadStream.end();

                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', resolve);
                    uploadStream.on('error', reject);
                });

                initialEmbeddingsDict[version] = {
                    status: 'completed',
                    embeddingId: uploadStream.id,
                    model: version,
                    createdAt: new Date(),
                    finishedAt: new Date()
                };
                console.log(`[register_employee] Stored pre-calculated embedding for ${version}`);
            } catch (e) {
                console.log(`[register_employee] Error processing embedding file: ${e.message}`);
            }
        }

        // Build employee document
        const employeeDoc = buildEmployeeDoc(data, imageDict, initialEmbeddingsDict);
        const result = await collections.employees().insertOne(employeeDoc);
        const employeeId = result.insertedId;

        // Queue embedding job if images exist (for server-side models like buffalo_l)
        const embeddingsUpdates = {};
        if (Object.keys(imageDict).length > 0) {
            // Only queue if not already provided (though unlikely for buffalo_l from mobile)
            if (!initialEmbeddingsDict.buffalo_l) {
                embeddingsUpdates.buffalo_l = {
                    status: 'queued',
                    queuedAt: new Date()
                };

                await collections.embeddingJobs().insertOne({
                    companyId: new ObjectId(companyId),
                    employeeId,
                    model: 'buffalo_l',
                    status: 'queued',
                    createdAt: new Date(),
                    params: {}
                });
            }

            // Apply updates
            if (Object.keys(embeddingsUpdates).length > 0) {
                const updateQuery = {};
                for (const [model, info] of Object.entries(embeddingsUpdates)) {
                    updateQuery[`employeeEmbeddings.${model}`] = info;
                }

                await collections.employees().updateOne(
                    { _id: employeeId },
                    { $set: updateQuery }
                );

                // Merge for response
                Object.assign(employeeDoc.employeeEmbeddings, embeddingsUpdates);
            }
        }

        // Sync to Platform (if connected)
        let platformSync = { status: 'skipped', message: 'No platform token' };
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;

        // Fallback to Bearer token
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        if (platformToken) {
            console.log(`[register_employee] Syncing employee ${employeeId} to platform...`);
            const syncResult = await syncEmployeeToPlatform(employeeDoc, companyId, true, platformToken);

            if (syncResult.success) {
                platformSync = { status: 'success', actorId: syncResult.actorId };
            } else {
                platformSync = { status: 'failed', error: syncResult.error };
                console.error(`[register_employee] Platform sync failed: ${syncResult.error}`);
            }
        }

        res.status(201).json({
            message: 'Employee registered successfully',
            _id: employeeId.toString(),
            employeeId: employeeDoc.employeeId,
            embeddingStatus: Object.fromEntries(
                Object.entries(employeeDoc.employeeEmbeddings).map(([k, v]) => [k, v.status || 'unknown'])
            ),
            hasBiometric: Object.keys(imageDict).length > 0,
            platformSync
        });
    } catch (error) {
        console.error('Error registering employee:', error);
        next(error);
    }
});

/**
 * PUT /api/employees/:employee_id
 * Update employee
 */
router.put('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }

        const updateFields = {};
        const allowedFields = ['employeeName', 'email', 'phone', 'designation', 'department', 'employeeId', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const result = await collections.employees().updateOne(
            { _id: new ObjectId(employee_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee updated successfully' });
    } catch (error) {
        console.error('Error updating employee:', error);
        next(error);
    }
});

/**
 * DELETE /api/employees/:employee_id
 * Soft delete employee
 */
router.delete('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }

        const result = await collections.employees().updateOne(
            { _id: new ObjectId(employee_id) },
            {
                $set: {
                    status: 'deleted',
                    deletedAt: new Date(),
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee deleted successfully' });
    } catch (error) {
        console.error('Error deleting employee:', error);
        next(error);
    }
});

/**
 * POST /api/employees/:employee_id/blacklist
 * Blacklist an employee
 */
router.post('/:employee_id/blacklist', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;
        const { reason = 'No reason provided' } = req.body;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }

        const result = await collections.employees().updateOne(
            { _id: new ObjectId(employee_id) },
            {
                $set: {
                    blacklisted: true,
                    blacklistReason: reason,
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee blacklisted successfully' });
    } catch (error) {
        console.error('Error blacklisting employee:', error);
        next(error);
    }
});

/**
 * POST /api/employees/:employee_id/unblacklist
 * Remove employee from blacklist
 */
router.post('/:employee_id/unblacklist', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }

        const result = await collections.employees().updateOne(
            { _id: new ObjectId(employee_id) },
            {
                $set: {
                    blacklisted: false,
                    blacklistReason: null,
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee unblacklisted successfully' });
    } catch (error) {
        console.error('Error unblacklisting employee:', error);
        next(error);
    }
});

/**
 * GET /api/employees/attendance
 * GET: Retrieve attendance records
 * POST: Upload/sync attendance records
 */
router.get('/attendance', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const employeeId = req.query.employeeId;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        let query = {};

        if (companyId) {
            query.companyId = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;
        }

        if (employeeId) {
            query.employeeId = isValidObjectId(employeeId) ? new ObjectId(employeeId) : employeeId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const records = await collections.attendance().find(query).sort({ date: -1 }).toArray();

        res.json({ attendance: convertObjectIds(records) });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        next(error);
    }
});

router.post('/attendance', requireCompanyAccess, async (req, res, next) => {
    try {
        const records = req.body.records || [req.body];

        const results = [];
        for (const record of records) {
            const doc = {
                _id: new ObjectId(),
                companyId: isValidObjectId(record.companyId) ? new ObjectId(record.companyId) : record.companyId,
                employeeId: isValidObjectId(record.employeeId) ? new ObjectId(record.employeeId) : record.employeeId,
                date: new Date(record.date || new Date()),
                checkIn: record.checkIn ? new Date(record.checkIn) : null,
                checkOut: record.checkOut ? new Date(record.checkOut) : null,
                status: record.status || 'present',
                createdAt: new Date()
            };

            await collections.attendance().insertOne(doc);
            results.push({ _id: doc._id.toString(), status: 'created' });
        }

        res.status(201).json({
            message: 'Attendance records created',
            records: results
        });
    } catch (error) {
        console.error('Error creating attendance:', error);
        next(error);
    }
});

/**
 * GET /api/employees/embeddings/:embedding_id
 * Download employee embedding file.
 * Proxies to Platform API when not found locally (matching Python implementation).
 */
router.get('/embeddings/:embedding_id', async (req, res, next) => {
    try {
        const { embedding_id } = req.params;

        console.log(`[serve_employee_embedding] embedding_id=${embedding_id}`);

        // First try local GridFS (for app mode embeddings)
        if (isValidObjectId(embedding_id)) {
            try {
                const bucket = getGridFSBucket('employeeEmbeddings');
                const downloadStream = bucket.openDownloadStream(new ObjectId(embedding_id));

                // Wait for stream to start or error
                await new Promise((resolve, reject) => {
                    downloadStream.on('file', resolve);
                    downloadStream.on('error', reject);
                });

                res.set('Content-Type', 'application/octet-stream');
                res.set('Content-Disposition', `attachment; filename=${embedding_id}.npy`);
                downloadStream.pipe(res);
                return;
            } catch (localError) {
                console.log(`[serve_employee_embedding] Not in local GridFS, proxying to Platform`);
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
        console.log(`[serve_employee_embedding] Proxying to platform: ${platformUrl}`);

        // Fail fast if platform URL is localhost in production (heuristic)
        if (process.env.NODE_ENV === 'production' && platformUrl.includes('localhost')) {
            console.warn('[serve_employee_embedding] Warning: Trying to proxy to localhost in production!');
        }

        const response = await axios.get(platformUrl, {
            headers: { 'Authorization': `Bearer ${platformToken}` },
            responseType: 'stream',
            timeout: 30000 // Increase to 30s for better reliability
        });

        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', response.headers['content-disposition'] || `attachment; filename=${embedding_id}.npy`);
        response.data.pipe(res);
    } catch (error) {
        console.error(`[serve_employee_embedding] Error: ${error.message}`);
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ error: 'Platform request timed out' });
        }
        res.status(404).json({ error: 'Embedding not found' });
    }
});

module.exports = router;
