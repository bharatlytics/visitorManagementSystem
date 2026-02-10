/**
 * Approval Tokens API
 * Public routes for token-based visit approvals (no authentication required)
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const { collections, getDb } = require('../db');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/approval-tokens/:token
 * Verify token and get visit details (public, no auth required)
 */
router.get('/:token', async (req, res, next) => {
    try {
        const { token } = req.params;

        // Find token
        const tokenDoc = await collections.approvalTokens().findOne({ token });

        if (!tokenDoc) {
            return res.status(404).json({
                status: 'error',
                error: 'Invalid approval token'
            });
        }

        // Check if already used
        if (tokenDoc.usedAt) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has already been used',
                usedAt: tokenDoc.usedAt
            });
        }

        // Check expiration
        if (new Date() > new Date(tokenDoc.expiresAt)) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has expired',
                expiresAt: tokenDoc.expiresAt
            });
        }

        // Fetch visit details
        const visit = await collections.visits().findOne({ _id: new ObjectId(tokenDoc.visitId) });

        if (!visit) {
            return res.status(404).json({
                status: 'error',
                error: 'Visit not found'
            });
        }

        // Return visit details for display
        res.json({
            status: 'success',
            visit: convertObjectIds(visit),
            token: {
                expiresAt: tokenDoc.expiresAt,
                action: tokenDoc.action
            }
        });
    } catch (error) {
        console.error('Error verifying approval token:', error);
        next(error);
    }
});

/**
 * POST /api/approval-tokens/:token/approve
 * Approve a visit using the token (public, no auth required)
 */
router.post('/:token/approve', async (req, res, next) => {
    try {
        const { token } = req.params;
        const { notes } = req.body;

        // Find and validate token
        const tokenDoc = await collections.approvalTokens().findOne({ token });

        if (!tokenDoc) {
            return res.status(404).json({
                status: 'error',
                error: 'Invalid approval token'
            });
        }

        if (tokenDoc.usedAt) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has already been used'
            });
        }

        if (new Date() > new Date(tokenDoc.expiresAt)) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has expired'
            });
        }

        // Fetch visit
        const visit = await collections.visits().findOne({ _id: new ObjectId(tokenDoc.visitId) });

        if (!visit) {
            return res.status(404).json({
                status: 'error',
                error: 'Visit not found'
            });
        }

        if (visit.status !== 'pending_approval') {
            return res.status(400).json({
                status: 'error',
                error: `Visit is not pending approval. Current status: ${visit.status}`
            });
        }

        // Update visit status to scheduled
        await collections.visits().updateOne(
            { _id: new ObjectId(tokenDoc.visitId) },
            {
                $set: {
                    status: 'scheduled',
                    approvedAt: new Date(),
                    approvalNotes: notes || null,
                    lastUpdated: new Date()
                }
            }
        );

        // Mark token as used
        await collections.approvalTokens().updateOne(
            { token },
            {
                $set: {
                    usedAt: new Date(),
                    action: 'approved'
                }
            }
        );

        // Create approval record
        await collections.approvals().insertOne({
            _id: new ObjectId(),
            visitId: tokenDoc.visitId,
            companyId: tokenDoc.companyId,
            hostEmployeeId: tokenDoc.hostEmployeeId,
            status: 'approved',
            approvedAt: new Date(),
            approvalNotes: notes || null,
            approvalMethod: 'email_link',
            createdAt: tokenDoc.createdAt,
            lastUpdated: new Date()
        });

        console.log(`[ApprovalTokens] Visit ${tokenDoc.visitId} approved via token`);

        res.json({
            status: 'success',
            message: 'Visit approved successfully',
            visitId: tokenDoc.visitId.toString()
        });
    } catch (error) {
        console.error('Error approving via token:', error);
        next(error);
    }
});

/**
 * POST /api/approval-tokens/:token/reject
 * Reject a visit using the token (public, no auth required)
 */
router.post('/:token/reject', async (req, res, next) => {
    try {
        const { token } = req.params;
        const { reason } = req.body;

        // Find and validate token
        const tokenDoc = await collections.approvalTokens().findOne({ token });

        if (!tokenDoc) {
            return res.status(404).json({
                status: 'error',
                error: 'Invalid approval token'
            });
        }

        if (tokenDoc.usedAt) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has already been used'
            });
        }

        if (new Date() > new Date(tokenDoc.expiresAt)) {
            return res.status(400).json({
                status: 'error',
                error: 'This approval link has expired'
            });
        }

        // Fetch visit
        const visit = await collections.visits().findOne({ _id: new ObjectId(tokenDoc.visitId) });

        if (!visit) {
            return res.status(404).json({
                status: 'error',
                error: 'Visit not found'
            });
        }

        if (visit.status !== 'pending_approval') {
            return res.status(400).json({
                status: 'error',
                error: `Visit is not pending approval. Current status: ${visit.status}`
            });
        }

        // Update visit status to rejected
        await collections.visits().updateOne(
            { _id: new ObjectId(tokenDoc.visitId) },
            {
                $set: {
                    status: 'rejected',
                    rejectedAt: new Date(),
                    rejectionReason: reason || 'No reason provided',
                    lastUpdated: new Date()
                }
            }
        );

        // Mark token as used
        await collections.approvalTokens().updateOne(
            { token },
            {
                $set: {
                    usedAt: new Date(),
                    action: 'rejected'
                }
            }
        );

        // Create approval record
        await collections.approvals().insertOne({
            _id: new ObjectId(),
            visitId: tokenDoc.visitId,
            companyId: tokenDoc.companyId,
            hostEmployeeId: tokenDoc.hostEmployeeId,
            status: 'rejected',
            rejectedAt: new Date(),
            rejectionReason: reason || 'No reason provided',
            approvalMethod: 'email_link',
            createdAt: tokenDoc.createdAt,
            lastUpdated: new Date()
        });

        console.log(`[ApprovalTokens] Visit ${tokenDoc.visitId} rejected via token`);

        res.json({
            status: 'success',
            message: 'Visit rejected successfully',
            visitId: tokenDoc.visitId.toString()
        });
    } catch (error) {
        console.error('Error rejecting via token:', error);
        next(error);
    }
});

/**
 * Helper function to create approval token
 * To be called from visit scheduling route
 */
async function createApprovalToken(visitId, hostEmployeeId, companyId) {
    try {
        const token = uuidv4();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiration

        const tokenDoc = {
            _id: new ObjectId(),
            token,
            visitId: isValidObjectId(visitId) ? new ObjectId(visitId) : visitId,
            hostEmployeeId: isValidObjectId(hostEmployeeId) ? new ObjectId(hostEmployeeId) : hostEmployeeId,
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
            expiresAt,
            usedAt: null,
            action: null,
            createdAt: new Date()
        };

        await collections.approvalTokens().insertOne(tokenDoc);

        return {
            success: true,
            token,
            expiresAt
        };
    } catch (error) {
        console.error('[ApprovalTokens] Error creating token:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = router;
module.exports.createApprovalToken = createApprovalToken;
