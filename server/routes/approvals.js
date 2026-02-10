/**
 * Approvals API
 * Approval workflow management
 * Queries the visits collection directly (visits with status 'pending_approval')
 * No separate approvals collection needed - visits are the single source of truth
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections, getDb } = require('../db');
const { requireCompanyAccess, requireAuth } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/approvals
 * List pending approvals for a company (from visits collection)
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const status = req.query.status || 'pending';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        // Map frontend status to visit status
        let visitStatusQuery;
        if (status === 'pending') {
            visitStatusQuery = 'pending_approval';
        } else if (status === 'approved') {
            // Approved visits may have moved to scheduled, checked_in, checked_out, or completed
            visitStatusQuery = { $in: ['scheduled', 'checked_in', 'checked_out', 'completed'] };
        } else if (status === 'rejected') {
            visitStatusQuery = 'rejected';
        } else {
            visitStatusQuery = status;
        }

        let query = { status: visitStatusQuery };

        if (isValidObjectId(companyId)) {
            query.$or = [{ companyId: new ObjectId(companyId) }, { companyId: companyId }];
        } else {
            query.companyId = companyId;
        }

        // Only get visits that were created with approval workflow
        query.approvalToken = { $exists: true, $ne: null };

        const visits = await collections.visits()
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        // Transform visits into approval-like objects for the frontend
        const approvals = visits.map(visit => ({
            _id: visit._id,
            visitId: visit._id.toString(),
            companyId: visit.companyId,
            visitorId: visit.visitorId,
            visitorName: visit.visitorName || 'Unknown Visitor',
            hostEmployeeId: visit.hostEmployeeId,
            hostEmployeeName: visit.hostEmployeeName || 'Unknown Host',
            hostEmployeeCode: visit.hostEmployeeCode || '',
            purpose: visit.purpose || '',
            visitType: visit.visitType || 'guest',
            expectedArrival: visit.expectedArrival,
            expectedDeparture: visit.expectedDeparture,
            status: visit.status === 'pending_approval' ? 'pending' :
                ['scheduled', 'checked_in', 'checked_out', 'completed'].includes(visit.status) ? 'approved' : visit.status,
            approvalToken: visit.approvalToken,
            approvalUrl: visit.approvalUrl,
            approvalTokenExpiresAt: visit.approvalTokenExpiresAt,
            approvedAt: visit.approvedAt || null,
            rejectedAt: visit.rejectedAt || null,
            rejectionReason: visit.rejectionReason || null,
            requestedAt: visit.createdAt,
            createdAt: visit.createdAt,
            lastUpdated: visit.lastUpdated
        }));

        res.json({ approvals: convertObjectIds(approvals) });
    } catch (error) {
        console.error('Error listing approvals:', error);
        next(error);
    }
});

/**
 * GET /api/approvals/history
 * Get historical approvals (approved/rejected visits that had approval tokens)
 */
router.get('/history', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const limit = parseInt(req.query.limit) || 50;
        const skip = parseInt(req.query.skip) || 0;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        let query = {
            status: { $in: ['scheduled', 'rejected', 'checked_in', 'checked_out', 'completed'] },
            approvalToken: { $exists: true, $ne: null }
        };

        if (isValidObjectId(companyId)) {
            query.$or = [{ companyId: new ObjectId(companyId) }, { companyId: companyId }];
        } else {
            query.companyId = companyId;
        }

        const visits = await collections.visits()
            .find(query)
            .sort({ lastUpdated: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await collections.visits().countDocuments(query);

        const history = visits.map(visit => ({
            _id: visit._id,
            visitId: visit._id.toString(),
            visitorName: visit.visitorName || 'Unknown',
            hostEmployeeName: visit.hostEmployeeName || 'Unknown',
            purpose: visit.purpose || '',
            status: visit.status === 'scheduled' ? 'approved' : visit.status,
            approvedAt: visit.approvedAt || null,
            rejectedAt: visit.rejectedAt || null,
            rejectionReason: visit.rejectionReason || null,
            createdAt: visit.createdAt,
            lastUpdated: visit.lastUpdated
        }));

        res.json({ approvals: convertObjectIds(history), history: convertObjectIds(history), total, limit, skip });
    } catch (error) {
        console.error('Error fetching approval history:', error);
        next(error);
    }
});

/**
 * GET /api/approvals/pending/count
 * Get count of pending approvals
 */
router.get('/pending/count', requireAuth, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        let query = {
            status: 'pending_approval',
            approvalToken: { $exists: true, $ne: null }
        };

        if (companyId) {
            query.companyId = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;
        }

        const count = await collections.visits().countDocuments(query);
        res.json({ pendingCount: count });
    } catch (error) {
        console.error('Error counting approvals:', error);
        next(error);
    }
});

/**
 * POST /api/approvals/:approval_id/approve
 * Approve a pending visit (approval_id is actually visitId)
 */
router.post('/:approval_id/approve', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;
        const { notes, comment } = req.body;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(approval_id) });

        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Visit is not pending approval' });
        }

        await collections.visits().updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    status: 'scheduled',
                    approvedAt: new Date(),
                    approvalNotes: notes || comment || null,
                    lastUpdated: new Date()
                }
            }
        );

        res.json({ message: 'Visit approved successfully' });
    } catch (error) {
        console.error('Error approving visit:', error);
        next(error);
    }
});

/**
 * POST /api/approvals/:approval_id/reject
 * Reject a pending visit
 */
router.post('/:approval_id/reject', requireAuth, async (req, res, next) => {
    try {
        const { approval_id } = req.params;
        const { reason } = req.body;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(approval_id) });

        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Visit is not pending approval' });
        }

        await collections.visits().updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    status: 'rejected',
                    rejectedAt: new Date(),
                    rejectionReason: reason || 'No reason provided',
                    lastUpdated: new Date()
                }
            }
        );

        res.json({ message: 'Visit rejected' });
    } catch (error) {
        console.error('Error rejecting visit:', error);
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
        const { delegateToEmployeeId, toApproverId, reason } = req.body;
        const delegateId = delegateToEmployeeId || toApproverId;

        if (!isValidObjectId(approval_id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }

        if (!delegateId) {
            return res.status(400).json({ error: 'Delegate employee ID is required' });
        }

        const visit = await collections.visits().findOne({ _id: new ObjectId(approval_id) });

        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (visit.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Only pending visits can be delegated' });
        }

        await collections.visits().updateOne(
            { _id: new ObjectId(approval_id) },
            {
                $set: {
                    previousHostEmployeeId: visit.hostEmployeeId,
                    hostEmployeeId: isValidObjectId(delegateId)
                        ? new ObjectId(delegateId)
                        : delegateId,
                    delegatedAt: new Date(),
                    delegatedBy: req.userId,
                    delegationReason: reason || null,
                    lastUpdated: new Date()
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
