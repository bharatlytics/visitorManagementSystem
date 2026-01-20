/**
 * VMS Authentication Routes
 * Matching Python app/auth/__init__.py
 * 
 * Supports:
 * - Local login (standalone mode)
 * - Platform SSO (connected mode)
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const Config = require('../config');
const { collections } = require('../db');
const { createToken, decodeToken, decodePlatformToken, requireAuth } = require('../middleware/auth');

// =====================================
// Local Authentication (Standalone Mode)
// =====================================

/**
 * POST /auth/login
 * Local login for standalone mode
 */
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const user = await collections.users().findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.password || '');
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Create token
        const token = createToken(user._id.toString(), user.companyId?.toString());

        // Set session
        if (req.session) {
            req.session.userId = user._id.toString();
            req.session.companyId = user.companyId?.toString();
        }

        res.json({
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                companyId: user.companyId?.toString()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /auth/verify-company
 * Verify if a company ID exists
 */
router.post('/verify-company', async (req, res, next) => {
    try {
        const { companyId } = req.body || {};

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID required' });
        }

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid Company ID format' });
        }

        const company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        if (company) {
            res.json({
                valid: true,
                companyName: company.companyName || 'Unknown Company'
            });
        } else {
            res.status(404).json({ error: 'Company not found' });
        }
    } catch (error) {
        next(error);
    }
});

/**
 * POST /auth/register
 * Register new user (standalone mode)
 */
router.post('/register', async (req, res, next) => {
    try {
        const data = req.body || {};

        // Common fields
        if (!data.email || !data.password || !data.name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }

        // Check if email exists
        const existingUser = await collections.users().findOne({ email: data.email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        let companyId = null;
        let role = 'employee';

        // Mode 1: Join Existing Company
        if (data.companyId) {
            if (!ObjectId.isValid(data.companyId)) {
                return res.status(400).json({ error: 'Invalid Company ID format' });
            }

            const company = await collections.companies().findOne({ _id: new ObjectId(data.companyId) });
            if (!company) {
                return res.status(400).json({ error: 'Invalid Company ID' });
            }
            companyId = new ObjectId(data.companyId);
            role = 'employee';
        }
        // Mode 2: Create New Company
        else if (data.companyName) {
            // Verify Admin Secret
            if (data.adminSecret !== '112233445566778899') {
                return res.status(403).json({ error: 'Invalid Admin Secret for new company registration' });
            }

            // Create company
            const company = {
                _id: new ObjectId(),
                companyName: data.companyName,
                createdAt: new Date()
            };
            await collections.companies().insertOne(company);
            companyId = company._id;
            role = 'admin';
        } else {
            return res.status(400).json({ error: 'Either Company ID (to join) or Company Name + Secret (to create) is required' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(data.password, 10);

        // Create user
        const user = {
            _id: new ObjectId(),
            email: data.email,
            password: hashedPassword,
            name: data.name,
            companyId,
            role,
            createdAt: new Date()
        };
        await collections.users().insertOne(user);

        // Create token
        const token = createToken(user._id.toString(), companyId.toString());

        res.status(201).json({
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role,
                companyId: companyId.toString()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /auth/logout
 * Logout
 */
router.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy();
    }
    res.json({ message: 'Logged out' });
});


// =====================================
// Platform SSO (Connected Mode)
// =====================================

/**
 * GET/POST /auth/platform-sso
 * Authenticate via Bharatlytics Platform SSO token
 */
router.all('/platform-sso', async (req, res, next) => {
    try {
        // Get token from query params (GET) or body (POST)
        let platformToken, companyId, companyName, companyLogo;

        if (req.method === 'GET') {
            platformToken = req.query.token;
            companyId = req.query.companyId;
            companyName = req.query.companyName;
            companyLogo = req.query.companyLogo;
        } else {
            const data = req.body || {};
            platformToken = data.token;
            companyId = data.companyId;
            companyName = data.companyName;
            companyLogo = data.companyLogo;
        }

        if (!platformToken) {
            return res.status(400).json({ error: 'Platform token required' });
        }

        // Decode the SSO token from platform
        let payload;
        try {
            payload = jwt.verify(platformToken, Config.PLATFORM_JWT_SECRET, { algorithms: [Config.JWT_ALGORITHM] });
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'SSO token expired' });
            }
            return res.status(401).json({ error: `Invalid SSO token: ${err.message}` });
        }

        console.log('[SSO] Token payload:', payload);

        // Extract user info from token (camelCase primary, snake_case fallback)
        const userId = payload.userId || payload.user_id;
        const userEmail = payload.userEmail || payload.user_email;
        const userName = payload.userName || payload.user_name;
        companyId = companyId || payload.companyId || payload.company_id;
        companyName = companyName || payload.companyName || payload.company_name;
        companyLogo = companyLogo || payload.companyLogo || payload.company_logo;

        console.log(`[SSO] Extracted - company_name: ${companyName}, company_logo: ${companyLogo}`);

        // Store in session
        if (req.session) {
            req.session.platformToken = platformToken;
            req.session.companyId = companyId;
            req.session.userId = userId;
            req.session.userEmail = userEmail;
            req.session.userName = userName;
            req.session.companyName = companyName;
            req.session.companyLogo = companyLogo;
        }

        console.log(`[SSO] Session set: user_id=${userId}, company_id=${companyId}, company_name=${companyName}`);

        // If GET request (redirect from platform), redirect to frontend with token
        if (req.method === 'GET') {
            // Create VMS JWT for frontend
            const vmsToken = createToken(userId, companyId, 24);

            // Build redirect URL with token for frontend auto-login
            const frontendUrl = Config.NODE_ENV === 'development'
                ? 'http://localhost:5173'
                : Config.FRONTEND_URL || '';

            // Encode params for URL
            const params = new URLSearchParams({
                token: vmsToken,
                companyId: companyId || '',
                companyName: companyName || '',
                companyLogo: companyLogo || ''
            });

            return res.redirect(`${frontendUrl}/sso-callback?${params.toString()}`);
        }

        // For POST requests (mobile/API), return JSON with VMS JWT token
        const vmsToken = createToken(userId, companyId, 24);

        res.json({
            message: 'Platform SSO successful',
            vmsToken,
            expiresIn: 86400,
            companyId,
            company: {
                id: companyId,
                name: companyName,
                logo: companyLogo
            },
            user: {
                id: userId,
                email: userEmail,
                name: userName
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /auth/me
 * Get current authenticated user
 */
router.get('/me', requireAuth, (req, res) => {
    const companyId = req.companyId;
    const isConnected = Boolean(req.session?.platformToken);

    const response = {
        user_id: req.userId,
        company_id: companyId,
        connected: isConnected
    };

    // If connected to platform, include company details and return URL
    if (isConnected && companyId) {
        const platformBase = Config.PLATFORM_WEB_URL.replace(/\/$/, '');
        response.platform_url = `${platformBase}/companies/${companyId}`;
        response.company = {
            id: companyId,
            name: req.session?.companyName,
            logo: req.session?.companyLogo
        };
    }

    res.json(response);
});

module.exports = router;
