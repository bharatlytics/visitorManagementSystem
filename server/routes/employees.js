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
const { createPlatformClient } = require('../services/platform_client');

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
 * Handles duplicate entries by updating existing actors (including reactivating deleted ones)
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

        // Pass all images in attributes.photos for Platform to process
        if (Object.keys(actorImages).length > 0) {
            attributes.photos = actorImages;
        }

        const actorData = {
            companyId: String(companyId),
            actorType: 'employee',
            attributes,
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

        // Handle duplicate entry error (409 Conflict) - update existing actor instead
        if (response.status === 409) {
            console.log(`[sync_employee] Duplicate detected, attempting to update existing actor...`);

            try {
                // Find existing actor by sourceActorId
                const platformClient = createPlatformClient(companyId, platformToken);

                // Search for actor with same sourceActorId
                const searchUrl = `${Config.PLATFORM_API_URL}/bharatlytics/v1/actors?companyId=${companyId}&sourceActorId=${employeeData._id}`;
                const searchResponse = await fetch(searchUrl, {
                    headers: {
                        'Authorization': `Bearer ${platformToken}`,
                        'X-App-Id': 'vms_app_v1'
                    }
                });

                let existingActorId = null;
                if (searchResponse.ok) {
                    const searchResult = await searchResponse.json();
                    const actors = searchResult.actors || searchResult.data || [];
                    if (actors.length > 0) {
                        existingActorId = actors[0]._id;
                        console.log(`[sync_employee] Found existing actor: ${existingActorId}`);
                    }
                }

                if (existingActorId) {
                    // Update the existing actor (reactivate if deleted)
                    const updateData = {
                        status: employeeData.status || 'active',
                        attributes: {
                            ...attributes
                        }
                    };

                    const updateResult = await platformClient.updateActor(existingActorId, updateData, companyId);

                    if (updateResult.success) {
                        console.log(`[sync_employee] Updated existing actor ${existingActorId} (reactivated)`);
                        return {
                            success: true,
                            actorId: existingActorId,
                            hasPhoto: Boolean(photoData),
                            reactivated: true
                        };
                    } else {
                        console.log(`[sync_employee] Failed to update existing actor: ${updateResult.error}`);
                        return { success: false, error: updateResult.error };
                    }
                } else {
                    console.log(`[sync_employee] Could not find existing actor to update`);
                    return { success: false, error: 'Duplicate entry but could not find existing actor' };
                }
            } catch (updateError) {
                console.log(`[sync_employee] Error handling duplicate: ${updateError.message}`);
                return { success: false, error: `Duplicate handling failed: ${updateError.message}` };
            }
        }

        if (response.ok) {
            const result = await response.json();

            // Platform returns { actor: { _id: ... } } (v3) or legacy { _id: ... }
            const actorId = result.actor?._id || result._id || result.actorId;

            console.log(`[sync_employee] Synced: ${employeeData.employeeName}, Platform Result keys: ${Object.keys(result)}, actorId extracted: ${actorId}`);
            if (result.actor) console.log(`[sync_employee] result.actor: ${JSON.stringify(result.actor)}`);

            // Step 2: Sync pre-calculated embeddings (e.g. mobile_facenet_v1)
            // This prevents the platform from queuing them again
            if (employeeData.employeeEmbeddings && actorId) {
                console.log(`[sync_employee] Has embeddings: ${Object.keys(employeeData.employeeEmbeddings).join(',')}`);

                const axios = require('axios');
                // Try to use form-data if available (common in Node envs)
                let FormData;
                try {
                    FormData = require('form-data');
                    console.log('[sync_employee] form-data package loaded');
                } catch (e) {
                    console.log('[sync_employee] form-data package not found');
                    console.log('[sync_employee] form-data package not found, checking global');
                }

                if (!FormData && typeof global.FormData !== 'undefined') {
                    FormData = global.FormData;
                    console.log('[sync_employee] using global.FormData');
                }

                if (FormData) {
                    for (const [model, info] of Object.entries(employeeData.employeeEmbeddings)) {
                        console.log(`[sync_employee] Checking model ${model}: status=${info.status}, id=${info.embeddingId}`);

                        if (info.status === 'completed' && info.embeddingId) {
                            try {
                                const bucket = getGridFSBucket('employeeEmbeddings');
                                const downloadStream = bucket.openDownloadStream(new ObjectId(info.embeddingId));
                                const chunks = [];
                                for await (const chunk of downloadStream) {
                                    chunks.push(chunk);
                                }
                                const buffer = Buffer.concat(chunks);
                                console.log(`[sync_employee] Read chunks for ${model}, buffer size: ${buffer.length}`);

                                const form = new FormData();
                                form.append('companyId', String(companyId));
                                form.append('embeddingAttached', 'true');
                                form.append('embeddingVersion', model);
                                form.append('embedding', buffer, {
                                    filename: `${model}.bin`,
                                    contentType: 'application/octet-stream'
                                });

                                const embedUrl = `${Config.PLATFORM_API_URL}/bharatlytics/v1/actors/${actorId}/biometrics`;
                                console.log(`[sync_employee] Posting embedding to ${embedUrl}`);

                                const embedResp = await axios.post(embedUrl, form, {
                                    headers: {
                                        ...form.getHeaders(),
                                        'Authorization': `Bearer ${platformToken}`,
                                        'X-App-Id': 'vms_app_v1'
                                    },
                                    timeout: 30000
                                });
                                console.log(`[sync_employee] Embedding sync result for ${model}: ${embedResp.status}`);
                            } catch (error) {
                                console.log(`[sync_employee] Embedding sync error for ${model}: ${error.message}`);
                                if (error.response) console.log(`[sync_employee] Response data: ${JSON.stringify(error.response.data)}`);
                            }
                        }
                    }
                } else {
                    console.log('[sync_employee] FormData not available');
                }
            } else {
                console.log(`[sync_employee] Skipping embedding sync. Has embeddings: ${!!employeeData.employeeEmbeddings}, actorId: ${actorId}`);
            }

            return {
                success: true,
                actorId: actorId,
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
            return res.status(400).json({ status: 'error', error: 'Company ID is required.' });
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

        // Return with status field for client-side parsing
        res.json({ status: 'success', employees: convertObjectIds(employees), count: employees.length });
    } catch (error) {
        console.error('Error listing employees:', error);
        next(error);
    }
});


/**
 * GET /api/employees/attendance
 * Retrieve attendance records - MUST be before /:employee_id to avoid path conflict
 */
router.get('/attendance', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const employeeId = req.query.employeeId;
        // Support both naming conventions
        const startDate = req.query.startDate || req.query.startTime;
        const endDate = req.query.endDate || req.query.endTime;

        let query = {};

        if (companyId) {
            query.companyId = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;
        }

        if (employeeId) {
            query.employeeId = isValidObjectId(employeeId) ? new ObjectId(employeeId) : employeeId;
        }

        if (startDate || endDate) {
            // Query both legacy 'date' field and new 'attendanceTime' field
            const timeQuery = {};
            if (startDate) timeQuery.$gte = new Date(startDate);
            if (endDate) timeQuery.$lte = new Date(endDate);

            query.$or = [
                { date: timeQuery },
                { attendanceTime: timeQuery }
            ];
        }

        const records = await collections.attendance().find(query).sort({ attendanceTime: -1, date: -1 }).toArray();

        res.json({ status: 'success', attendance: convertObjectIds(records) });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        next(error);
    }
});


/**
 * GET /api/employees/:employee_id
 * Get single employee by ID - respects data residency
 */
router.get('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;
        const companyId = req.query.companyId;

        // Get platform token for residency-aware fetching
        let platformToken = req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        let employee = null;

        // Use DataProvider for residency-aware fetching
        if (companyId) {
            const dataProvider = getDataProvider(companyId, platformToken);
            employee = await dataProvider.getEmployeeById(employee_id, companyId);
        }

        // Fallback to direct DB query if no companyId or DataProvider returns null
        if (!employee) {
            if (isValidObjectId(employee_id)) {
                employee = await collections.employees().findOne({ _id: new ObjectId(employee_id) });
            }
            if (!employee) {
                employee = await collections.employees().findOne({ employeeId: employee_id });
            }
        }

        if (!employee) {
            return res.status(404).json({ status: 'error', error: 'Employee not found' });
        }

        // Rewrite embedding URLs
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        rewriteEmbeddingUrls([employee], baseUrl, 'employees', Config.PLATFORM_API_URL);

        res.json({ status: 'success', employee: convertObjectIds(employee) });
    } catch (error) {
        console.error('Error getting employee:', error);
        next(error);
    }
});

/**
 * POST /api/employees
 * Create employee (JSON body) - Residency-aware
 * Platform mode: Create on Platform, cache locally
 * App mode: Create locally, sync to Platform
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const requiredFields = ['companyId', 'employeeName'];
        const validation = validateRequiredFields(data, requiredFields);
        if (!validation.valid) {
            return res.status(400).json({ status: 'error', error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email if provided
        if (data.email && !validateEmailFormat(data.email)) {
            return res.status(400).json({ status: 'error', error: 'Invalid email format' });
        }

        const companyId = data.companyId;
        const inputEmployeeId = data.employeeId;

        // Get platform token
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Check residency mode
        const { getResidencyMode } = require('../services/residency_detector');
        const residencyMode = await getResidencyMode(companyId, 'employee');
        console.log(`[create_employee] Company ${companyId}, residency mode: ${residencyMode}`);

        if (residencyMode === 'platform') {
            // PLATFORM MODE: Create on Platform first
            console.log(`[create_employee] Platform mode - creating employee on Platform...`);

            if (!platformToken) {
                return res.status(401).json({
                    status: 'error',
                    error: 'Platform token required',
                    message: 'Employee data resides on Platform. Please provide a valid platform token.'
                });
            }

            const platformClient = createPlatformClient(companyId, platformToken);

            // Build Platform actor data
            const actorData = {
                companyId: String(companyId),
                actorType: 'employee',
                status: 'active',
                attributes: {
                    name: data.employeeName,
                    employeeName: data.employeeName,
                    email: data.email || null,
                    phone: data.phone || null,
                    designation: data.designation || null,
                    department: data.department || null,
                    employeeId: inputEmployeeId || `EMP-${Date.now()}`
                },
                sourceAppId: 'vms_app_v1',
                metadata: { sourceApp: 'vms_app_v1' }
            };

            // Create on Platform
            const createResult = await platformClient.createActor(actorData, companyId);

            if (createResult.success) {
                res.status(201).json({
                    status: 'success',
                    message: 'Employee created successfully on Platform',
                    dataResidency: 'platform',
                    actorId: createResult.actorId,
                    employeeId: actorData.attributes.employeeId
                });
            } else {
                // Handle duplicate - check if it's a deleted actor we can update
                if (createResult.error && createResult.error.includes('duplicate')) {
                    return res.status(409).json({
                        status: 'error',
                        error: 'Duplicate Employee',
                        message: 'An employee with this ID already exists on Platform',
                        dataResidency: 'platform'
                    });
                }
                res.status(500).json({
                    status: 'error',
                    error: 'Failed to create employee on Platform',
                    details: createResult.error
                });
            }
        } else {
            // APP MODE: Create locally, sync to Platform
            console.log(`[create_employee] App mode - creating employee locally...`);

            // Check if an active employee exists with same employeeId (block creation)
            if (inputEmployeeId) {
                const activeEmployee = await collections.employees().findOne({
                    companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                    employeeId: inputEmployeeId,
                    status: { $ne: 'deleted' }
                });

                if (activeEmployee) {
                    return res.status(409).json({
                        status: 'error',
                        error: 'Duplicate Employee ID',
                        message: `An active employee with ID ${inputEmployeeId} already exists`,
                        field: 'employeeId'
                    });
                }
            }

            // If deleted employee exists with same employeeId, rename the old one to preserve audit trail
            if (inputEmployeeId) {
                const deletedEmployees = await collections.employees().find({
                    companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                    employeeId: inputEmployeeId,
                    status: 'deleted'
                }).toArray();

                for (const deletedEmployee of deletedEmployees) {
                    const archiveId = `${inputEmployeeId}_archived_${deletedEmployee.deletedAt ? deletedEmployee.deletedAt.getTime() : Date.now()}`;
                    const archiveEmail = deletedEmployee.email ? `${deletedEmployee.email}_archived_${Date.now()}` : null;
                    console.log(`[create_employee] Archiving deleted employee ${deletedEmployee._id}, renaming employeeId to ${archiveId}`);

                    await collections.employees().updateOne(
                        { _id: deletedEmployee._id },
                        {
                            $set: {
                                employeeId: archiveId,
                                email: archiveEmail,
                                originalEmployeeId: inputEmployeeId,
                                originalEmail: deletedEmployee.email,
                                archivedAt: new Date()
                            }
                        }
                    );
                }
            }

            // Also archive deleted employees with same email to avoid email unique constraint
            const inputEmail = data.email;
            if (inputEmail) {
                const deletedByEmail = await collections.employees().find({
                    companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                    email: inputEmail,
                    status: 'deleted'
                }).toArray();

                for (const deletedEmployee of deletedByEmail) {
                    console.log(`[create_employee] Archiving deleted employee ${deletedEmployee._id} by email ${inputEmail}`);
                    const archiveId = deletedEmployee.employeeId ?
                        `${deletedEmployee.employeeId}_archived_${deletedEmployee.deletedAt ? deletedEmployee.deletedAt.getTime() : Date.now()}` :
                        `unknown_archived_${Date.now()}`;
                    const archiveEmail = `${inputEmail}_archived_${Date.now()}`;

                    await collections.employees().updateOne(
                        { _id: deletedEmployee._id },
                        {
                            $set: {
                                employeeId: archiveId,
                                email: archiveEmail,
                                originalEmployeeId: deletedEmployee.employeeId,
                                originalEmail: inputEmail,
                                archivedAt: new Date()
                            }
                        }
                    );
                }
            }

            const employeeDoc = buildEmployeeDoc(data);
            const result = await collections.employees().insertOne(employeeDoc);

            // App mode: NO Platform sync, local DB is source of truth
            res.status(201).json({
                status: 'success',
                message: 'Employee created successfully',
                dataResidency: 'app',
                _id: result.insertedId.toString(),
                employeeId: employeeDoc.employeeId
            });
        }
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
            return res.status(400).json({ status: 'error', error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email if provided
        const email = data.email || data.employeeEmail;
        if (email && !validateEmailFormat(email)) {
            return res.status(400).json({ status: 'error', error: 'Invalid email format' });
        }

        const companyId = data.companyId;
        const inputEmployeeId = data.employeeId;

        // Get platform token
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Check residency mode for proper duplicate detection
        const { getResidencyMode } = require('../services/residency_detector');
        const residencyMode = await getResidencyMode(companyId, 'employee');
        console.log(`[register_employee] Company ${companyId}, residency mode: ${residencyMode}`);

        // Residency-aware duplicate check
        if (inputEmployeeId) {
            if (residencyMode === 'platform' && platformToken) {
                // Platform mode: check Platform for existing employees
                console.log(`[register_employee] Platform mode - checking Platform for existing employee ${inputEmployeeId}...`);
                const platformClient = createPlatformClient(companyId, platformToken);

                // Get all employees with this employeeId from Platform
                try {
                    const url = `${require('../config').PLATFORM_API_URL}/bharatlytics/v1/actors`;
                    const response = await fetch(url + `?companyId=${companyId}&actorType=employee`, {
                        headers: {
                            'Authorization': `Bearer ${platformToken}`,
                            'X-App-Id': 'vms_app_v1'
                        }
                    });

                    if (response.ok) {
                        const actors = await response.json();
                        const existingActor = (Array.isArray(actors) ? actors : actors.actors || [])
                            .find(a => a.attributes?.employeeId === inputEmployeeId);

                        if (existingActor) {
                            if (existingActor.status !== 'deleted') {
                                return res.status(409).json({
                                    status: 'error',
                                    error: 'Duplicate Employee ID',
                                    message: `An active employee with ID ${inputEmployeeId} already exists on Platform`,
                                    field: 'employeeId',
                                    dataResidency: 'platform'
                                });
                            } else {
                                // Employee exists but is deleted - allow registration
                                console.log(`[register_employee] Found deleted employee ${inputEmployeeId} on Platform, allowing registration`);
                            }
                        }
                    }
                } catch (err) {
                    console.log(`[register_employee] Platform check failed: ${err.message}, falling back to local check`);
                }
            } else {
                // App mode: check local DB for duplicates
                const activeEmployee = await collections.employees().findOne({
                    companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                    employeeId: inputEmployeeId,
                    status: { $ne: 'deleted' }
                });

                if (activeEmployee) {
                    return res.status(409).json({
                        status: 'error',
                        error: 'Duplicate Employee ID',
                        message: `An active employee with ID ${inputEmployeeId} already exists`,
                        field: 'employeeId',
                        dataResidency: 'app'
                    });
                }
            }
        }

        // ============ PLATFORM MODE: Create on Platform directly ============
        if (residencyMode === 'platform') {
            console.log(`[register_employee] Platform mode - creating employee on Platform...`);

            if (!platformToken) {
                return res.status(401).json({
                    error: 'Platform token required',
                    message: 'Employee data resides on Platform. Please provide a valid platform token.'
                });
            }

            // Prepare images as base64 for Platform
            const imageData = {};
            const facePositions = ['left', 'right', 'center', 'front', 'side'];

            for (const position of facePositions) {
                if (req.files && req.files[position]) {
                    const file = req.files[position][0];
                    imageData[position] = file.buffer.toString('base64');
                }
            }

            // Handle base64 images from request body
            const base64Mapping = { faceCenter: 'center', faceLeft: 'left', faceRight: 'right' };
            for (const [formKey, position] of Object.entries(base64Mapping)) {
                if (data[formKey]) {
                    let base64Data = data[formKey];
                    if (base64Data.includes(',')) {
                        base64Data = base64Data.split(',')[1];
                    }
                    imageData[position] = base64Data;
                }
            }

            // Prepare embedding data for Platform
            const embeddingData = {};
            if (req.files && req.files['embedding']) {
                const file = req.files['embedding'][0];
                const version = data.embeddingVersion || 'mobile_facenet_v1';
                embeddingData[version] = {
                    data: file.buffer.toString('base64'),
                    status: 'completed'
                };
            }

            // Build Platform actor data - DON'T include photos/embeddings here
            // They will be uploaded via /biometrics endpoint which handles pre-computed embeddings properly
            const attributes = {
                name: data.employeeName,
                employeeName: data.employeeName,
                email: data.email || data.employeeEmail || null,
                phone: data.phone || null,
                designation: data.designation || null,
                department: data.department || null,
                employeeId: inputEmployeeId || `EMP-${Date.now()}`
            };

            // NOTE: Don't add photo/photos/embeddings to attributes!
            // Platform's create_actor queues embedding jobs when it sees photos,
            // which prevents /biometrics from setting status to 'done'.

            const actorData = {
                companyId: String(companyId),
                actorType: 'employee',
                status: 'active',
                attributes: attributes,
                // Don't include actorImages/actorEmbeddings - use /biometrics endpoint instead
                sourceAppId: 'vms_app_v1',
                metadata: { sourceApp: 'vms_app_v1' }
            };

            const platformClient = createPlatformClient(companyId, platformToken);
            const createResult = await platformClient.createActor(actorData, companyId);

            if (createResult.success) {
                const actorId = createResult.actorId;
                let biometricUploaded = false;

                // Upload biometrics (images + embeddings) using Platform's /biometrics endpoint
                if (Object.keys(imageData).length > 0 || Object.keys(embeddingData).length > 0) {
                    try {
                        const FormData = require('form-data');
                        const axios = require('axios');
                        const formData = new FormData();
                        formData.append('companyId', companyId);

                        // Add face images
                        for (const [pose, base64] of Object.entries(imageData)) {
                            const buffer = Buffer.from(base64, 'base64');
                            formData.append(pose, buffer, { filename: `${pose}.jpg`, contentType: 'image/jpeg' });
                        }

                        // Add pre-computed embedding if available
                        if (Object.keys(embeddingData).length > 0) {
                            const embVersion = Object.keys(embeddingData)[0];
                            const embData = embeddingData[embVersion];
                            if (embData && embData.data) {
                                formData.append('embeddingAttached', 'true');
                                formData.append('embeddingVersion', embVersion);
                                const embBuffer = Buffer.from(embData.data, 'base64');
                                formData.append('embedding', embBuffer, { filename: `${embVersion}.pkl`, contentType: 'application/octet-stream' });
                            }
                        }

                        const biometricsUrl = `${require('../config').PLATFORM_API_URL}/bharatlytics/v1/actors/${actorId}/biometrics`;
                        console.log(`[register_employee] Uploading biometrics to ${biometricsUrl}`);

                        const biometricsResponse = await axios.post(biometricsUrl, formData, {
                            headers: {
                                'Authorization': `Bearer ${platformToken}`,
                                'X-App-Id': 'vms_app_v1',
                                ...formData.getHeaders()
                            },
                            timeout: 30000
                        });

                        if (biometricsResponse.status === 200) {
                            console.log(`[register_employee] Biometrics uploaded:`, biometricsResponse.data);
                            biometricUploaded = true;
                        }
                    } catch (bioError) {
                        console.error(`[register_employee] Error uploading biometrics: ${bioError.message}`);
                        if (bioError.response) {
                            console.error(`[register_employee] Response: ${bioError.response.status}`, bioError.response.data);
                        }
                    }
                }

                res.status(201).json({
                    status: 'success',
                    message: 'Employee registered successfully on Platform',
                    dataResidency: 'platform',
                    actorId: actorId,
                    employeeId: actorData.attributes.employeeId,
                    hasBiometric: Object.keys(imageData).length > 0,
                    biometricUploaded: biometricUploaded
                });
            } else {
                if (createResult.duplicate) {
                    // Check if the duplicate is a deleted actor - if so, archive it and retry
                    console.log(`[register_employee] Duplicate detected, checking if deleted actor exists...`);

                    try {
                        // Find all actors with this employeeId
                        const url = `${require('../config').PLATFORM_API_URL}/bharatlytics/v1/actors`;
                        const response = await fetch(url + `?companyId=${companyId}&actorType=employee`, {
                            headers: {
                                'Authorization': `Bearer ${platformToken}`,
                                'X-App-Id': 'vms_app_v1'
                            }
                        });

                        if (response.ok) {
                            const actors = await response.json();
                            const existingActor = (Array.isArray(actors) ? actors : actors.actors || [])
                                .find(a => a.attributes?.employeeId === inputEmployeeId);

                            if (existingActor && existingActor.status === 'deleted') {
                                // Archive the deleted actor by renaming its employeeId
                                console.log(`[register_employee] Found deleted actor ${existingActor._id}, archiving...`);
                                const archiveId = `${inputEmployeeId}_archived_${Date.now()}`;

                                const archiveResult = await platformClient.updateActor(existingActor._id, {
                                    attributes: {
                                        ...existingActor.attributes,
                                        employeeId: archiveId,
                                        originalEmployeeId: inputEmployeeId,
                                        archivedAt: new Date().toISOString()
                                    }
                                }, companyId);

                                if (archiveResult.success) {
                                    console.log(`[register_employee] Archived deleted actor, retrying creation...`);
                                    // Retry creation
                                    const retryResult = await platformClient.createActor(actorData, companyId);

                                    if (retryResult.success) {
                                        const retryActorId = retryResult.actorId;
                                        let retryBioUploaded = false;

                                        // Upload biometrics for retry actor
                                        if (Object.keys(imageData).length > 0 || Object.keys(embeddingData).length > 0) {
                                            try {
                                                const FormData = require('form-data');
                                                const axios = require('axios');
                                                const formData = new FormData();
                                                formData.append('companyId', companyId);

                                                for (const [pose, base64] of Object.entries(imageData)) {
                                                    const buffer = Buffer.from(base64, 'base64');
                                                    formData.append(pose, buffer, { filename: `${pose}.jpg`, contentType: 'image/jpeg' });
                                                }

                                                if (Object.keys(embeddingData).length > 0) {
                                                    const embVersion = Object.keys(embeddingData)[0];
                                                    const embData = embeddingData[embVersion];
                                                    if (embData && embData.data) {
                                                        formData.append('embeddingAttached', 'true');
                                                        formData.append('embeddingVersion', embVersion);
                                                        const embBuffer = Buffer.from(embData.data, 'base64');
                                                        formData.append('embedding', embBuffer, { filename: `${embVersion}.pkl`, contentType: 'application/octet-stream' });
                                                    }
                                                }

                                                const biometricsUrl = `${require('../config').PLATFORM_API_URL}/bharatlytics/v1/actors/${retryActorId}/biometrics`;
                                                const biometricsResponse = await axios.post(biometricsUrl, formData, {
                                                    headers: {
                                                        'Authorization': `Bearer ${platformToken}`,
                                                        'X-App-Id': 'vms_app_v1',
                                                        ...formData.getHeaders()
                                                    },
                                                    timeout: 30000
                                                });

                                                if (biometricsResponse.status === 200) {
                                                    console.log(`[register_employee] Biometrics uploaded for retry actor`);
                                                    retryBioUploaded = true;
                                                }
                                            } catch (bioErr) {
                                                console.error(`[register_employee] Error uploading biometrics for retry: ${bioErr.message}`);
                                            }
                                        }

                                        return res.status(201).json({
                                            status: 'success',
                                            message: 'Employee registered successfully on Platform',
                                            dataResidency: 'platform',
                                            actorId: retryActorId,
                                            employeeId: actorData.attributes.employeeId,
                                            hasBiometric: Object.keys(imageData).length > 0,
                                            biometricUploaded: retryBioUploaded,
                                            archivedPreviousActor: existingActor._id
                                        });
                                    }
                                }
                            }
                        }
                    } catch (archiveError) {
                        console.error(`[register_employee] Error archiving deleted actor: ${archiveError.message}`);
                    }

                    return res.status(409).json({
                        status: 'error',
                        error: 'Duplicate Employee',
                        message: 'An employee with this ID already exists on Platform',
                        dataResidency: 'platform'
                    });
                }
                res.status(500).json({
                    status: 'error',
                    error: 'Failed to register employee on Platform',
                    details: createResult.error
                });
            }
            return;
        }

        // ============ APP MODE: Create locally only ============
        console.log(`[register_employee] App mode - creating employee locally...`);

        // Archive deleted employees with same employeeId (App mode only)
        if (inputEmployeeId) {
            const deletedEmployees = await collections.employees().find({
                companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                employeeId: inputEmployeeId,
                status: 'deleted'
            }).toArray();

            for (const deletedEmployee of deletedEmployees) {
                const archiveId = `${inputEmployeeId}_archived_${deletedEmployee.deletedAt ? deletedEmployee.deletedAt.getTime() : Date.now()}`;
                const archiveEmail = deletedEmployee.email ? `${deletedEmployee.email}_archived_${Date.now()}` : null;
                console.log(`[register_employee] Archiving deleted employee ${deletedEmployee._id}`);

                await collections.employees().updateOne(
                    { _id: deletedEmployee._id },
                    {
                        $set: {
                            employeeId: archiveId,
                            email: archiveEmail,
                            originalEmployeeId: inputEmployeeId,
                            originalEmail: deletedEmployee.email,
                            archivedAt: new Date()
                        }
                    }
                );
            }
        }

        // Archive deleted employees with same email (App mode only)
        const inputEmail = data.email || data.employeeEmail;
        if (inputEmail) {
            const deletedByEmail = await collections.employees().find({
                companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
                email: inputEmail,
                status: 'deleted'
            }).toArray();

            for (const deletedEmployee of deletedByEmail) {
                const archiveId = deletedEmployee.employeeId ?
                    `${deletedEmployee.employeeId}_archived_${deletedEmployee.deletedAt ? deletedEmployee.deletedAt.getTime() : Date.now()}` :
                    `unknown_archived_${Date.now()}`;
                const archiveEmail = `${inputEmail}_archived_${Date.now()}`;

                await collections.employees().updateOne(
                    { _id: deletedEmployee._id },
                    {
                        $set: {
                            employeeId: archiveId,
                            email: archiveEmail,
                            originalEmployeeId: deletedEmployee.employeeId,
                            originalEmail: inputEmail,
                            archivedAt: new Date()
                        }
                    }
                );
            }
        }

        // Process face images to local GridFS (App mode only)
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

        // Handle base64 images (App mode only)
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

        // Process pre-calculated embedding (App mode only)
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
                console.log(`[register_employee] Stored embedding for ${version}`);
            } catch (e) {
                console.log(`[register_employee] Error processing embedding: ${e.message}`);
            }
        }

        // Build and create new employee document (App mode only)
        const employeeDoc = buildEmployeeDoc(data, imageDict, initialEmbeddingsDict);
        const result = await collections.employees().insertOne(employeeDoc);
        const employeeId = result.insertedId;

        // Queue embedding job if images exist (App mode only)
        if (Object.keys(imageDict).length > 0 && !initialEmbeddingsDict.buffalo_l) {
            await collections.embeddingJobs().insertOne({
                companyId: new ObjectId(companyId),
                employeeId,
                model: 'buffalo_l',
                status: 'queued',
                createdAt: new Date(),
                params: {}
            });

            await collections.employees().updateOne(
                { _id: employeeId },
                { $set: { 'employeeEmbeddings.buffalo_l': { status: 'queued', queuedAt: new Date() } } }
            );
        }

        // App mode: NO Platform sync
        res.status(201).json({
            status: 'success',
            message: 'Employee registered successfully',
            dataResidency: 'app',
            _id: employeeId.toString(),
            employeeId: employeeDoc.employeeId,
            embeddingStatus: Object.fromEntries(
                Object.entries(employeeDoc.employeeEmbeddings).map(([k, v]) => [k, v.status || 'unknown'])
            ),
            hasBiometric: Object.keys(imageDict).length > 0
        });
    } catch (error) {
        console.error('Error registering employee:', error);
        next(error);
    }
});

/**
 * PUT /api/employees/:employee_id
 * Update employee - residency-aware
 * Platform mode: Updates Platform directly
 * App mode: Updates local DB only, no Platform sync
 */
router.put('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;
        const data = req.body;
        const companyId = data.companyId;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ status: 'error', error: 'Invalid employee ID format' });
        }

        if (!companyId) {
            return res.status(400).json({ status: 'error', error: 'Company ID is required for residency-aware update' });
        }

        // Get platform token
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Check residency mode
        const { getResidencyMode } = require('../services/residency_detector');
        const residencyMode = await getResidencyMode(companyId, 'employee');
        console.log(`[update_employee] Company ${companyId}, residency mode: ${residencyMode}`);

        const updateFields = {};
        const allowedFields = ['employeeName', 'email', 'phone', 'designation', 'department', 'employeeId', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ status: 'error', error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        if (residencyMode === 'platform') {
            // Platform mode: update on Platform directly
            console.log(`[update_employee] Platform mode - updating employee ${employee_id} on Platform...`);

            if (!platformToken) {
                return res.status(401).json({
                    status: 'error',
                    error: 'Platform token required',
                    message: 'Employee data resides on Platform. Please provide a valid platform token.'
                });
            }

            const platformClient = createPlatformClient(companyId, platformToken);
            const existingEmployee = await platformClient.getEmployeeById(employee_id, companyId);

            if (!existingEmployee) {
                return res.status(404).json({ status: 'error', error: 'Employee not found on Platform' });
            }

            // Build Platform update payload
            const platformUpdate = {};
            if (updateFields.status) {
                platformUpdate.status = updateFields.status;
            }

            const attributeFields = ['employeeName', 'email', 'phone', 'designation', 'department', 'employeeId'];
            const attrUpdate = {};
            for (const field of attributeFields) {
                if (updateFields[field] !== undefined) {
                    const attrKey = field === 'employeeName' ? 'name' : field;
                    attrUpdate[attrKey] = updateFields[field];
                }
            }
            if (Object.keys(attrUpdate).length > 0) {
                platformUpdate.attributes = { ...existingEmployee.attributes, ...attrUpdate };
            }

            const updateResult = await platformClient.updateActor(employee_id, platformUpdate, companyId);

            if (updateResult.success) {
                res.json({
                    status: 'success',
                    message: 'Employee updated successfully on Platform',
                    dataResidency: 'platform',
                    actorId: employee_id
                });
            } else {
                res.status(500).json({
                    status: 'error',
                    error: 'Failed to update employee on Platform',
                    details: updateResult.error
                });
            }
        } else {
            // App mode: update local DB only, NO Platform sync
            console.log(`[update_employee] App mode - updating employee ${employee_id} in local DB...`);

            const result = await collections.employees().updateOne(
                { _id: new ObjectId(employee_id) },
                { $set: updateFields }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ status: 'error', error: 'Employee not found' });
            }

            res.json({
                status: 'success',
                message: 'Employee updated successfully',
                dataResidency: 'app'
            });
        }
    } catch (error) {
        console.error('Error updating employee:', error);
        next(error);
    }
});

/**
 * PATCH /api/employees/update
 * Update employee details - residency-aware: updates Platform or local DB based on mode
 */
router.patch('/update', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;
        const employeeId = data._id || data.employeeId;
        const companyId = data.companyId;

        if (!employeeId) {
            return res.status(400).json({ status: 'error', error: 'Employee ID (_id or employeeId) is required' });
        }

        if (!companyId) {
            return res.status(400).json({ status: 'error', error: 'Company ID is required' });
        }

        if (!isValidObjectId(employeeId)) {
            return res.status(400).json({ status: 'error', error: 'Invalid employee ID format' });
        }

        // Get platform token
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Check residency mode
        const { getResidencyMode } = require('../services/residency_detector');
        const residencyMode = await getResidencyMode(companyId, 'employee');
        console.log(`[update_employee] Company ${companyId}, residency mode: ${residencyMode}`);

        const updateFields = {};
        const allowedFields = ['employeeName', 'email', 'phone', 'designation', 'department', 'employeeId', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateFields[field] = data[field];
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ status: 'error', error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date().toISOString();

        if (residencyMode === 'platform') {
            // Platform mode: update directly on Platform
            console.log(`[update_employee] Updating employee ${employeeId} on Platform...`);

            const { createPlatformClient } = require('../services/platform_client');
            const platformClient = createPlatformClient(companyId, platformToken);

            // First check if employee exists on Platform
            const existingEmployee = await platformClient.getEmployeeById(employeeId, companyId);
            if (!existingEmployee) {
                return res.status(404).json({ status: 'error', error: 'Employee not found on Platform' });
            }

            // Build Platform update payload
            const platformUpdate = {};
            if (updateFields.status) {
                platformUpdate.status = updateFields.status;
            }

            // Put other fields in attributes
            const attributeFields = ['employeeName', 'email', 'phone', 'designation', 'department', 'employeeId'];
            const attrUpdate = {};
            for (const field of attributeFields) {
                if (updateFields[field] !== undefined) {
                    // Map VMS field names to Platform attribute names
                    const attrKey = field === 'employeeName' ? 'name' : field;
                    attrUpdate[attrKey] = updateFields[field];
                }
            }
            if (Object.keys(attrUpdate).length > 0) {
                platformUpdate.attributes = { ...existingEmployee.attributes, ...attrUpdate };
            }

            const updateResult = await platformClient.updateActor(employeeId, platformUpdate, companyId);

            if (updateResult.success) {
                res.json({
                    status: 'success',
                    message: 'Employee updated successfully on Platform',
                    dataResidency: 'platform',
                    actorId: employeeId
                });
            } else {
                res.status(500).json({
                    status: 'error',
                    error: 'Failed to update employee on Platform',
                    details: updateResult.error
                });
            }
        } else {
            // App mode: update local database only, NO Platform sync
            console.log(`[update_employee] Updating employee ${employeeId} in local DB...`);

            const employee = await collections.employees().findOne({ _id: new ObjectId(employeeId) });
            if (!employee) {
                return res.status(404).json({ status: 'error', error: 'Employee not found in local database' });
            }

            await collections.employees().updateOne(
                { _id: new ObjectId(employeeId) },
                { $set: updateFields }
            );

            res.json({
                status: 'success',
                message: 'Employee updated successfully',
                dataResidency: 'app'
            });
        }
    } catch (error) {
        console.error('Error updating employee:', error);
        next(error);
    }
});


/**
 * DELETE /api/employees/:employee_id
 * Soft delete employee - respects data residency
 * Platform mode: Updates status to 'deleted' on Platform
 * App mode: Soft deletes in local DB, optionally syncs to Platform
 */
router.delete('/:employee_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { employee_id } = req.params;
        const companyId = req.query.companyId || req.body.companyId;

        if (!isValidObjectId(employee_id)) {
            return res.status(400).json({ status: 'error', error: 'Invalid employee ID format' });
        }

        if (!companyId) {
            return res.status(400).json({ status: 'error', error: 'Company ID is required for residency-aware delete' });
        }

        // Get platform token
        let platformToken = req.headers['x-platform-token'] || req.session?.platformToken;
        if (!platformToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            platformToken = req.headers.authorization.substring(7);
        }

        // Check residency mode
        const { getResidencyMode } = require('../services/residency_detector');
        const residencyMode = await getResidencyMode(companyId, 'employee');
        console.log(`[delete_employee] Company ${companyId}, residency mode: ${residencyMode}`);

        if (residencyMode === 'platform') {
            // Platform mode: update status to 'deleted' AND archive employeeId on Platform
            console.log(`[delete_employee] Deleting employee ${employee_id} on Platform...`);

            const { createPlatformClient } = require('../services/platform_client');
            const platformClient = createPlatformClient(companyId, platformToken);

            // First check if employee exists on Platform
            const existingEmployee = await platformClient.getEmployeeById(employee_id, companyId);
            if (!existingEmployee) {
                return res.status(404).json({ status: 'error', error: 'Employee not found on Platform' });
            }

            // Archive the employeeId to allow future re-registration with same ID
            const originalEmployeeId = existingEmployee.attributes?.employeeId;
            const archiveId = originalEmployeeId ? `${originalEmployeeId}_archived_${Date.now()}` : null;
            const originalEmail = existingEmployee.attributes?.email;
            const archiveEmail = originalEmail ? `${originalEmail}_archived_${Date.now()}` : null;

            // Update status to deleted AND archive employeeId/email on Platform
            const platformUpdate = {
                status: 'deleted',
                attributes: {
                    ...existingEmployee.attributes,
                    employeeId: archiveId || existingEmployee.attributes?.employeeId,
                    email: archiveEmail || existingEmployee.attributes?.email,
                    originalEmployeeId: originalEmployeeId,
                    originalEmail: originalEmail,
                    deletedAt: new Date().toISOString(),
                    archivedAt: new Date().toISOString()
                }
            };

            console.log(`[delete_employee] Archiving: ${originalEmployeeId} -> ${archiveId}`);
            const deleteResult = await platformClient.updateActor(employee_id, platformUpdate, companyId);

            if (deleteResult.success) {
                res.json({
                    status: 'success',
                    message: 'Employee deleted and archived successfully on Platform',
                    dataResidency: 'platform',
                    actorId: employee_id,
                    archivedEmployeeId: archiveId
                });
            } else {
                res.status(500).json({
                    status: 'error',
                    error: 'Failed to delete employee on Platform',
                    details: deleteResult.error
                });
            }
        } else {
            // App mode: soft delete in local database only, NO Platform sync
            console.log(`[delete_employee] Soft deleting employee ${employee_id} in local DB...`);

            const employee = await collections.employees().findOne({ _id: new ObjectId(employee_id) });
            if (!employee) {
                return res.status(404).json({ status: 'error', error: 'Employee not found in local database' });
            }

            await collections.employees().updateOne(
                { _id: new ObjectId(employee_id) },
                {
                    $set: {
                        status: 'deleted',
                        deletedAt: new Date(),
                        lastUpdated: new Date()
                    }
                }
            );

            res.json({
                status: 'success',
                message: 'Employee deleted successfully',
                dataResidency: 'app'
            });
        }
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
            return res.status(400).json({ status: 'error', error: 'Invalid employee ID format' });
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
            return res.status(404).json({ status: 'error', error: 'Employee not found' });
        }

        res.json({ status: 'success', message: 'Employee blacklisted successfully' });
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
            return res.status(400).json({ status: 'error', error: 'Invalid employee ID format' });
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
            return res.status(404).json({ status: 'error', error: 'Employee not found' });
        }

        res.json({ status: 'success', message: 'Employee unblacklisted successfully' });
    } catch (error) {
        console.error('Error unblacklisting employee:', error);
        next(error);
    }
});



router.post('/attendance', requireCompanyAccess, async (req, res, next) => {
    try {
        // Support three input formats:
        // 1. Direct array: [{...}, {...}]
        // 2. Wrapped in records: { records: [{...}, {...}] }
        // 3. Single object: {...}
        let records;
        if (Array.isArray(req.body)) {
            // Direct array from Android app
            records = req.body;
        } else if (req.body.records && Array.isArray(req.body.records)) {
            // Wrapped in records property
            records = req.body.records;
        } else {
            // Single object - wrap in array
            records = [req.body];
        }

        if (!records || records.length === 0) {
            return res.status(400).json({ status: 'error', error: 'No attendance records provided' });
        }


        const results = [];
        const errors = [];

        for (const record of records) {
            try {
                // Validate required fields
                if (!record.employeeId) {
                    errors.push({ record, error: 'employeeId is required' });
                    continue;
                }

                // Parse attendance time
                const attendanceTime = record.attendanceTime ? new Date(record.attendanceTime) : new Date();
                const attendanceType = record.attendanceType || 'check_in';

                // Build query IDs
                const employeeOid = isValidObjectId(record.employeeId) ? new ObjectId(record.employeeId) : record.employeeId;
                const companyOid = isValidObjectId(record.companyId) ? new ObjectId(record.companyId) : record.companyId;

                // Check for duplicate: same employee, same attendanceType, within 1 minute window
                const duplicateWindow = new Date(attendanceTime.getTime());
                const windowStart = new Date(duplicateWindow.getTime() - 60000); // 1 minute before
                const windowEnd = new Date(duplicateWindow.getTime() + 60000); // 1 minute after

                const existingRecord = await collections.attendance().findOne({
                    $or: [
                        { employeeId: employeeOid },
                        { employeeId: record.employeeId }
                    ],
                    attendanceType: attendanceType,
                    attendanceTime: { $gte: windowStart, $lte: windowEnd }
                });

                if (existingRecord) {
                    results.push({
                        _id: existingRecord._id.toString(),
                        employeeId: record.employeeId,
                        attendanceType: attendanceType,
                        status: 'duplicate',
                        message: 'Record already exists within 1 minute window'
                    });
                    continue;
                }


                // Build document with all supported fields
                const doc = {
                    _id: new ObjectId(),
                    companyId: companyOid,
                    employeeId: employeeOid,

                    // Core attendance fields
                    personType: record.personType || 'employee',
                    attendanceTime: attendanceTime,
                    attendanceType: attendanceType,
                    shiftId: record.shiftId || null,


                    // Legacy fields (for backwards compatibility)
                    date: attendanceTime,
                    checkIn: attendanceType === 'check_in' || attendanceType === 'IN' ? attendanceTime : (record.checkIn ? new Date(record.checkIn) : null),
                    checkOut: attendanceType === 'check_out' || attendanceType === 'OUT' ? attendanceTime : (record.checkOut ? new Date(record.checkOut) : null),
                    status: record.status || 'present',


                    // Location data
                    location: record.location ? {
                        latitude: record.location.latitude || 0,
                        longitude: record.location.longitude || 0,
                        accuracy: record.location.accuracy || 0,
                        address: record.location.address || ''
                    } : null,

                    // Recognition/biometric data
                    recognition: record.recognition ? {
                        confidenceScore: record.recognition.confidenceScore || 0,
                        algorithm: record.recognition.algorithm || 'face_recognition_v2',
                        processingTime: record.recognition.processingTime || 0
                    } : null,

                    // Device info
                    device: record.device ? {
                        deviceId: record.device.deviceId || '',
                        platform: record.device.platform || 'android',
                        appVersion: record.device.appVersion || '',
                        ipAddress: record.device.ipAddress || ''
                    } : null,

                    // Sync and metadata
                    syncStatus: record.syncStatus || 1,
                    transactionFrom: record.transactionFrom || 'api',
                    remarks: record.remarks || '',

                    // Timestamps
                    createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
                    updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date()
                };

                await collections.attendance().insertOne(doc);
                results.push({
                    _id: doc._id.toString(),
                    employeeId: record.employeeId,
                    attendanceType: doc.attendanceType,
                    status: 'created'
                });
            } catch (recordError) {
                console.error(`Error processing attendance record:`, recordError);
                errors.push({
                    employeeId: record.employeeId,
                    error: recordError.message
                });
            }
        }

        // Return results
        if (results.length === 0 && errors.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'All records failed to process',
                errors
            });
        }

        res.status(201).json({
            status: 'success',
            message: `${results.length} attendance record(s) created`,
            records: results,
            errors: errors.length > 0 ? errors : undefined
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
