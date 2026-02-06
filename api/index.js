/**
 * Vercel Serverless API Entry Point
 * This file exports the Express app as a serverless function
 * Complete VMS Node.js Backend
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const compression = require('compression');
const session = require('express-session');

const { connectToDatabase } = require('../server/db');
const Config = require('../server/config');

// Create Express app
const app = express();

// Disable strict routing to prevent 308 redirects that lose Authorization headers
// This treats /api/visitors and /api/visitors/ as the same route
app.set('strict routing', false);
app.set('case sensitive routing', false);


// ===========================================
// Security Middleware
// ===========================================

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(compression());

if (Config.NODE_ENV !== 'test') {
    app.use(morgan(Config.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// CORS Configuration
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (Config.CORS_ORIGINS.includes(origin) || Config.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(null, true); // Allow all in serverless for now
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { success: false, message: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/auth/login', limiter);
app.use('/api/auth/register', limiter);
app.use('/auth/login', limiter);
app.use('/auth/register', limiter);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware (for SSO)
app.use(session({
    secret: Config.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: Config.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// ===========================================
// URL Normalization - Strip trailing slashes
// This prevents issues where Authorization headers are lost
// ===========================================



app.use((req, res, next) => {
    // Strip trailing slashes from URL (except for root '/') by rewriting the URL
    // We rewrite instead of redirect to preserve all headers including Authorization
    if (req.path.length > 1 && req.path.endsWith('/')) {
        const query = req.url.slice(req.path.length);
        req.url = req.path.slice(0, -1) + query;
    }
    next();
});



// ===========================================
// Database Connection Middleware
// ===========================================

app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).json({ success: false, message: 'Database connection failed' });
    }
});

// ===========================================
// Import Routes
// ===========================================

// Core Routes
const authRoutes = require('../server/routes/auth');
const visitorRoutes = require('../server/routes/visitors');
const employeeRoutes = require('../server/routes/employees');
const entityRoutes = require('../server/routes/entities');
const deviceRoutes = require('../server/routes/devices');
const dashboardRoutes = require('../server/routes/dashboard');
const badgeRoutes = require('../server/routes/badge');

// Extended Routes
const watchlistRoutes = require('../server/routes/watchlist');
const analyticsRoutes = require('../server/routes/analytics');
const settingsRoutes = require('../server/routes/settings');
const reportsRoutes = require('../server/routes/reports');
const approvalsRoutes = require('../server/routes/approvals');
const preregistrationRoutes = require('../server/routes/preregistration');
const mobileRoutes = require('../server/routes/mobile');
const webhooksRoutes = require('../server/routes/webhooks');
const attendanceRoutes = require('../server/routes/attendance');
const advancedAnalyticsRoutes = require('../server/routes/advanced-analytics');

// User & Company Management
const usersRoutes = require('../server/routes/users');
const companyRoutes = require('../server/routes/company');

// Platform Integration Routes
const federatedQueryRoutes = require('../server/routes/federated_query');
const syncPullRoutes = require('../server/routes/sync_pull');
const residencyRoutes = require('../server/routes/residency');

// Enterprise APIs
const evacuationRoutes = require('../server/routes/evacuation');
const auditRoutes = require('../server/routes/audit');
const gdprRoutes = require('../server/routes/gdpr');
const accessControlRoutes = require('../server/routes/access_control');

// Import error handlers
const { errorHandler, notFoundHandler } = require('../server/middleware/errorHandler');

// ===========================================
// Health Check
// ===========================================

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        app: 'VMS',
        version: '2.0.0-nodejs',
        timestamp: new Date().toISOString(),
        environment: Config.NODE_ENV
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', app: 'VMS', version: '2.0.0-nodejs' });
});

// Root route - redirect to frontend (for SSO and browser access)
app.get('/', (req, res) => {
    if (Config.NODE_ENV === 'development') {
        // In development, redirect to Vite dev server
        return res.redirect('http://localhost:5173');
    }
    // In production on Vercel, this shouldn't be hit (Vercel serves index.html)
    // But if it is, redirect to index.html
    res.redirect('/index.html');
});

// ===========================================
// Mount Routes
// ===========================================

// Auth routes (no /api prefix - matches Flask)
app.use('/auth', authRoutes);

// Core API routes
app.use('/api/visitors', visitorRoutes);
app.use('/api/visits', visitorRoutes); // Alias - reuses /visits/* routes from visitorRoutes
app.use('/api/employees', employeeRoutes);
app.use('/api/locations', entityRoutes);
app.use('/api/entities', entityRoutes); // Alias
app.use('/api/devices', deviceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/badge', badgeRoutes);
app.use('/api/advanced-analytics', advancedAnalyticsRoutes);

// Extended API routes
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/preregistration', preregistrationRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/attendance', attendanceRoutes);

// Platform Integration APIs
app.use('/api/query', federatedQueryRoutes);
app.use('/api/sync/pull', syncPullRoutes);
app.use('/api/residency', residencyRoutes);

// Enterprise APIs
app.use('/api/emergency', evacuationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/gdpr', gdprRoutes);
app.use('/api/access', accessControlRoutes);

// User & Company Management APIs
app.use('/api/users', usersRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/companies', companyRoutes);  // Alias

// =============================================
// Error Handlers
// ===========================================

app.use('/api/*', notFoundHandler);
app.use(errorHandler);

// ===========================================
// Export for Vercel
// ===========================================

module.exports = app;
