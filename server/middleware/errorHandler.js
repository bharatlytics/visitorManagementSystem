/**
 * Error Handler Middleware
 */

/**
 * Not Found Handler - for API routes that don't exist
 */
function notFoundHandler(req, res, next) {
    res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
    });
}

/**
 * Global Error Handler
 */
function errorHandler(err, req, res, next) {
    console.error('[Error]', err);

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            message: err.message,
            details: err.errors,
        });
    }

    // Mongoose duplicate key error
    if (err.code === 11000) {
        return res.status(409).json({
            success: false,
            error: 'Duplicate Entry',
            message: 'A record with this value already exists',
            field: Object.keys(err.keyPattern || {})[0],
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            error: 'Invalid Token',
            message: 'The provided token is invalid',
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            error: 'Token Expired',
            message: 'The provided token has expired',
        });
    }

    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
        success: false,
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
}

module.exports = {
    notFoundHandler,
    errorHandler,
};
