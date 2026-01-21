/**
 * VMS Company Management Routes
 * 
 * Complete company management for standalone VMS operation:
 * - Get company details
 * - Create new company
 * - Update company settings
 * - Delete/deactivate company
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { requireAuth, requireCompanyAccess } = require('../middleware/auth');
const { collections } = require('../db');

/**
 * Convert ObjectIds to strings recursively
 */
function convertObjectIds(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof ObjectId) return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(convertObjectIds);
    if (typeof obj === 'object') {
        const result = {};
        for (const key in obj) {
            result[key] = convertObjectIds(obj[key]);
        }
        return result;
    }
    return obj;
}

/**
 * GET /api/company
 * Get current company details
 */
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const companyId = req.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'No company context' });
        }

        const result = await getCompanyDetails(companyId, req.session);
        if (result.error) {
            return res.status(result.status || 404).json({ error: result.error });
        }

        res.json({ company: result.company });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/company/:companyId
 * Get company details by ID
 */
router.get('/:companyId', async (req, res, next) => {
    try {
        const { companyId } = req.params;

        const result = await getCompanyDetails(companyId, req.session);
        if (result.error) {
            return res.status(result.status || 404).json({ error: result.error });
        }

        res.json({ company: result.company });
    } catch (error) {
        next(error);
    }
});

/**
 * Helper to get company details
 */
async function getCompanyDetails(companyId, session = {}) {
    if (!companyId || companyId === 'null' || companyId === 'undefined') {
        return { error: 'Invalid company ID', status: 400 };
    }

    let company = null;

    // Try local database
    try {
        if (ObjectId.isValid(companyId)) {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        }

        if (!company) {
            // Try by companyId field
            company = await collections.companies().findOne({
                $or: [
                    { companyId: companyId },
                    ObjectId.isValid(companyId) ? { companyId: new ObjectId(companyId) } : null
                ].filter(Boolean)
            });
        }
    } catch (e) {
        console.log(`[Company] Lookup error: ${e.message}`);
    }

    if (company) {
        return {
            company: convertObjectIds({
                _id: company._id,
                name: company.companyName || company.name,
                logo: company.logo,
                email: company.email,
                phone: company.phone,
                address: company.address,
                website: company.website,
                industry: company.industry,
                timezone: company.timezone || 'Asia/Kolkata',
                settings: company.settings || {},
                connected: Boolean(session?.platformToken),
                createdAt: company.createdAt,
                status: company.status || 'active'
            })
        };
    }

    // For connected mode, return placeholder
    if (session?.platformToken) {
        return {
            company: {
                _id: companyId,
                name: session.companyName || 'Connected Company',
                logo: session.companyLogo,
                connected: true
            }
        };
    }

    return { error: 'Company not found', status: 404 };
}

/**
 * POST /api/company
 * Create a new company
 */
router.post('/', async (req, res, next) => {
    try {
        const data = req.body || {};

        if (!data.companyName) {
            return res.status(400).json({ error: 'Company name is required' });
        }

        // Verify admin secret
        if (data.adminSecret !== '112233445566778899') {
            return res.status(403).json({ error: 'Invalid admin secret' });
        }

        // Check duplicate
        const existing = await collections.companies().findOne({
            $or: [
                { companyName: data.companyName },
                { name: data.companyName }
            ]
        });

        if (existing) {
            return res.status(409).json({ error: 'Company with this name already exists' });
        }

        const companyDoc = {
            _id: new ObjectId(),
            companyName: data.companyName,
            name: data.companyName,
            email: data.email || null,
            phone: data.phone || null,
            address: data.address || null,
            website: data.website || null,
            industry: data.industry || null,
            timezone: data.timezone || 'Asia/Kolkata',
            logo: data.logo || null,
            status: 'active',
            settings: {
                requireApproval: false,
                autoCheckoutHours: 8,
                badgeTemplate: 'default',
                notifications: {
                    email: true,
                    sms: false,
                    whatsapp: false
                },
                visitorTypes: ['guest', 'vendor', 'contractor', 'interview', 'vip']
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await collections.companies().insertOne(companyDoc);

        res.status(201).json({
            message: 'Company created successfully',
            company: convertObjectIds(companyDoc)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/company
 * Update company details
 */
router.patch('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const companyId = data.companyId || req.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        let company;
        try {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        } catch {
            company = await collections.companies().findOne({ companyId: companyId });
        }

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Build update
        const updateFields = { updatedAt: new Date() };
        const allowedFields = ['companyName', 'name', 'email', 'phone', 'address',
            'website', 'industry', 'timezone', 'logo'];

        for (const field of allowedFields) {
            if (field in data) {
                updateFields[field] = data[field];
                if (field === 'companyName') updateFields.name = data[field];
                if (field === 'name') updateFields.companyName = data[field];
            }
        }

        // Handle settings merge
        if (data.settings && typeof data.settings === 'object') {
            const currentSettings = company.settings || {};
            for (const key in data.settings) {
                if (typeof data.settings[key] === 'object' && typeof currentSettings[key] === 'object') {
                    currentSettings[key] = { ...currentSettings[key], ...data.settings[key] };
                } else {
                    currentSettings[key] = data.settings[key];
                }
            }
            updateFields.settings = currentSettings;
        }

        await collections.companies().updateOne(
            { _id: company._id },
            { $set: updateFields }
        );

        const updatedCompany = await collections.companies().findOne({ _id: company._id });

        res.json({
            message: 'Company updated successfully',
            company: convertObjectIds(updatedCompany)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/company/:companyId
 * Deactivate company (soft delete)
 */
router.delete('/:companyId', requireAuth, async (req, res, next) => {
    try {
        const { companyId } = req.params;
        const { adminSecret } = req.body || {};

        if (adminSecret !== '112233445566778899') {
            return res.status(403).json({ error: 'Admin secret required for deletion' });
        }

        let company;
        try {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        } catch {
            return res.status(400).json({ error: 'Invalid company ID' });
        }

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        await collections.companies().updateOne(
            { _id: new ObjectId(companyId) },
            {
                $set: {
                    status: 'inactive',
                    deactivatedAt: new Date(),
                    deactivatedBy: req.userId || 'admin'
                }
            }
        );

        res.json({ message: 'Company deactivated successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/company/settings
 * Get company VMS settings
 */
router.get('/settings', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        let company;
        try {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        } catch {
            company = await collections.companies().findOne({ companyId: companyId });
        }

        const defaultSettings = {
            requireApproval: false,
            autoCheckoutHours: 8,
            badgeTemplate: 'default',
            notifications: { email: true, sms: false, whatsapp: false },
            visitorTypes: ['guest', 'vendor', 'contractor', 'interview', 'vip']
        };

        res.json({
            settings: company?.settings || defaultSettings
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/company/settings
 * Update company VMS settings
 */
router.patch('/settings', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, settings } = req.body || {};

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Settings object is required' });
        }

        let company;
        try {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        } catch {
            company = await collections.companies().findOne({ companyId: companyId });
        }

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Merge settings
        const currentSettings = company.settings || {};
        for (const key in settings) {
            if (typeof settings[key] === 'object' && typeof currentSettings[key] === 'object') {
                currentSettings[key] = { ...currentSettings[key], ...settings[key] };
            } else {
                currentSettings[key] = settings[key];
            }
        }

        await collections.companies().updateOne(
            { _id: company._id },
            { $set: { settings: currentSettings, updatedAt: new Date() } }
        );

        res.json({
            message: 'Settings updated successfully',
            settings: currentSettings
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/company/stats
 * Get company statistics
 */
router.get('/stats', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        // Build query for both ObjectId and string formats
        let query;
        try {
            const cid = new ObjectId(companyId);
            query = { $or: [{ companyId: cid }, { companyId: companyId }] };
        } catch {
            query = { companyId: companyId };
        }

        const [visitorCount, employeeCount, deviceCount, userCount] = await Promise.all([
            collections.visitors().countDocuments(query),
            collections.employees().countDocuments(query),
            collections.devices().countDocuments(query),
            collections.users().countDocuments(query)
        ]);

        // Active visits today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const visitsToday = await collections.visits().countDocuments({
            ...query,
            expectedArrival: { $gte: todayStart }
        });

        const checkedIn = await collections.visits().countDocuments({
            ...query,
            status: 'checked_in'
        });

        res.json({
            stats: {
                visitors: visitorCount,
                employees: employeeCount,
                visitsToday,
                checkedIn,
                devices: deviceCount,
                users: userCount
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
