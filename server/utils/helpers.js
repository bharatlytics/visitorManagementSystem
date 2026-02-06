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

/**
 * Rewrite embedding download URLs to use VMS proxy URLs
 * Matching Python app/api/employees.py and visitors.py pattern
 * 
 * IMPORTANT: 
 * - visitorEmbeddings/employeeEmbeddings are stored in VMS GridFS -> use VMS baseUrl
 * - actorEmbeddings from Platform are stored in Platform GridFS -> use platformUrl if provided
 * 
 * @param {Array|Object} records - Single record or array of records (employees/visitors)
 * @param {string} baseUrl - VMS base URL (e.g., http://localhost:5001)
 * @param {string} entityType - 'employees' or 'visitors' for URL path
 * @param {string} platformUrl - Optional. If provided, links actorEmbeddings to Platform.
 */
function rewriteEmbeddingUrls(records, baseUrl, entityType = 'employees', platformUrl = null) {
    const recordsArray = Array.isArray(records) ? records : [records];

    for (const record of recordsArray) {
        // Handle Platform actorEmbeddings (stored in Platform GridFS)
        if (record.actorEmbeddings) {
            for (const [model, embData] of Object.entries(record.actorEmbeddings)) {
                if (embData && typeof embData === 'object' && embData.status === 'done') {
                    let embeddingId = embData.embeddingId;

                    // Extract embedding ID from existing URL if present
                    if (embData.downloadUrl && embData.downloadUrl.includes('/embeddings/')) {
                        embeddingId = embData.downloadUrl.split('/embeddings/').pop();
                    }

                    if (embeddingId) {
                        if (platformUrl) {
                            // DIRECT LINK to Platform (for Platform-stored embeddings)
                            // /bharatlytics/v1/actors/embeddings/:id
                            embData.downloadUrl = `${platformUrl}/bharatlytics/v1/actors/embeddings/${embeddingId}`;
                        } else {
                            // PROXY through VMS
                            embData.downloadUrl = `${baseUrl}/api/${entityType}/embeddings/${embeddingId}`;
                        }
                    }
                }
            }
        }

        // Handle legacy VMS embeddings (employeeEmbeddings / visitorEmbeddings)
        // These are stored in VMS GridFS, so ALWAYS use VMS baseUrl (not Platform!)
        const legacyKey = entityType === 'employees' ? 'employeeEmbeddings' : 'visitorEmbeddings';
        if (record[legacyKey]) {
            for (const [model, embData] of Object.entries(record[legacyKey])) {
                if (embData && typeof embData === 'object') {
                    const embeddingId = embData.embeddingId;

                    if (embeddingId) {
                        // VMS embeddings are always served from VMS, not Platform
                        embData.downloadUrl = `${baseUrl}/api/${entityType}/embeddings/${embeddingId}`;
                    }
                }
            }
        }
    }

    return records;
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
    rewriteEmbeddingUrls,
};
