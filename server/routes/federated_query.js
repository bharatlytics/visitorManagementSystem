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
        endpoints: ['/api/query/visitors', '/api/query/employees']
    });
});

module.exports = router;
