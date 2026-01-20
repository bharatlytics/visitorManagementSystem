/**
 * Pre-registration API
 * Visitor pre-registration management
 * Matching Python app/api/preregistration.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId, validateRequiredFields, validateEmailFormat, validatePhoneFormat } = require('../utils/helpers');

/**
 * GET /api/preregistration
 * List pre-registrations for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const status = req.query.status;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const db = getDb();
        let query = {};

        if (isValidObjectId(companyId)) {
            query.companyId = new ObjectId(companyId);
        } else {
            query.companyId = companyId;
        }

        if (status) {
            query.status = status;
        }

        if (startDate || endDate) {
            query.expectedArrival = {};
            if (startDate) query.expectedArrival.$gte = startDate;
            if (endDate) query.expectedArrival.$lte = endDate;
        }

        const preregistrations = await db.collection('preregistrations')
            .find(query)
            .sort({ expectedArrival: 1 })
            .toArray();

        res.json({ preregistrations: convertObjectIds(preregistrations) });
    } catch (error) {
        console.error('Error listing preregistrations:', error);
        next(error);
    }
});

/**
 * POST /api/preregistration
 * Create a new pre-registration
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        const validation = validateRequiredFields(data, ['companyId', 'visitorName', 'hostEmployeeId', 'expectedArrival']);
        if (!validation.valid) {
            return res.status(400).json({ error: `Missing required fields: ${validation.missing.join(', ')}` });
        }

        // Validate email/phone if provided
        if (data.email && !validateEmailFormat(data.email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (data.phone && !validatePhoneFormat(data.phone)) {
            return res.status(400).json({ error: 'Invalid phone format' });
        }

        const db = getDb();
        const preregDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId,
            visitorName: data.visitorName,
            phone: data.phone || null,
            email: data.email || null,
            organization: data.organization || null,
            visitorType: data.visitorType || 'guest',
            hostEmployeeId: isValidObjectId(data.hostEmployeeId) ? new ObjectId(data.hostEmployeeId) : data.hostEmployeeId,
            hostEmployeeName: data.hostEmployeeName || null,
            purpose: data.purpose || null,
            expectedArrival: new Date(data.expectedArrival),
            expectedDeparture: data.expectedDeparture ? new Date(data.expectedDeparture) : null,
            numberOfPersons: data.numberOfPersons || 1,
            vehicleNumber: data.vehicleNumber || null,
            belongings: data.belongings || [],
            accessAreas: (data.accessAreas || []).filter(id => isValidObjectId(id)).map(id => new ObjectId(id)),
            notes: data.notes || null,
            status: 'pending', // pending, confirmed, checked_in, cancelled, expired
            confirmationCode: generateConfirmationCode(),
            createdBy: data.createdBy || 'system',
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await db.collection('preregistrations').insertOne(preregDoc);

        res.status(201).json({
            message: 'Pre-registration created successfully',
            _id: preregDoc._id.toString(),
            confirmationCode: preregDoc.confirmationCode,
            preregistration: convertObjectIds(preregDoc)
        });
    } catch (error) {
        console.error('Error creating preregistration:', error);
        next(error);
    }
});

/**
 * GET /api/preregistration/:prereg_id
 * Get single pre-registration
 */
router.get('/:prereg_id', async (req, res, next) => {
    try {
        const { prereg_id } = req.params;

        const db = getDb();
        let prereg;

        // Try by ObjectId first
        if (isValidObjectId(prereg_id)) {
            prereg = await db.collection('preregistrations').findOne({ _id: new ObjectId(prereg_id) });
        }

        // Fallback to confirmation code
        if (!prereg) {
            prereg = await db.collection('preregistrations').findOne({ confirmationCode: prereg_id });
        }

        if (!prereg) {
            return res.status(404).json({ error: 'Pre-registration not found' });
        }

        res.json({ preregistration: convertObjectIds(prereg) });
    } catch (error) {
        console.error('Error getting preregistration:', error);
        next(error);
    }
});

/**
 * PUT /api/preregistration/:prereg_id
 * Update pre-registration
 */
router.put('/:prereg_id', requireCompanyAccess, async (req, res, next) => {
    try {
        const { prereg_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(prereg_id)) {
            return res.status(400).json({ error: 'Invalid pre-registration ID format' });
        }

        const updateFields = {};
        const allowedFields = ['visitorName', 'phone', 'email', 'organization', 'visitorType', 'purpose', 'expectedArrival', 'expectedDeparture', 'numberOfPersons', 'vehicleNumber', 'belongings', 'notes', 'status'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'expectedArrival' || field === 'expectedDeparture') {
                    updateFields[field] = new Date(data[field]);
                } else {
                    updateFields[field] = data[field];
                }
            }
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.lastUpdated = new Date();

        const db = getDb();
        const result = await db.collection('preregistrations').updateOne(
            { _id: new ObjectId(prereg_id) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Pre-registration not found' });
        }

        res.json({ message: 'Pre-registration updated successfully' });
    } catch (error) {
        console.error('Error updating preregistration:', error);
        next(error);
    }
});

/**
 * POST /api/preregistration/:prereg_id/confirm
 * Confirm a pre-registration
 */
router.post('/:prereg_id/confirm', async (req, res, next) => {
    try {
        const { prereg_id } = req.params;

        const db = getDb();
        let query;

        if (isValidObjectId(prereg_id)) {
            query = { _id: new ObjectId(prereg_id) };
        } else {
            query = { confirmationCode: prereg_id };
        }

        const result = await db.collection('preregistrations').updateOne(
            { ...query, status: 'pending' },
            { $set: { status: 'confirmed', confirmedAt: new Date(), lastUpdated: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Pre-registration not found or already confirmed' });
        }

        res.json({ message: 'Pre-registration confirmed successfully' });
    } catch (error) {
        console.error('Error confirming preregistration:', error);
        next(error);
    }
});

/**
 * POST /api/preregistration/:prereg_id/cancel
 * Cancel a pre-registration
 */
router.post('/:prereg_id/cancel', requireCompanyAccess, async (req, res, next) => {
    try {
        const { prereg_id } = req.params;
        const { reason } = req.body;

        if (!isValidObjectId(prereg_id)) {
            return res.status(400).json({ error: 'Invalid pre-registration ID format' });
        }

        const db = getDb();
        const result = await db.collection('preregistrations').updateOne(
            { _id: new ObjectId(prereg_id), status: { $in: ['pending', 'confirmed'] } },
            {
                $set: {
                    status: 'cancelled',
                    cancelledAt: new Date(),
                    cancellationReason: reason || null,
                    lastUpdated: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Pre-registration not found or already processed' });
        }

        res.json({ message: 'Pre-registration cancelled successfully' });
    } catch (error) {
        console.error('Error cancelling preregistration:', error);
        next(error);
    }
});

/**
 * POST /api/preregistration/:prereg_id/convert
 * Convert pre-registration to actual visit
 */
router.post('/:prereg_id/convert', requireCompanyAccess, async (req, res, next) => {
    try {
        const { prereg_id } = req.params;

        if (!isValidObjectId(prereg_id)) {
            return res.status(400).json({ error: 'Invalid pre-registration ID format' });
        }

        const db = getDb();
        const prereg = await db.collection('preregistrations').findOne({ _id: new ObjectId(prereg_id) });

        if (!prereg) {
            return res.status(404).json({ error: 'Pre-registration not found' });
        }

        if (prereg.status === 'checked_in') {
            return res.status(400).json({ error: 'Already converted to visit' });
        }

        // Check if visitor exists, else create
        let visitor = await collections.visitors().findOne({
            companyId: prereg.companyId,
            phone: prereg.phone
        });

        if (!visitor) {
            const visitorDoc = {
                _id: new ObjectId(),
                companyId: prereg.companyId,
                visitorName: prereg.visitorName,
                phone: prereg.phone,
                email: prereg.email,
                organization: prereg.organization,
                visitorType: prereg.visitorType,
                hostEmployeeId: prereg.hostEmployeeId,
                status: 'active',
                createdAt: new Date(),
                lastUpdated: new Date()
            };
            await collections.visitors().insertOne(visitorDoc);
            visitor = visitorDoc;
        }

        // Create visit
        const visitDoc = {
            _id: new ObjectId(),
            visitorId: visitor._id,
            companyId: prereg.companyId,
            hostEmployeeId: prereg.hostEmployeeId,
            hostEmployeeName: prereg.hostEmployeeName,
            visitorName: prereg.visitorName,
            visitorMobile: prereg.phone,
            purpose: prereg.purpose,
            expectedArrival: prereg.expectedArrival,
            expectedDeparture: prereg.expectedDeparture,
            numberOfPersons: prereg.numberOfPersons,
            vehicleNumber: prereg.vehicleNumber,
            belongings: prereg.belongings,
            accessAreas: prereg.accessAreas,
            status: 'scheduled',
            preregistrationId: prereg._id,
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await collections.visits().insertOne(visitDoc);

        // Update pre-registration status
        await db.collection('preregistrations').updateOne(
            { _id: new ObjectId(prereg_id) },
            { $set: { status: 'checked_in', visitId: visitDoc._id, lastUpdated: new Date() } }
        );

        res.json({
            message: 'Pre-registration converted to visit',
            visitId: visitDoc._id.toString(),
            visitorId: visitor._id.toString()
        });
    } catch (error) {
        console.error('Error converting preregistration:', error);
        next(error);
    }
});

// Helper function to generate confirmation code
function generateConfirmationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

module.exports = router;
