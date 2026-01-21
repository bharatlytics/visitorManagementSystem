/**
 * VMS Users Management Routes
 * 
 * Complete user management for standalone VMS operation:
 * - List users in company
 * - Create/invite new users
 * - Update user roles and status
 * - Deactivate users
 * - Reset passwords
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { requireAuth, requireCompanyAccess } = require('../middleware/auth');
const { collections } = require('../db');

// Available roles for assignment
const AVAILABLE_ROLES = [
    { id: 'company_admin', name: 'Company Admin', description: 'Full company access' },
    { id: 'manager', name: 'Manager', description: 'Manage employees, approve visitors' },
    { id: 'receptionist', name: 'Receptionist', description: 'Manage visitor check-in/out' },
    { id: 'security_guard', name: 'Security Guard', description: 'Gate operations, blacklist' },
    { id: 'host', name: 'Host', description: 'Approve visitors for self only' },
    { id: 'readonly', name: 'View Only', description: 'Dashboard view only' }
];

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
 * Sanitize user object (remove sensitive fields)
 */
function sanitizeUser(user) {
    const sanitized = convertObjectIds(user);
    delete sanitized.password;
    delete sanitized.resetToken;
    delete sanitized.resetTokenExpiry;
    delete sanitized.inviteToken;
    delete sanitized.inviteExpiry;
    return sanitized;
}

/**
 * GET /api/users/roles
 * Get available roles for assignment
 */
router.get('/roles', requireAuth, (req, res) => {
    res.json({ roles: AVAILABLE_ROLES });
});

/**
 * GET /api/users/
 * List all users in the company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, status, role } = req.query;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Build query
        const query = {};
        try {
            query.companyId = new ObjectId(companyId);
        } catch {
            query.companyId = companyId;
        }
        
        if (status) query.status = status;
        if (role) query.role = role;
        
        const users = await collections.users()
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({
            users: users.map(sanitizeUser),
            count: users.length
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/users/:userId
 * Get single user by ID
 */
router.get('/:userId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { companyId } = req.query;
        
        let user;
        try {
            user = await collections.users().findOne({ _id: new ObjectId(userId) });
        } catch {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify company access
        if (user.companyId.toString() !== companyId) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user: sanitizeUser(user) });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/users/
 * Create a new user
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, email, name, role, password, phone, department } = req.body || {};
        
        // Validate required fields
        if (!companyId || !email || !name || !role) {
            return res.status(400).json({ 
                error: 'companyId, email, name, and role are required' 
            });
        }
        
        // Validate role
        const validRoles = AVAILABLE_ROLES.map(r => r.id);
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                error: `Invalid role. Must be one of: ${validRoles.join(', ')}` 
            });
        }
        
        // Check email exists
        const existing = await collections.users().findOne({ 
            email: email.toLowerCase() 
        });
        if (existing) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }
        
        // Prepare company ID
        let cid;
        try {
            cid = new ObjectId(companyId);
        } catch {
            cid = companyId;
        }
        
        // Create user document
        const userDoc = {
            _id: new ObjectId(),
            email: email.toLowerCase(),
            name,
            role,
            companyId: cid,
            phone: phone || null,
            department: department || null,
            status: 'active',
            createdAt: new Date(),
            createdBy: req.userId || 'system',
            updatedAt: new Date()
        };
        
        // Handle password or invite
        if (password) {
            userDoc.password = await bcrypt.hash(password, 10);
        } else {
            const inviteToken = crypto.randomBytes(32).toString('hex');
            userDoc.status = 'invited';
            userDoc.inviteToken = inviteToken;
            userDoc.inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        }
        
        await collections.users().insertOne(userDoc);
        
        const response = {
            message: 'User created successfully',
            user: sanitizeUser(userDoc)
        };
        
        // Include invite token for admin
        if (userDoc.inviteToken) {
            response.inviteToken = userDoc.inviteToken;
            response.inviteUrl = `/auth/accept-invite?token=${userDoc.inviteToken}`;
        }
        
        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/users/me
 * Update current user's own profile
 */
router.patch('/me', requireAuth, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { name, phone } = req.body || {};
        
        if (!userId) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const updateFields = { updatedAt: new Date() };
        if (name) updateFields.name = name;
        if (phone) updateFields.phone = phone;
        
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: updateFields }
        );
        
        const updatedUser = await collections.users().findOne({ 
            _id: new ObjectId(userId) 
        });
        
        res.json({
            message: 'Profile updated successfully',
            user: sanitizeUser(updatedUser)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/users/me/change-password
 * Change current user's password
 */
router.post('/me/change-password', requireAuth, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { currentPassword, newPassword } = req.body || {};
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                error: 'Current password and new password are required' 
            });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({ 
                error: 'New password must be at least 8 characters' 
            });
        }
        
        const user = await collections.users().findOne({ 
            _id: new ObjectId(userId) 
        });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password || '');
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Update password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: { password: hashedPassword, passwordChangedAt: new Date() } }
        );
        
        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/users/:userId
 * Update user details
 */
router.patch('/:userId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { companyId, name, role, phone, department, status } = req.body || {};
        
        let user;
        try {
            user = await collections.users().findOne({ _id: new ObjectId(userId) });
        } catch {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify company access
        const reqCompanyId = companyId || req.query.companyId;
        if (user.companyId.toString() !== reqCompanyId) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Build update
        const updateFields = { updatedAt: new Date() };
        if (name) updateFields.name = name;
        if (phone) updateFields.phone = phone;
        if (department) updateFields.department = department;
        if (status) updateFields.status = status;
        
        if (role) {
            const validRoles = AVAILABLE_ROLES.map(r => r.id);
            if (!validRoles.includes(role)) {
                return res.status(400).json({ 
                    error: `Invalid role. Must be one of: ${validRoles.join(', ')}` 
                });
            }
            updateFields.role = role;
        }
        
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: updateFields }
        );
        
        const updatedUser = await collections.users().findOne({ 
            _id: new ObjectId(userId) 
        });
        
        res.json({
            message: 'User updated successfully',
            user: sanitizeUser(updatedUser)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/users/:userId
 * Deactivate user (soft delete)
 */
router.delete('/:userId', requireCompanyAccess, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { companyId } = req.query;
        
        let user;
        try {
            user = await collections.users().findOne({ _id: new ObjectId(userId) });
        } catch {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Verify company access
        if (user.companyId.toString() !== companyId) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Don't allow deactivating yourself
        if (user._id.toString() === req.userId) {
            return res.status(400).json({ error: 'Cannot deactivate your own account' });
        }
        
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: { 
                status: 'inactive',
                deactivatedAt: new Date(),
                deactivatedBy: req.userId || 'admin'
            }}
        );
        
        res.json({ message: 'User deactivated successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/users/:userId/reactivate
 * Reactivate a deactivated user
 */
router.post('/:userId/reactivate', requireCompanyAccess, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { companyId } = req.body || req.query || {};
        
        let user;
        try {
            user = await collections.users().findOne({ _id: new ObjectId(userId) });
        } catch {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: { 
                status: 'active',
                reactivatedAt: new Date(),
                reactivatedBy: req.userId || 'admin'
            }}
        );
        
        res.json({ message: 'User reactivated successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/users/:userId/reset-password
 * Admin-initiated password reset
 */
router.post('/:userId/reset-password', requireCompanyAccess, async (req, res, next) => {
    try {
        const { userId } = req.params;
        
        let user;
        try {
            user = await collections.users().findOne({ _id: new ObjectId(userId) });
        } catch {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        await collections.users().updateOne(
            { _id: new ObjectId(userId) },
            { $set: { 
                resetToken,
                resetTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            }}
        );
        
        res.json({
            message: 'Password reset token generated',
            resetToken,
            resetUrl: `/auth/reset-password?token=${resetToken}`,
            expiresIn: '24 hours'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
