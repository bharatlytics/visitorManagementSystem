/**
 * Feature Access Middleware
 * 
 * Enforces granular, per-feature access control based on permission roles
 * assigned via the Platform's RBAC system.
 * 
 * Usage:
 *   router.get('/visits', requireAuth, requireFeature('visits'), controller.list);
 *   router.get('/reports', requireAuth, requireFeature('reports'), controller.list);
 *   router.post('/settings', requireAuth, requireLevel('manager'), controller.update);
 */

/**
 * Require specific feature access.
 * If user has no permissions object (legacy user), access is granted (backward compatible).
 * If user has permissions with empty features array, all features are granted (admin).
 * Otherwise, the feature must be in the features list.
 */
function requireFeature(featureId) {
    return (req, res, next) => {
        const permissions = req.permissions;

        // No permissions = legacy user or admin → allow (backward compatible)
        if (!permissions) return next();

        const features = permissions.features || [];

        // Empty features array = all features granted (admin/super admin)
        if (features.length === 0) return next();

        // Check if the required feature is in the user's allowed features
        if (!features.includes(featureId)) {
            return res.status(403).json({
                error: 'Feature access denied',
                message: `You do not have access to the "${featureId}" feature`,
                requiredFeature: featureId,
                yourFeatures: features
            });
        }

        next();
    };
}

/**
 * Require minimum permission level.
 * Levels (lowest to highest): viewer < operator < manager < admin
 */
function requireLevel(minimumLevel) {
    const levelHierarchy = {
        'viewer': 1,
        'operator': 2,
        'manager': 3,
        'admin': 4
    };

    return (req, res, next) => {
        const permissions = req.permissions;

        // No permissions = legacy user → allow (backward compatible)
        if (!permissions) return next();

        const userLevel = permissions.level || 'viewer';
        const userRank = levelHierarchy[userLevel] || 0;
        const requiredRank = levelHierarchy[minimumLevel] || 0;

        if (userRank < requiredRank) {
            return res.status(403).json({
                error: 'Insufficient permission level',
                message: `This action requires "${minimumLevel}" level or higher`,
                yourLevel: userLevel,
                requiredLevel: minimumLevel
            });
        }

        next();
    };
}

module.exports = {
    requireFeature,
    requireLevel
};
