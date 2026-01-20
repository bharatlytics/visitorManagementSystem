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
    getCurrentUTC
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
 * Build employee document
 */
function buildEmployeeDoc(data, imageDict = {}, embeddingsDict = {}) {
    const companyId = isValidObjectId(data.companyId)
        ? new ObjectId(data.companyId)
        : data.companyId;

    return {
        _id: new ObjectId(),
        companyId,
        employeeId: data.employeeId || null,
        employeeName: data.employeeName,
        email: data.email || data.employeeEmail || null,
        phone: data.phone || data.employeeMobile || null,
        designation: data.designation || data.employeeDesignation || null,
        department: data.department || null,
        status: data.status || 'active',
        blacklisted: false,
        blacklistReason: null,
        employeeImages: imageDict,
        employeeEmbeddings: embeddingsDict,
        createdAt: new Date(),
        lastUpdated: new Date()
    };
}

// =============================================================================
// ROUTES
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
        const dataProvider = getDataProvider(companyId);
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

        res.json({ employees: convertObjectIds(employees) });
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

        res.status(201).json({
            message: 'Employee created successfully',
            _id: result.insertedId.toString(),
            employeeId: employeeDoc.employeeId
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

        // Build employee document
        const employeeDoc = buildEmployeeDoc(data, imageDict, {});
        const result = await collections.employees().insertOne(employeeDoc);
        const employeeId = result.insertedId;

        // Queue embedding job if images exist
        const embeddingsDict = {};
        if (Object.keys(imageDict).length > 0) {
            embeddingsDict.buffalo_l = {
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

            await collections.employees().updateOne(
                { _id: employeeId },
                { $set: { employeeEmbeddings: embeddingsDict } }
            );
        }

        res.status(201).json({
            message: 'Employee registered successfully',
            _id: employeeId.toString(),
            employeeId: employeeDoc.employeeId,
            embeddingStatus: Object.fromEntries(
                Object.entries(embeddingsDict).map(([k, v]) => [k, v.status || 'unknown'])
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
 * Download employee embedding file
 */
router.get('/embeddings/:embedding_id', async (req, res, next) => {
    try {
        const { embedding_id } = req.params;

        if (!isValidObjectId(embedding_id)) {
            return res.status(400).json({ error: 'Invalid embedding ID format' });
        }

        const bucket = getGridFSBucket('employeeEmbeddings');
        const downloadStream = bucket.openDownloadStream(new ObjectId(embedding_id));

        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename=${embedding_id}.npy`);

        downloadStream.pipe(res);

        downloadStream.on('error', () => {
            res.status(404).json({ error: 'Embedding not found' });
        });
    } catch (error) {
        console.error('Error serving embedding:', error);
        next(error);
    }
});

module.exports = router;
