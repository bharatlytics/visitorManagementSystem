/**
 * Federated Query API for VMS
 * 
 * Exposes endpoints for the Bharatlytics Platform to query VMS data
 * when data residency is set to "App (Federated)".
 * 
 * Endpoints:
 * - GET /api/query/visitors - Query visitor data
 * - GET /api/query/employees - Query employee data
 * - GET /api/query/health - Health check
 * 
 * These endpoints are called by the Platform's federated query service
 * when another app needs data that VMS owns.
 * 
 * Matching Python app/api/federated_query.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');

const { getDb, getGridFSBucket } = require('../db');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');
const Config = require('../config');

// Platform secret for verifying tokens
const PLATFORM_SECRET = process.env.PLATFORM_SECRET || 'bharatlytics-platform-secret-2024';

/**
 * Verify that the request comes from the Bharatlytics Platform.
 */
function verifyPlatformRequest(req) {
    // Check for platform header
    if (!req.headers['x-platform-request']) {
        return { valid: false, error: 'Missing X-Platform-Request header' };
    }

    // Check for auth token
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'Missing or invalid Authorization header' };
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const payload = jwt.verify(token, PLATFORM_SECRET, {
            algorithms: ['HS256'],
            clockTolerance: 60, // 60 seconds leeway for clock skew
            audience: 'vms_app_v1'
        });

        // Verify it's a platform-issued federated query token
        if (payload.iss !== 'bharatlytics-platform') {
            return { valid: false, error: 'Invalid token issuer' };
        }

        if (payload.type !== 'federated_query') {
            return { valid: false, error: 'Invalid token type' };
        }

        return {
            valid: true,
            context: {
                companyId: payload.company_id,
                requestingApp: payload.sub,
                targetApp: payload.aud
            }
        };
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            console.log(`[FEDERATED] Token expired - Token: ${token.substring(0, 50)}...`);
            return { valid: false, error: 'Token expired' };
        }
        console.log(`[FEDERATED] Invalid token: ${err.message}`);
        return { valid: false, error: `Invalid token: ${err.message}` };
    }
}

/**
 * GET /api/query/visitors
 * Federated query endpoint for visitor data.
 * 
 * Query params:
 * - companyId: Required - Company ID
 * - status: Optional - Filter by status
 * - limit: Optional - Max results (default 100, cap 1000)
 * - offset: Optional - Pagination offset
 * - fields: Optional - Comma-separated list of fields
 * - includeEmbeddings: Optional - Include embedding metadata
 * - includeImages: Optional - Include images as base64
 */
router.get('/visitors', async (req, res, next) => {
    try {
        // Verify platform request
        const verification = verifyPlatformRequest(req);
        if (!verification.valid) {
            return res.status(401).json({ error: verification.error });
        }

        const ctx = verification.context;
        const companyId = req.query.companyId || ctx.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        // Parse query parameters
        const status = req.query.status;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const fields = req.query.fields ? req.query.fields.split(',') : null;
        const includeEmbeddings = req.query.includeEmbeddings === 'true';
        const includeImages = req.query.includeImages === 'true';

        // Build query
        const db = getDb();
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        if (status) {
            query.status = status;
        }

        // Build projection
        let projection = null;
        if (fields && fields.length > 0 && fields[0]) {
            projection = {};
            fields.forEach(f => projection[f] = 1);
            projection._id = 1;
            projection.companyId = 1;
        }

        // Query visitors
        const visitors = await db.collection('visitors')
            .find(query, { projection })
            .skip(offset)
            .limit(limit)
            .toArray();

        const totalCount = await db.collection('visitors').countDocuments(query);

        // Process visitors
        const processed = [];
        for (const visitor of visitors) {
            const visitorDict = convertObjectIds(visitor);

            const processedVisitor = {
                id: visitorDict._id,
                actorType: 'visitor',
                name: visitorDict.visitorName,
                phone: visitorDict.phone,
                email: visitorDict.email,
                status: visitorDict.status || 'active',
                blacklisted: visitorDict.blacklisted || false,
                companyId: companyId,
                metadata: {
                    organization: visitorDict.organization,
                    idType: visitorDict.idType,
                    idNumber: visitorDict.idNumber,
                    visitorType: visitorDict.visitorType
                }
            };

            // Handle images
            if (includeImages) {
                const images = visitor.visitorImages || {};
                let photoBase64 = null;

                for (const position of ['center', 'front', 'left', 'right']) {
                    if (images[position]) {
                        try {
                            const bucket = getGridFSBucket('visitorImages');
                            const imageId = isValidObjectId(images[position])
                                ? new ObjectId(images[position])
                                : images[position];

                            const chunks = [];
                            const stream = bucket.openDownloadStream(imageId);
                            for await (const chunk of stream) {
                                chunks.push(chunk);
                            }
                            const buffer = Buffer.concat(chunks);
                            photoBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                            break;
                        } catch (err) {
                            console.error(`[FederatedQuery] Error reading image: ${err.message}`);
                        }
                    }
                }

                processedVisitor.photo = photoBase64;
                processedVisitor.hasPhoto = !!photoBase64;
            } else {
                const images = visitor.visitorImages || {};
                processedVisitor.photoId = images.center ? String(images.center) : null;
                processedVisitor.hasPhoto = !!Object.keys(images).length;
            }

            // Handle embeddings
            if (includeEmbeddings && visitor.visitorEmbeddings) {
                const embeddings = visitor.visitorEmbeddings;
                processedVisitor.embeddings = {};

                for (const [model, embData] of Object.entries(embeddings)) {
                    if (typeof embData === 'object') {
                        processedVisitor.embeddings[model] = {
                            status: embData.status,
                            embeddingId: embData.embeddingId ? String(embData.embeddingId) : null
                        };
                    }
                }
                processedVisitor.embeddingModels = Object.keys(embeddings);
            }

            processed.push(processedVisitor);
        }

        res.json({
            data: processed,
            count: processed.length,
            totalCount,
            source: 'vms_app_v1',
            dataType: 'visitor',
            offset,
            limit
        });
    } catch (error) {
        console.error('Error in federated query visitors:', error);
        next(error);
    }
});

/**
 * GET /api/query/employees
 * Federated query endpoint for employee data.
 */
router.get('/employees', async (req, res, next) => {
    try {
        // Verify platform request
        const verification = verifyPlatformRequest(req);
        if (!verification.valid) {
            return res.status(401).json({ error: verification.error });
        }

        const ctx = verification.context;
        const companyId = req.query.companyId || ctx.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        const status = req.query.status;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const includeEmbeddings = req.query.includeEmbeddings === 'true';

        // Build query
        const db = getDb();
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        if (status) {
            query.status = status;
        }

        // Query employees
        const employees = await db.collection('employees')
            .find(query)
            .skip(offset)
            .limit(limit)
            .toArray();

        const totalCount = await db.collection('employees').countDocuments(query);

        // Process employees
        const processed = employees.map(emp => {
            const empDict = convertObjectIds(emp);

            const processedEmp = {
                id: empDict._id,
                actorType: 'employee',
                name: empDict.employeeName,
                phone: empDict.phone || empDict.employeePhone,
                email: empDict.email || empDict.employeeEmail,
                status: empDict.status || 'active',
                blacklisted: empDict.blacklisted || false,
                companyId,
                metadata: {
                    employeeId: empDict.employeeId,
                    department: empDict.department,
                    designation: empDict.designation
                }
            };

            // Handle embeddings
            if (includeEmbeddings && emp.employeeEmbeddings) {
                processedEmp.embeddings = {};
                for (const [model, embData] of Object.entries(emp.employeeEmbeddings)) {
                    if (typeof embData === 'object') {
                        processedEmp.embeddings[model] = {
                            status: embData.status,
                            embeddingId: embData.embeddingId ? String(embData.embeddingId) : null
                        };
                    }
                }
            }

            return processedEmp;
        });

        res.json({
            data: processed,
            count: processed.length,
            totalCount,
            source: 'vms_app_v1',
            dataType: 'employee',
            offset,
            limit
        });
    } catch (error) {
        console.error('Error in federated query employees:', error);
        next(error);
    }
});

/**
 * GET /api/query/health
 * Health check endpoint for verifying federated connectivity
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        app: 'vms_app_v1',
        endpoints: ['/api/query/visitors', '/api/query/employees', '/api/query/federation/actors']
    });
});

/**
 * GET /api/query/federation/actors
 * Unified federation endpoint for Platform routing.
 * 
 * This endpoint is called by the Platform when routing
 * federated requests based on installationMappings.residencyMode.
 * 
 * Query params:
 * - companyId: Required
 * - actorType: Required (visitor, employee)
 * - limit: Optional
 */
router.get('/federation/actors', async (req, res, next) => {
    const actorType = req.query.actorType;

    if (!actorType) {
        return res.status(400).json({ error: 'actorType is required' });
    }

    const companyId = req.query.companyId;
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    // Verify Authorization header exists (relaxed check for inter-app calls)
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const offset = parseInt(req.query.offset) || 0;

    try {
        const db = getDb();

        // Build companyId query
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }
        query.status = { $ne: 'archived' };

        let results = [];

        if (actorType === 'visitor') {
            const visitors = await db.collection('visitors')
                .find(query)
                .skip(offset)
                .limit(limit)
                .toArray();

            results = visitors.map(visitor => ({
                _id: String(visitor._id),
                actorType: 'visitor',
                name: visitor.visitorName,
                phone: visitor.phone,
                email: visitor.email,
                status: visitor.status || 'active',
                companyId: String(companyId),
                sourceApp: 'vms_app_v1',
                attributes: {
                    visitorName: visitor.visitorName,
                    phone: visitor.phone,
                    email: visitor.email,
                    organization: visitor.organization,
                    visitorType: visitor.visitorType,
                    idType: visitor.idType,
                    idNumber: visitor.idNumber
                },
                actorEmbeddings: convertObjectIds(visitor.visitorEmbeddings || {})
            }));

            console.log(`[federation] Returning ${results.length} visitors for company ${companyId}`);

        } else if (actorType === 'employee') {
            const employees = await db.collection('employees')
                .find(query)
                .skip(offset)
                .limit(limit)
                .toArray();

            results = employees.map(emp => ({
                _id: String(emp._id),
                actorType: 'employee',
                name: emp.employeeName,
                phone: emp.phone || emp.employeePhone,
                email: emp.email || emp.employeeEmail,
                status: emp.status || 'active',
                companyId: String(companyId),
                sourceApp: 'vms_app_v1',
                attributes: {
                    employeeName: emp.employeeName,
                    employeeId: emp.employeeId,
                    department: emp.department,
                    designation: emp.designation,
                    email: emp.email || emp.employeeEmail,
                    phone: emp.phone || emp.employeePhone
                },
                actorEmbeddings: convertObjectIds(emp.employeeEmbeddings || {})
            }));

            console.log(`[federation] Returning ${results.length} employees for company ${companyId}`);

        } else {
            return res.status(400).json({
                error: `Actor type ${actorType} not supported by VMS`,
                supportedTypes: ['visitor', 'employee']
            });
        }

        // Return array directly (matches Platform expected format)
        res.json(results);

    } catch (error) {
        console.error(`[federation] Error: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/query/attendance
 * Federated attendance query — returns attendance records for a company.
 * Called by PT via Platform federation forward (GET).
 *
 * Query params:
 *   companyId (required), startDate, endDate, employeeId, limit, skip
 *
 * Returns:
 *   { attendance: [...], summary: [...], total, dateRange }
 */
router.get('/attendance', async (req, res, next) => {
    // Relaxed auth (same as /federation/actors)
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    try {
        const companyId = req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        const db = getDb();
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        // Extend endDate to end of day
        endDate.setHours(23, 59, 59, 999);
        const limit = Math.min(parseInt(req.query.limit) || 5000, 10000);
        const skip = parseInt(req.query.skip) || 0;

        // Build company query (handle ObjectId or string)
        const companyMatch = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const query = {
            ...companyMatch,
            date: { $gte: startDate, $lte: endDate }
        };

        if (req.query.employeeId) {
            const eid = req.query.employeeId;
            query.employeeId = isValidObjectId(eid) ? new ObjectId(eid) : eid;
        }

        // Fetch raw records
        const records = await db.collection('attendance')
            .find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await db.collection('attendance').countDocuments(query);

        // Build per-person daily summary using aggregation
        const summaryPipeline = [
            { $match: query },
            // Resolve missing employeeName from employees collection
            {
                $lookup: {
                    from: 'employees',
                    localField: 'employeeId',
                    foreignField: '_id',
                    as: '_emp'
                }
            },
            {
                $addFields: {
                    employeeName: {
                        $ifNull: [
                            '$employeeName',
                            { $arrayElemAt: ['$_emp.employeeName', 0] }
                        ]
                    }
                }
            },
            { $project: { _emp: 0 } },
            {
                $group: {
                    _id: {
                        employeeId: '$employeeId',
                        day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
                    },
                    employeeName: { $first: '$employeeName' },
                    personType: { $first: '$personType' },
                    firstIn: { $min: '$date' },
                    lastOut: { $max: '$date' },
                    logCount: { $sum: 1 },
                    logs: {
                        $push: {
                            attendanceType: '$attendanceType',
                            time: '$date',
                            cameraName: { $ifNull: ['$cameraName', { $ifNull: ['$recognition.cameraName', null] }] },
                            confidence: { $ifNull: ['$confidence', { $ifNull: ['$recognition.confidenceScore', null] }] },
                            faceImage: { $ifNull: ['$faceImage', null] },
                            transactionFrom: { $ifNull: ['$transactionFrom', null] },
                            devicePlatform: { $ifNull: ['$device.platform', null] }
                        }
                    }
                }
            },
            {
                $addFields: {
                    hoursLogged: {
                        $divide: [{ $subtract: ['$lastOut', '$firstIn'] }, 3600000]
                    }
                }
            },
            { $sort: { '_id.day': -1, 'firstIn': -1 } }
        ];

        const summary = await db.collection('attendance')
            .aggregate(summaryPipeline)
            .toArray();

        // Post-aggregation: resolve any still-unknown names via employeeInfo or actors
        const unknownSummaries = summary.filter(s => !s.employeeName);
        if (unknownSummaries.length > 0) {
            const unknownIds = unknownSummaries.map(s => s._id.employeeId).filter(Boolean);
            // Try employeeInfo collection (legacy)
            const empInfos = await db.collection('employeeInfo')
                .find({ _id: { $in: unknownIds } })
                .project({ employeeName: 1 })
                .toArray();
            const infoMap = {};
            for (const e of empInfos) infoMap[String(e._id)] = e.employeeName;
            for (const s of unknownSummaries) {
                const eid = String(s._id.employeeId);
                if (infoMap[eid]) s.employeeName = infoMap[eid];
            }
        }

        // Format summary
        const formattedSummary = summary.map(s => ({
            employeeId: s._id.employeeId ? String(s._id.employeeId) : null,
            date: s._id.day,
            employeeName: s.employeeName || 'Unknown',
            personType: s.personType || 'EMPLOYEE',
            firstIn: s.firstIn,
            lastOut: s.lastOut,
            hoursLogged: Math.round((s.hoursLogged || 0) * 100) / 100,
            logCount: s.logCount,
            logs: s.logs.sort((a, b) => new Date(a.time) - new Date(b.time))
        }));

        // Convert ObjectIds in raw records
        const formattedRecords = records.map(r => convertObjectIds(r));

        res.json({
            attendance: formattedRecords,
            summary: formattedSummary,
            total,
            dateRange: { startDate, endDate },
            source: 'vms_app_v1'
        });

        console.log(`[federated-attendance] GET: returned ${records.length} records, ${formattedSummary.length} summaries for company ${companyId}`);

    } catch (error) {
        console.error(`[federated-attendance] GET error: ${error.message}`);
        next(error);
    }
});

/**
 * POST /api/query/attendance
 * Federated attendance endpoint — receives attendance records from Platform.
 * 
 * Called by Platform when forwarding attendance data from PeopleTracking.
 * Uses relaxed auth check (same as /federation/actors).
 * 
 * Body:
 * {
 *   "companyId": "...",
 *   "sourceApp": "people_tracking_app_v1",
 *   "records": [
 *     { "actorId", "name", "actorType", "attendanceTime", "attendanceType", "cameraName", "confidence" }
 *   ]
 * }
 */
router.post('/attendance', async (req, res, next) => {
    // Relaxed auth check for inter-app calls (same as /federation/actors)
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    try {
        const { companyId, sourceApp, records } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ error: 'records array is required' });
        }

        const db = getDb();
        const attendanceCollection = db.collection('attendance');
        const now = new Date();

        // Build company ID query helper
        const companyQuery = isValidObjectId(companyId)
            ? new ObjectId(companyId)
            : companyId;

        const insertedRecords = [];

        for (const record of records) {
            const {
                actorId,
                name,
                actorType,
                attendanceTime,
                attendanceType,
                cameraName,
                confidence,
                faceImage
            } = record;

            if (!actorId || !attendanceTime) {
                console.warn(`[federated-attendance] Skipping record: missing actorId or attendanceTime`);
                continue;
            }

            const recordDate = new Date(attendanceTime);

            // Look up local employee/visitor by actorId 
            // (actorId may be a Platform actor ID or a VMS-local _id)
            let employeeId = null;
            let employeeName = name || 'Unknown';

            if (actorType === 'employee') {
                // Try to find employee in VMS
                let employee = null;
                if (isValidObjectId(actorId)) {
                    employee = await db.collection('employees').findOne({
                        $or: [
                            { _id: new ObjectId(actorId) },
                            { platformActorId: actorId }
                        ],
                        companyId: companyQuery
                    });
                }
                if (!employee) {
                    // Fallback: search by name
                    employee = await db.collection('employees').findOne({
                        employeeName: name,
                        companyId: companyQuery
                    });
                }
                if (employee) {
                    employeeId = employee._id;  // Always ObjectId
                    employeeName = employee.employeeName || name;
                }
            }

            // If employeeId not found, try to convert actorId to ObjectId
            if (!employeeId) {
                employeeId = isValidObjectId(actorId) ? new ObjectId(actorId) : new ObjectId();
            }

            const attendanceRecord = {
                companyId: companyQuery,
                employeeId,                              // ObjectId (matches canonical schema)
                employeeName,
                personType: (actorType || 'employee').toUpperCase(),  // "EMPLOYEE" / "VISITOR"
                attendanceTime: recordDate,               // Exact detection timestamp
                attendanceType: attendanceType || 'IN',   // "IN" / "OUT"
                shiftId: null,
                date: recordDate,
                checkIn: (attendanceType || 'IN') === 'IN' ? recordDate : null,
                checkOut: (attendanceType || 'IN') === 'OUT' ? recordDate : null,
                status: 'present',
                // Canonical fields expected by Android app / VMS frontend
                location: {
                    latitude: null,
                    longitude: null,
                    accuracy: null,
                    address: ''
                },
                recognition: {
                    confidenceScore: confidence || null,
                    algorithm: 'face_recognition_v2',
                    processingTime: null,
                    // Extra face-rec metadata
                    cameraName: cameraName || null,
                },
                device: {
                    deviceId: cameraName || 'CCTV',
                    platform: 'cctv',
                    appVersion: '1.0.0',
                    ipAddress: ''
                },
                syncStatus: 1,
                transactionFrom: 'face_recognition',
                remarks: '',
                // Face recognition extras (not in Android schema, but safe to add)
                platformActorId: actorId,
                source: 'face_recognition',
                sourceApp: sourceApp || 'people_tracking_app_v1',
                cameraName: cameraName || null,
                confidence: confidence || null,
                faceImage: faceImage || null,
                createdAt: now,
                updatedAt: now
            };

            insertedRecords.push(attendanceRecord);
        }

        if (insertedRecords.length > 0) {
            const result = await attendanceCollection.insertMany(insertedRecords);
            console.log(`[federated-attendance] Inserted ${result.insertedCount} record(s) for company ${companyId}`);

            res.status(201).json({
                success: true,
                inserted: result.insertedCount,
                message: `${result.insertedCount} attendance record(s) saved`
            });
        } else {
            res.status(200).json({
                success: true,
                inserted: 0,
                message: 'No valid records to insert'
            });
        }

    } catch (error) {
        console.error(`[federated-attendance] Error: ${error.message}`);
        next(error);
    }
});

module.exports = router;
