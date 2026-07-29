/**
 * VMS RBAC Middleware - Role-Based Access Control Helpers
 * 
 * Provides route-level middleware for enforcing permission levels and features
 * from the Platform's permission role system.
 * 
 * Usage:
 *   const { requireLevel, requireFeature, enrichRBAC } = require('./rbac');
 *   
 *   router.get('/settings', requireLevel('admin'), getSettings);
 *   router.post('/visits/:id/checkin', requireLevel('operator'), requireFeature('visits'), checkIn);
 *   router.get('/visitors', requireFeature('visitors'), listVisitors);
 */

// Level hierarchy (viewer < operator < manager < admin)
const LEVEL_HIERARCHY = { viewer: 0, operator: 1, manager: 2, admin: 3 };

/**
 * Enrich request with standardized RBAC object from token/permissions.
 * Should be called after auth middleware populates req.permissions and req.userRole.
 * 
 * Populates req.rbac with:
 *   - level: viewer | operator | manager | admin
 *   - features: string[] (empty = all features allowed)
 *   - entityScope: inherited | all | custom
 *   - isAdmin, isManager, isOperator: boolean helpers
 *   - canAccess(feature): boolean
 *   - hasMinLevel(required): boolean
 */
function enrichRBAC(req) {
    const permissions = req.permissions || {};
    const userRole = req.userRole || 'employee';
    
    // Determine effective level
    const adminRoles = ['admin', 'company_admin', 'company_super_admin', 'platform_admin'];
    const isLegacyAdmin = adminRoles.includes(userRole);
    const level = permissions.level || (isLegacyAdmin ? 'admin' : 'viewer');
    
    const rbac = {
        level,
        features: permissions.features || [],
        entityScope: permissions.entityScope || 'all',
        
        // Computed boolean helpers
        isAdmin: level === 'admin',
        isManager: LEVEL_HIERARCHY[level] >= LEVEL_HIERARCHY.manager,
        isOperator: LEVEL_HIERARCHY[level] >= LEVEL_HIERARCHY.operator,
        isViewer: LEVEL_HIERARCHY[level] >= LEVEL_HIERARCHY.viewer,
        
        /**
         * Check if user can access a specific feature.
         * Empty features array = all features allowed (backward compatible).
         */
        canAccess(feature) {
            if (!this.features || this.features.length === 0) return true;
            return this.features.includes(feature);
        },
        
        /**
         * Check if user meets the minimum level requirement.
         * Uses hierarchy: viewer(0) < operator(1) < manager(2) < admin(3)
         */
        hasMinLevel(required) {
            return (LEVEL_HIERARCHY[this.level] || 0) >= (LEVEL_HIERARCHY[required] || 0);
        }
    };
    
    req.rbac = rbac;
    return rbac;
}

/**
 * Route middleware: require minimum permission level.
 * 
 * @param {string} minLevel - Minimum required level (viewer|operator|manager|admin)
 * @returns Express middleware
 * 
 * Example:
 *   router.put('/settings', requireLevel('admin'), updateSettings);
 *   router.post('/checkin', requireLevel('operator'), doCheckin);
 */
function requireLevel(minLevel) {
    return (req, res, next) => {
        // Ensure RBAC is populated
        if (!req.rbac) enrichRBAC(req);
        
        if (!req.rbac.hasMinLevel(minLevel)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `This action requires '${minLevel}' level or higher. Your level: '${req.rbac.level}'.`,
                required: minLevel,
                current: req.rbac.level
            });
        }
        next();
    };
}

/**
 * Route middleware: require access to a specific feature.
 * 
 * @param {string} feature - Feature ID from app manifest (e.g. 'visitors', 'settings', 'watchlist')
 * @returns Express middleware
 * 
 * Example:
 *   router.get('/blacklist', requireFeature('watchlist'), listBlacklist);
 *   router.get('/reports', requireFeature('reports'), getReports);
 */
function requireFeature(feature) {
    return (req, res, next) => {
        // Ensure RBAC is populated
        if (!req.rbac) enrichRBAC(req);
        
        if (!req.rbac.canAccess(feature)) {
            return res.status(403).json({
                error: 'Feature access denied',
                message: `You do not have access to the '${feature}' feature.`,
                required: feature
            });
        }
        next();
    };
}

/**
 * Combined middleware: require both level AND feature.
 * 
 * @param {string} minLevel - Minimum required level
 * @param {string} feature - Required feature
 * @returns Express middleware
 */
function requireLevelAndFeature(minLevel, feature) {
    return (req, res, next) => {
        if (!req.rbac) enrichRBAC(req);
        
        if (!req.rbac.hasMinLevel(minLevel)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `This action requires '${minLevel}' level or higher.`,
                required: minLevel,
                current: req.rbac.level
            });
        }
        
        if (!req.rbac.canAccess(feature)) {
            return res.status(403).json({
                error: 'Feature access denied',
                message: `You do not have access to the '${feature}' feature.`,
                required: feature
            });
        }
        
        next();
    };
}

module.exports = {
    enrichRBAC,
    requireLevel,
    requireFeature,
    requireLevelAndFeature,
    LEVEL_HIERARCHY
};
