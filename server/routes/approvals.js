/**
 * Approvals API
 * Approval workflow management
 * Matching Python app/api/approvals.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { requireCompanyAccess, requireAuth } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/approvals
 * List pending approvals for a company or host
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const hostId = req.query.hostId;
        const status = req.query.status || 'pending';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const db = getDb();
        let query = {
            status
        };

        if (isValidObjectId(companyId)) {
            query.companyId = new ObjectId(companyId);
        } else {
            query.companyId = companyId;
        }

        if (hostId) {
            query.hostEmployeeId = isValidObjectId(hostId) ? new ObjectId(hostId) : hostId;
        }

        const approvals = await db.collection('approvals')
            .find(query)
            .sort({ requestedAt: -1 })
            .toArray();

        res.json({ approvals: convertObjectIds(approvals) });
    } catch (error) {
        console.error('Error listing approvals:', error);
        next(error);
    }
});

/**
 * GET /api/approvals/:approval_id
 * Get single approval details
 */
router.get('/:approval_id', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid approval ID format' });
        }

        const db = getDb();
        const approval = await db.collection('approvals').findOne({ _id: new ObjectId(approval_id) });

        if (!approval) {
            return res.status(404).json({ error: 'Approval not found' });
        }

        res.json({ approval: convertObjectIds(approval) });
    } catch (error) {
        console.error('Error getting approval:', error);
        next(error);
    }
});

/**
 * POST /api/approvals/:approval_id/approve
 * Approve a pending request
 */
router.post('/:approval_id/approve', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;
        const { notes } = req.body;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid approval ID format' });
        }

        const db = getDb();
        const approval = await db.collection('approvals').findOne({ _id: new ObjectId(approval_id) });

        if (!approval) {
            return res.status(404).json({ error: 'Approval not found' });
        }

        if (approval.status !== 'pending') {
            return res.status(400).json({ error: 'Approval is not pending' });
        }

        // Update approval
        await db.collection('approvals').updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    status: 'approved',
                    approvedBy: req.userId,
                    approvedAt: new Date(),
                    approvalNotes: notes || null,
                    lastUpdated: new Date()
                }
            }
        );

        // Update related visit status if applicable
        if (approval.visitId) {
            await collections.visits().updateOne(
                { _id: new ObjectId(approval.visitId) },
                {
                    $set: {
                        status: 'scheduled',
                        approvalRequired: false,
                        approvedAt: new Date(),
                        lastUpdated: new Date()
                    }
                }
            );
        }

        res.json({ message: 'Approval granted successfully' });
    } catch (error) {
        console.error('Error approving:', error);
        next(error);
    }
});

/**
 * POST /api/approvals/:approval_id/reject
 * Reject a pending request
 */
router.post('/:approval_id/reject', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;
        const { reason } = req.body;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid approval ID format' });
        }

        const db = getDb();
        const approval = await db.collection('approvals').findOne({ _id: new ObjectId(approval_id) });

        if (!approval) {
            return res.status(404).json({ error: 'Approval not found' });
        }

        if (approval.status !== 'pending') {
            return res.status(400).json({ error: 'Approval is not pending' });
        }

        // Update approval
        await db.collection('approvals').updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    status: 'rejected',
                    rejectedBy: req.userId,
                    rejectedAt: new Date(),
                    rejectionReason: reason || 'No reason provided',
                    lastUpdated: new Date()
                }
            }
        );

        // Update related visit status if applicable
        if (approval.visitId) {
            await collections.visits().updateOne(
                { _id: new ObjectId(approval.visitId) },
                {
                    $set: {
                        status: 'rejected',
                        rejectionReason: reason,
                        lastUpdated: new Date()
                    }
                }
            );
        }

        res.json({ message: 'Approval rejected' });
    } catch (error) {
        console.error('Error rejecting:', error);
        next(error);
    }
});

/**
 * GET /api/approvals/pending/count
 * Get count of pending approvals for a host
 */
router.get('/pending/count', requireAuth, async (req, res, next) => {
    try {
        const hostId = req.query.hostId || req.userId;
        const companyId = req.query.companyId;

        const db = getDb();
        let query = { status: 'pending' };

        if (companyId) {
            query.companyId = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;
        }

        if (hostId) {
            query.hostEmployeeId = isValidObjectId(hostId) ? new ObjectId(hostId) : hostId;
        }

        const count = await db.collection('approvals').countDocuments(query);

        res.json({ pendingCount: count });
    } catch (error) {
        console.error('Error counting approvals:', error);
        next(error);
    }
});

/**
 * GET /api/approvals/history
 * Get historical approvals (approved/rejected)
 */
router.get('/history', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const limit = parseInt(req.query.limit) || 50;
        const skip = parseInt(req.query.skip) || 0;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const db = getDb();
        let query = {
            status: { $in: ['approved', 'rejected'] }
        };

        if (isValidObjectId(companyId)) {
            query.companyId = new ObjectId(companyId);
        } else {
            query.companyId = companyId;
        }

        const approvals = await db.collection('approvals')
            .find(query)
            .sort({ approvedAt: -1, rejectedAt: -1, lastUpdated: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await db.collection('approvals').countDocuments(query);

        res.json({
            history: convertObjectIds(approvals),
            total,
            limit,
            skip
        });
    } catch (error) {
        console.error('Error fetching approval history:', error);
        next(error);
    }
});

/**
 * POST /api/approvals/:approval_id/delegate
 * Delegate an approval to another host
 */
router.post('/:approval_id/delegate', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;
        const { delegateToEmployeeId, reason } = req.body;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid approval ID format' });
        }

        if (!delegateToEmployeeId) {
            return res.status(400).json({ error: 'Delegate employee ID is required' });
        }

        const db = getDb();
        const approval = await db.collection('approvals').findOne({ _id: new ObjectId(approval_id) });

        if (!approval) {
            return res.status(404).json({ error: 'Approval not found' });
        }

        if (approval.status !== 'pending') {
            return res.status(400).json({ error: 'Only pending approvals can be delegated' });
        }

        // Update approval with new host
        await db.collection('approvals').updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    previousHostEmployeeId: approval.hostEmployeeId,
                    hostEmployeeId: isValidObjectId(delegateToEmployeeId)
                        ? new ObjectId(delegateToEmployeeId)
                        : delegateToEmployeeId,
                    delegatedAt: new Date(),
                    delegatedBy: req.userId,
                    delegationReason: reason || null,
                    lastUpdated: new Date()
                },
                $push: {
                    delegationHistory: {
                        from: approval.hostEmployeeId,
                        to: delegateToEmployeeId,
                        by: req.userId,
                        reason: reason || null,
                        timestamp: new Date()
                    }
                }
            }
        );

        res.json({ message: 'Approval delegated successfully' });
    } catch (error) {
        console.error('Error delegating approval:', error);
        next(error);
    }
});

module.exports = router;

