/**
 * Settings API
 * App settings management
 * Matching Python app/api/settings.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/settings
 * Get all settings for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
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

        const settings = await collections.settings().findOne(query);

        // Return defaults if not found
        const defaultSettings = {
            companyId,
            general: {
                companyName: '',
                companyLogo: '',
                timezone: 'Asia/Kolkata',
                dateFormat: 'DD/MM/YYYY',
                timeFormat: '12h'
            },
            visitor: {
                requirePhoto: true,
                requireIdVerification: false,
                autoCheckoutHours: 8,
                preRegistrationEnabled: true,
                groupVisitsEnabled: true
            },
            notifications: {
                emailEnabled: true,
                smsEnabled: false,
                pushEnabled: true,
                hostNotifyOnArrival: true,
                hostNotifyOnCheckout: false
            },
            security: {
                watchlistEnabled: true,
                blacklistAutoReject: true,
                requireApprovalForVIP: false
            },
            branding: {
                primaryColor: '#1976d2',
                logoUrl: '',
                kioskWelcomeMessage: 'Welcome! Please check in.'
            },
            smtp: {
                host: '',
                port: 587,
                secure: false,
                user: '',
                password: '',
                fromEmail: ''
            },
            integrations: {
                whatsappEnabled: false,
                whatsappPhoneId: '',
                whatsappApiKey: '',
                whatsappBusinessAccountId: '',
                smsEnabled: false,
                smsProvider: 'twilio',
                smsApiKey: '',
                smsSenderId: '',
                webhookEnabled: false,
                webhookUrl: '',
                webhookSecret: '',
                webhookEvents: ['check_in', 'check_out', 'visitor_registered']
            },
            kiosk: {
                welcomeMessage: 'Welcome! Please check in.',
                primaryColor: '#1976d2',
                logoUrl: '',
                autoLogoutMinutes: 2,
                allowedVisitTypes: ['general', 'contractor', 'interview'],
                requirePhotoOnKiosk: true,
                showHostDirectory: true,
                enableSelfCheckIn: true
            },
            compliance: {
                gdprEnabled: false,
                gdprConsentText: 'By checking in, you agree to our privacy policy and data handling practices.',
                dataRetentionDays: 365,
                autoAnonymize: false,
                auditLogging: true,
                exportDataFormat: 'csv'
            }
        };

        res.json({ settings: settings ? convertObjectIds(settings) : defaultSettings });
    } catch (error) {
        console.error('Error fetching settings:', error);
        next(error);
    }
});

/**
 * PUT /api/settings
 * Update settings
 */
router.put('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;
        const companyId = data.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyOid = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;

        // Build update object from nested settings
        const updateFields = {
            companyId: companyOid,
            lastUpdated: new Date()
        };

        const settingsCategories = ['general', 'visitor', 'notifications', 'security', 'branding', 'smtp', 'integrations', 'kiosk', 'compliance'];
        for (const category of settingsCategories) {
            if (data[category]) {
                updateFields[category] = data[category];
            }
        }

        await collections.settings().updateOne(
            { companyId: companyOid },
            { $set: updateFields },
            { upsert: true }
        );

        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        next(error);
    }
});

/**
 * GET /api/settings/:category
 * Get specific settings category
 */
router.get('/:category', requireCompanyAccess, async (req, res, next) => {
    try {
        const { category } = req.params;
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const validCategories = ['general', 'visitor', 'notifications', 'security', 'branding', 'smtp', 'integrations', 'kiosk', 'compliance'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: `Invalid category. Valid categories: ${validCategories.join(', ')}` });
        }

        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const settings = await collections.settings().findOne(query);

        res.json({ [category]: settings?.[category] || {} });
    } catch (error) {
        console.error('Error fetching settings category:', error);
        next(error);
    }
});

/**
 * PATCH /api/settings/:category
 * Update specific settings category
 */
router.patch('/:category', requireCompanyAccess, async (req, res, next) => {
    try {
        const { category } = req.params;
        const data = req.body;
        const companyId = data.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const validCategories = ['general', 'visitor', 'notifications', 'security', 'branding', 'smtp', 'integrations', 'kiosk', 'compliance'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: `Invalid category. Valid categories: ${validCategories.join(', ')}` });
        }

        const companyOid = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;

        await collections.settings().updateOne(
            { companyId: companyOid },
            {
                $set: {
                    [category]: data,
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );

        res.json({ message: `${category} settings updated successfully` });
    } catch (error) {
        console.error('Error updating settings category:', error);
        next(error);
    }
});

/**
 * POST /api/settings/test-email
 * Send a test email to verify SMTP configuration
 */
router.post('/test-email', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, toEmail } = req.body;

        if (!companyId || !toEmail) {
            return res.status(400).json({ error: 'Company ID and email address are required.' });
        }

        const { sendTestEmail } = require('../services/email_service');
        const result = await sendTestEmail(companyId, toEmail);

        if (result.success) {
            res.json({
                success: true,
                message: 'Test email sent successfully',
                messageId: result.messageId
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error || 'Failed to send test email'
            });
        }
    } catch (error) {
        console.error('Error sending test email:', error);
        next(error);
    }
});

module.exports = router;
