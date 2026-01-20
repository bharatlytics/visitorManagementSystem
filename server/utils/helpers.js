/**
 * Utility Functions
 * Matching Python app/utils.py
 */
const { ObjectId } = require('mongodb');

/**
 * Validate required fields in request body
 */
function validateRequiredFields(data, requiredFields) {
    const missing = [];
    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
            missing.push(field);
        }
    }
    if (missing.length > 0) {
        return { valid: false, missing };
    }
    return { valid: true };
}

/**
 * Create error response
 */
function errorResponse(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

/**
 * Validate email format
 */
function validateEmailFormat(email) {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate phone format
 */
function validatePhoneFormat(phone) {
    if (!phone) return true; // Optional field
    // Allow various phone formats
    const phoneRegex = /^[\d\s\-+()]{6,20}$/;
    return phoneRegex.test(phone);
}

/**
 * Get current UTC timestamp as ISO string
 */
function getCurrentUTC() {
    return new Date().toISOString();
}

/**
 * Convert ObjectIds to strings recursively
 */
function convertObjectIds(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (obj instanceof ObjectId) {
        return obj.toString();
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertObjectIds(item));
    }

    if (typeof obj === 'object' && obj.constructor === Object) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            // Convert _id to string
            if (key === '_id' && value instanceof ObjectId) {
                result[key] = value.toString();
            } else {
                result[key] = convertObjectIds(value);
            }
        }
        return result;
    }

    return obj;
}

/**
 * Parse ObjectId from string, return null if invalid
 */
function parseObjectId(id) {
    if (!id) return null;
    try {
        return new ObjectId(id);
    } catch (error) {
        return null;
    }
}

/**
 * Check if string is valid ObjectId
 */
function isValidObjectId(id) {
    if (!id) return false;
    try {
        new ObjectId(id);
        return ObjectId.isValid(id);
    } catch (error) {
        return false;
    }
}

/**
 * Sanitize string for safe storage
 */
function sanitizeString(str) {
    if (!str) return str;
    return str.trim();
}

/**
 * Generate a unique visitor/employee ID
 */
function generateUniqueId(prefix = 'VIS') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

module.exports = {
    validateRequiredFields,
    errorResponse,
    validateEmailFormat,
    validatePhoneFormat,
    getCurrentUTC,
    convertObjectIds,
    parseObjectId,
    isValidObjectId,
    sanitizeString,
    generateUniqueId,
};
