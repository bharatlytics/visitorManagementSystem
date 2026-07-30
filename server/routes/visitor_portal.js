/**
 * Visitor Portal API
 * Public, unauthenticated endpoints for visitor-facing portal
 * Serves visit details, NDA instructions, schedule, and status
 * Token-based access — no login required
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

// Default NDA/Safety rules (used if company hasn't configured custom ones)
const DEFAULT_NDA_RULES = [
    { key: 'ppe', text: 'I will wear mandated Personal Protective Equipment (Helmet/Safety Shoes) in operational zones.' },
    { key: 'noPhoto', text: 'I understand photography or recording without written approval is strictly prohibited.' },
    { key: 'escortRequired', text: 'I will remain escorted by host personnel in restricted production areas at all times.' },
    { key: 'emergencyExit', text: 'In case of fire/alarm, I will follow safety marshals to designated muster assembly points.' }
];

const DEFAULT_NDA_DISCLOSURE = `By signing this Non-Disclosure Agreement, you acknowledge and agree that:

1. All information shared during your visit, including but not limited to business operations, technical processes, employee information, and proprietary systems, is strictly confidential.

2. You shall not disclose, reproduce, or distribute any confidential information to third parties without prior written consent from the company.

3. Any materials, documents, or digital assets provided during the visit must be returned upon departure.

4. Violation of this agreement may result in legal action and permanent restriction from future visits.

5. This agreement remains in effect for a period of 2 years from the date of signing.`;

/**
 * GET /api/visitor-portal/:token
 * Public endpoint — returns visit details for the visitor's custom portal page
 * Token can be a visitorPortalToken (from visit or preregistration)
 */
router.get('/:token', async (req, res, next) => {
    try {
        const { token } = req.params;

        const db = getDb();

        // Search for the visit by visitorPortalToken
        let visit = await collections.visits().findOne({ visitorPortalToken: token });

        // If not found on visit, search preregistrations
        let prereg = null;
        if (!visit) {
            prereg = await db.collection('preregistrations').findOne({ visitorPortalToken: token });
            if (prereg && prereg.visitId) {
                visit = await collections.visits().findOne({ _id: prereg.visitId instanceof ObjectId ? prereg.visitId : new ObjectId(prereg.visitId) });
            }
        }

        // If we have a preregistration but no visit yet, show pre-visit portal
        if (!visit && !prereg) {
            return res.status(404).json({
                error: 'Portal link not found or has expired',
                expired: false
            });
        }

        // Check 7-day expiration after checkout
        if (visit && visit.status === 'checked_out' && visit.actualDeparture) {
            const checkoutDate = new Date(visit.actualDeparture);
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const now = new Date();
            if (now - checkoutDate > sevenDaysMs) {
                return res.status(410).json({
                    error: 'This visit portal has expired. Visit records older than 7 days are archived.',
                    expired: true,
                    visitorName: visit.visitorName,
                    checkoutDate: visit.actualDeparture
                });
            }
        }

        // Get company settings for branding and custom NDA
        let companySettings = null;
        const companyId = visit?.companyId || prereg?.companyId;
        if (companyId) {
            let settingsQuery;
            if (companyId instanceof ObjectId) {
                settingsQuery = { $or: [{ companyId }, { companyId: companyId.toString() }] };
            } else if (isValidObjectId(String(companyId))) {
                settingsQuery = { $or: [{ companyId: new ObjectId(String(companyId)) }, { companyId: String(companyId) }] };
            } else {
                settingsQuery = { companyId: String(companyId) };
            }
            companySettings = await collections.settings().findOne(settingsQuery);
        }

        // Build company info
        const companyInfo = {
            name: companySettings?.general?.companyName || 'Company',
            logo: companySettings?.branding?.logoUrl || '',
            primaryColor: companySettings?.branding?.primaryColor || '#1976d2'
        };

        // Build NDA configuration (custom or default)
        const ndaConfig = {
            disclosureText: companySettings?.nda?.disclosureText || DEFAULT_NDA_DISCLOSURE,
            safetyRules: companySettings?.nda?.safetyRules || DEFAULT_NDA_RULES,
            requireSignature: companySettings?.nda?.requireSignature !== false
        };

        // Build status timeline
        const timeline = [];
        if (prereg && !visit) {
            // Pre-registration state — no visit yet
            timeline.push({ status: 'invited', label: 'Invited', active: true, timestamp: prereg.createdAt });
            timeline.push({ status: 'registration', label: 'Registration Pending', active: false });
            timeline.push({ status: 'scheduled', label: 'Visit Scheduled', active: false });
            timeline.push({ status: 'checked_in', label: 'Checked In', active: false });
            timeline.push({ status: 'completed', label: 'Visit Completed', active: false });
        } else if (visit) {
            const s = visit.status;
            timeline.push({ status: 'invited', label: 'Invited', active: true, timestamp: visit.createdAt });
            timeline.push({ status: 'nda_signed', label: 'NDA Signed', active: !!visit.ndaSigned, timestamp: visit.ndaSignedAt });
            timeline.push({ status: 'scheduled', label: 'Visit Scheduled', active: ['scheduled', 'checked_in', 'checked_out'].includes(s), timestamp: visit.createdAt });
            timeline.push({ status: 'checked_in', label: 'Checked In', active: ['checked_in', 'checked_out'].includes(s), timestamp: visit.actualArrival });
            timeline.push({ status: 'completed', label: 'Visit Completed', active: s === 'checked_out', timestamp: visit.actualDeparture });
        }

        // Build response
        const portalData = {
            company: companyInfo,
            nda: ndaConfig,
            timeline,
            visit: visit ? {
                id: visit._id.toString(),
                status: visit.status,
                visitorName: visit.visitorName,
                hostEmployeeName: visit.hostEmployeeName,
                hostDepartment: visit.hostDepartment || null,
                purpose: visit.purpose,
                visitType: visit.visitType,
                expectedArrival: visit.expectedArrival,
                expectedDeparture: visit.expectedDeparture,
                actualArrival: visit.actualArrival,
                actualDeparture: visit.actualDeparture,
                locationName: visit.locationName || null,
                vehicleNumber: visit.vehicleNumber,
                numberOfPersons: visit.numberOfPersons || 1,
                ndaSigned: visit.ndaSigned || false,
                ndaSignedAt: visit.ndaSignedAt || null,
                safetyAcknowledgments: visit.safetyAcknowledgments || {},
                qrCodeUrl: `/api/visitors/visits/qr/${visit._id.toString()}`,
                notes: visit.notes || null,
                belongings: visit.belongings || [],
                accessAreas: visit.accessAreas || []
            } : null,
            preregistration: (!visit && prereg) ? {
                id: prereg._id.toString(),
                visitorName: prereg.visitorName,
                hostEmployeeName: prereg.hostEmployeeName,
                purpose: prereg.purpose,
                expectedArrival: prereg.expectedArrival,
                expectedDeparture: prereg.expectedDeparture,
                status: prereg.status,
                registrationUrl: prereg.registrationUrl || null,
                confirmationCode: prereg.confirmationCode
            } : null
        };

        res.json(portalData);
    } catch (error) {
        console.error('Error in visitor portal:', error);
        next(error);
    }
});

/**
 * GET /api/visitor-portal/:token/nda
 * Get NDA configuration for a company (via portal token)
 * Used by VisitorRegistration.jsx to fetch custom NDA text
 */
router.get('/:token/nda', async (req, res, next) => {
    try {
        const { token } = req.params;
        const db = getDb();

        // Find the company from the token
        let companyId = null;
        const visit = await collections.visits().findOne({ visitorPortalToken: token });
        if (visit) {
            companyId = visit.companyId;
        } else {
            const prereg = await db.collection('preregistrations').findOne({ visitorPortalToken: token });
            if (prereg) companyId = prereg.companyId;
        }

        if (!companyId) {
            // Also try by preregistration _id
            if (isValidObjectId(token)) {
                const prereg = await db.collection('preregistrations').findOne({ _id: new ObjectId(token) });
                if (prereg) companyId = prereg.companyId;
            }
        }

        let ndaConfig = {
            disclosureText: DEFAULT_NDA_DISCLOSURE,
            safetyRules: DEFAULT_NDA_RULES,
            requireSignature: true
        };

        if (companyId) {
            let settingsQuery;
            if (companyId instanceof ObjectId) {
                settingsQuery = { $or: [{ companyId }, { companyId: companyId.toString() }] };
            } else if (isValidObjectId(String(companyId))) {
                settingsQuery = { $or: [{ companyId: new ObjectId(String(companyId)) }, { companyId: String(companyId) }] };
            } else {
                settingsQuery = { companyId: String(companyId) };
            }
            const settings = await collections.settings().findOne(settingsQuery);
            if (settings?.nda) {
                ndaConfig = {
                    disclosureText: settings.nda.disclosureText || DEFAULT_NDA_DISCLOSURE,
                    safetyRules: settings.nda.safetyRules || DEFAULT_NDA_RULES,
                    requireSignature: settings.nda.requireSignature !== false
                };
            }
        }

        res.json({ nda: ndaConfig });
    } catch (error) {
        console.error('Error fetching NDA config:', error);
        next(error);
    }
});

module.exports = router;
