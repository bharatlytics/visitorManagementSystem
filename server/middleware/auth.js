/**
 * VMS Authentication Middleware
 * JWT authentication + Platform SSO matching Python auth/__init__.py
 */
const jwt = require('jsonwebtoken');
const Config = require('../config');
const { collections } = require('../db');

/**
 * Create JWT token
 */
function createToken(userId, companyId, expiresHours = 24) {
    const payload = {
        userId,
        companyId,
        exp: Math.floor(Date.now() / 1000) + (expiresHours * 60 * 60),
        iat: Math.floor(Date.now() / 1000),
    };
    return jwt.sign(payload, Config.JWT_SECRET, { algorithm: Config.JWT_ALGORITHM });
}

/**
 * Decode and validate JWT token
 */
function decodeToken(token) {
    try {
        return jwt.verify(token, Config.JWT_SECRET, { algorithms: [Config.JWT_ALGORITHM] });
    } catch (error) {
        return null;
    }
}

/**
 * Decode Platform SSO token
 */
function decodePlatformToken(token) {
    try {
        return jwt.verify(token, Config.PLATFORM_JWT_SECRET, { algorithms: [Config.JWT_ALGORITHM] });
    } catch (error) {
        return null;
    }
}

/**
 * Authentication middleware - validates JWT token
 */
function requireAuth(req, res, next) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    // Fallback to session token
    if (!token && req.session?.token) {
        token = req.session.token;
    }

    if (!token) {
        console.log(`[Auth] 401 No token for ${req.method} ${req.path} - authHeader: ${authHeader ? 'present' : 'missing'}`);
        return res.status(401).json({ error: 'Authentication required' });
    }

    const payload = decodeToken(token);
    if (!payload) {
        console.log(`[Auth] 401 Invalid token for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request
    req.userId = payload.userId;
    req.companyId = payload.companyId;
    req.tokenPayload = payload;

    next();
}

/**
 * Authentication + Authorization middleware
 * Validates that requested companyId matches the user's company from token
 */
function requireCompanyAccess(req, res, next) {
    // First authenticate
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!token && req.session?.token) {
        token = req.session.token;
    }

    if (!token) {
        console.log(`[CompanyAccess] 401 No token for ${req.method} ${req.path} - authHeader: ${authHeader ? 'present' : 'missing'}`);
        return res.status(401).json({ error: 'Authentication required' });
    }

    const payload = decodeToken(token);
    if (!payload) {
        console.log(`[CompanyAccess] 401 Invalid token for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request
    req.userId = payload.userId;
    req.companyId = payload.companyId;
    req.tokenPayload = payload;

    // Get requested companyId from query, body, or params
    const requestedCompanyId = req.query.companyId || req.body?.companyId || req.params?.companyId;

    // Validate company access
    if (requestedCompanyId && requestedCompanyId !== payload.companyId) {
        return res.status(403).json({
            error: 'Access denied - company mismatch',
            message: 'You can only access data from your own company'
        });
    }

    // Set companyId from token if not provided in request
    if (!requestedCompanyId) {
        req.query.companyId = payload.companyId;
        if (req.body) {
            req.body.companyId = payload.companyId;
        }
    }

    next();
}

/**
 * Optional auth - attaches user info if token present, but doesn't require it
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!token && req.session?.token) {
        token = req.session.token;
    }

    if (token) {
        const payload = decodeToken(token);
        if (payload) {
            req.userId = payload.userId;
            req.companyId = payload.companyId;
            req.tokenPayload = payload;
        }
    }

    next();
}

module.exports = {
    createToken,
    decodeToken,
    decodePlatformToken,
    requireAuth,
    requireCompanyAccess,
    optionalAuth,
    Config,
};
