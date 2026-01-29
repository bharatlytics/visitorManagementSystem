/**
 * VMS Configuration Settings
 * 
 * NOTE: Mode (standalone vs connected) is NOT configured here.
 * It's determined per-session based on how the user accessed the app:
 * - Direct access → local login → own DB
 * - From Platform → SSO token → platform API
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const Config = {
    // Flask session secret equivalent
    SECRET_KEY: process.env.JWT_SECRET || 'vms-secret-key-change-in-production',

    // MongoDB - VMS's own database (always used for visitors/visits)
    VMS_MONGODB_URI: process.env.VMS_MONGODB_URI || 'mongodb://localhost:27017/vms_db',

    // JWT for local auth
    JWT_SECRET: process.env.JWT_SECRET || 'supersecret',
    JWT_ALGORITHM: 'HS256',
    JWT_EXPIRY_HOURS: 24,

    // Platform JWT Secret (for validating SSO tokens from platform - must match platform's JWT_SECRET_KEY)
    PLATFORM_JWT_SECRET: process.env.PLATFORM_JWT_SECRET || 'supersecret',

    // VMS App ID - must match the Platform's registered app ID
    APP_ID: process.env.VMS_APP_ID || 'app_bharatlytics_vms_366865a4',

    // Platform API (used when user comes via platform SSO)
    PLATFORM_API_URL: process.env.PLATFORM_API_URL || 'http://localhost:5000',

    // Platform Web URL (for "Exit App" navigation back to platform)
    PLATFORM_WEB_URL: process.env.PLATFORM_WEB_URL || 'http://localhost:5000',

    // VMS App URL (this app's publicly accessible URL - used for manifest sync)
    APP_URL: process.env.VMS_URL || 'http://localhost:5001',

    // Frontend URL (for SSO redirects - same as APP_URL in production, different in dev)
    FRONTEND_URL: process.env.FRONTEND_URL || process.env.VMS_URL || 'http://localhost:5173',

    // File uploads
    MAX_CONTENT_LENGTH: 16 * 1024 * 1024, // 16MB

    // Allowed embedding models (includes both legacy and new Platform models)
    ALLOWED_MODELS: ['facenet', 'arcface', 'vggface', 'buffalo_l', 'mobile_facenet_v1'],

    // SMTP Configuration (for Host Notifications)
    MAIL_SERVER: process.env.MAIL_SERVER || 'smtp.gmail.com',
    MAIL_PORT: parseInt(process.env.MAIL_PORT || '587', 10),
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
    MAIL_USE_TLS: (process.env.MAIL_USE_TLS || 'true').toLowerCase() === 'true',
    MAIL_DEFAULT_SENDER: process.env.MAIL_DEFAULT_SENDER || 'noreply@vms.com',

    // CORS Origins
    CORS_ORIGINS: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3000'],

    // Node environment
    NODE_ENV: process.env.NODE_ENV || 'development',
};

console.log('[DEBUG] VMS Config Loaded:');
console.log('[DEBUG] JWT_SECRET:', Config.JWT_SECRET ? Config.JWT_SECRET.substring(0, 5) + '...' : 'MISSING');
console.log('[DEBUG] PLATFORM_JWT_SECRET:', Config.PLATFORM_JWT_SECRET ? Config.PLATFORM_JWT_SECRET.substring(0, 5) + '...' : 'MISSING');

module.exports = Config;
