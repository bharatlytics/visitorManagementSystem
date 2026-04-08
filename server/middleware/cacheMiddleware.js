/**
 * Cache-Control Middleware
 * Adds Cache-Control headers to GET responses based on route configuration.
 * 
 * Usage:
 *   const { cacheFor } = require('./cacheMiddleware');
 *   router.get('/settings', cacheFor(300), handler);  // 5 min cache
 */

function cacheFor(seconds) {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') return next();
        res.set('Cache-Control', `private, max-age=${seconds}`);
        next();
    };
}

/**
 * Request timeout middleware
 * Aborts handler if it exceeds the specified time limit
 */
function requestTimeout(ms = 8000) {
    return (req, res, next) => {
        req.setTimeout(ms, () => {
            if (!res.headersSent) {
                res.status(504).json({ error: 'Request timeout' });
            }
        });
        next();
    };
}

module.exports = { cacheFor, requestTimeout };
