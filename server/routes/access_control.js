/**
 * Access Control Integration API
 * 
 * Integration with physical access control systems:
 * - Grant/revoke temporary access
 * - Door event handling
 * - Zone access management
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { collections, getDb } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');

/**
 * Convert ObjectIds and Dates to strings recursively
 */
function convertObjectIds(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof ObjectId) return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(convertObjectIds);
    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertObjectIds(value);
        }
        return result;
    }
    return obj;
}

/**
 * POST /grant
 * Grant temporary access to a visitor
 */
router.post('/grant', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const visitId = data.visitId;

        if (!visitId) {
            return res.status(400).json({ error: 'Visit ID is required' });
        }

        const visit = await collections.visits.findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (!['scheduled', 'checked_in'].includes(visit.status)) {
            return res.status(400).json({ error: 'Visit must be scheduled or checked-in to grant access' });
        }

        const db = getDb();
        const accessCredentials = db.collection('access_credentials');

        const now = new Date();

        // Get or default zones
        const zones = data.zones || visit.accessAreas || ['main_lobby'];

        // Calculate validity
        let validFrom = now;
        if (data.validFrom) {
            validFrom = new Date(data.validFrom);
        }

        let validUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000); // Default 8 hours
        if (data.validUntil) {
            validUntil = new Date(data.validUntil);
        } else if (visit.expectedDeparture) {
            validUntil = new Date(new Date(visit.expectedDeparture).getTime() + 60 * 60 * 1000); // +1hr buffer
        }

        const credentialType = data.credentialType || 'qr';

        // Generate credential
        const credentialCode = crypto.randomBytes(16).toString('hex');

        const credentialDoc = {
            _id: new ObjectId(),
            visitId: new ObjectId(visitId),
            visitorId: visit.visitorId,
            visitorName: visit.visitorName,
            companyId: visit.companyId,
            credentialType,
            credentialCode,
            zones,
            validFrom,
            validUntil,
            status: 'active',
            createdAt: now,
            createdBy: req.userId || 'system',
            usageCount: 0,
            lastUsed: null
        };

        await accessCredentials.insertOne(credentialDoc);

        // Update visit with access info
        await collections.visits.updateOne(
            { _id: new ObjectId(visitId) },
            {
                $set: {
                    accessCredentialId: credentialDoc._id,
                    accessZones: zones,
                    accessValidUntil: validUntil
                }
            }
        );

        res.status(201).json({
            message: 'Access granted',
            accessId: credentialDoc._id.toString(),
            credentialCode,
            credentialType,
            zones,
            validFrom: validFrom.toISOString(),
            validUntil: validUntil.toISOString()
        });

    } catch (error) {
        console.error('Error granting access:', error);
        next(error);
    }
});

/**
 * POST /revoke
 * Revoke visitor's access
 */
router.post('/revoke', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const visitId = data.visitId;
        const reason = data.reason || 'Manual revocation';

        if (!visitId) {
            return res.status(400).json({ error: 'Visit ID is required' });
        }

        const db = getDb();
        const accessCredentials = db.collection('access_credentials');

        // Revoke all active credentials for this visit
        const result = await accessCredentials.updateMany(
            { visitId: new ObjectId(visitId), status: 'active' },
            {
                $set: {
                    status: 'revoked',
                    revokedAt: new Date(),
                    revokedBy: req.userId || 'system',
                    revocationReason: reason
                }
            }
        );

        // Update visit
        await collections.visits.updateOne(
            { _id: new ObjectId(visitId) },
            { $set: { accessRevoked: true, accessRevokedAt: new Date() } }
        );

        res.json({
            message: 'Access revoked',
            visitId,
            credentialsRevoked: result.modifiedCount
        });

    } catch (error) {
        console.error('Error revoking access:', error);
        next(error);
    }
});

/**
 * POST /verify
 * Verify if visitor has access to a zone
 */
router.post('/verify', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const credentialCode = data.credentialCode;
        const zoneId = data.zoneId;
        const doorId = data.doorId;

        if (!credentialCode) {
            return res.status(400).json({ error: 'Credential code is required' });
        }

        if (!zoneId) {
            return res.status(400).json({ error: 'Zone ID is required' });
        }

        const db = getDb();
        const accessCredentials = db.collection('access_credentials');

        // Find credential
        const credential = await accessCredentials.findOne({ credentialCode });

        if (!credential) {
            return res.json({
                authorized: false,
                reason: 'Invalid credential'
            });
        }

        if (credential.status !== 'active') {
            return res.json({
                authorized: false,
                reason: `Credential is ${credential.status}`
            });
        }

        const now = new Date();

        // Check validity period
        if (now < credential.validFrom) {
            return res.json({
                authorized: false,
                reason: 'Credential not yet valid'
            });
        }

        if (now > credential.validUntil) {
            return res.json({
                authorized: false,
                reason: 'Credential expired'
            });
        }

        // Check zone authorization
        if (!credential.zones.includes(zoneId) && !credential.zones.includes('all')) {
            return res.json({
                authorized: false,
                reason: 'Not authorized for this zone'
            });
        }

        // Update usage
        await accessCredentials.updateOne(
            { _id: credential._id },
            {
                $inc: { usageCount: 1 },
                $set: { lastUsed: now, lastUsedZone: zoneId, lastUsedDoor: doorId }
            }
        );

        // Log access event
        const accessEvents = db.collection('access_events');
        await accessEvents.insertOne({
            _id: new ObjectId(),
            credentialId: credential._id,
            visitId: credential.visitId,
            visitorId: credential.visitorId,
            visitorName: credential.visitorName,
            zoneId,
            doorId,
            eventType: 'access_granted',
            timestamp: now
        });

        res.json({
            authorized: true,
            visitorId: credential.visitorId?.toString(),
            visitorName: credential.visitorName,
            zones: credential.zones,
            validUntil: credential.validUntil.toISOString()
        });

    } catch (error) {
        console.error('Error verifying access:', error);
        next(error);
    }
});

/**
 * GET /zones
 * Get available access zones for a company
 */
router.get('/zones', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const zonesCollection = db.collection('access_zones');

        let zones = await zonesCollection.find({ companyId, active: true }).toArray();

        if (!zones || zones.length === 0) {
            // Return default zones
            zones = [
                { id: 'main_lobby', name: 'Main Lobby', level: 'unrestricted' },
                { id: 'meeting_rooms', name: 'Meeting Rooms', level: 'visitor' },
                { id: 'cafeteria', name: 'Cafeteria', level: 'unrestricted' },
                { id: 'office_floor', name: 'Office Floor', level: 'escorted' }
            ];
        }

        res.json({
            zones: convertObjectIds(zones),
            count: zones.length
        });

    } catch (error) {
        console.error('Error getting zones:', error);
        next(error);
    }
});

/**
 * POST /door-event
 * Receive door open/close events from access control hardware
 */
router.post('/door-event', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body || {};
        const doorId = data.doorId;
        const eventType = data.eventType;

        if (!doorId || !eventType) {
            return res.status(400).json({ error: 'doorId and eventType are required' });
        }

        const db = getDb();
        const doorEvents = db.collection('door_events');

        const eventDoc = {
            _id: new ObjectId(),
            doorId,
            eventType,
            credentialCode: data.credentialCode,
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            receivedAt: new Date()
        };

        await doorEvents.insertOne(eventDoc);

        // Alert on security events
        if (['door_forced', 'door_held'].includes(eventType)) {
            const auditLogs = db.collection('audit_logs');
            await auditLogs.insertOne({
                _id: new ObjectId(),
                action: `security.${eventType}`,
                entityType: 'door',
                entityId: doorId,
                companyId: req.query.companyId || req.companyId || '',
                details: { doorId, eventType },
                severity: 'warning',
                timestamp: new Date()
            });
        }

        res.json({
            message: 'Event recorded',
            eventId: eventDoc._id.toString()
        });

    } catch (error) {
        console.error('Error recording door event:', error);
        next(error);
    }
});

/**
 * GET /active-credentials
 * Get all currently active access credentials
 */
router.get('/active-credentials', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId || req.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const db = getDb();
        const accessCredentials = db.collection('access_credentials');

        const now = new Date();

        const credentials = await accessCredentials.find({
            companyId,
            status: 'active',
            validFrom: { $lte: now },
            validUntil: { $gt: now }
        }).toArray();

        res.json({
            credentials: convertObjectIds(credentials),
            count: credentials.length
        });

    } catch (error) {
        console.error('Error getting active credentials:', error);
        next(error);
    }
});

module.exports = router;
