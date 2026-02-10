/**
 * VMS Database Connection
 * MongoDB + GridFS setup matching Python db.py
 */
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const Config = require('../config');

// Database connection state
let cachedDb = null;
let gridFSBuckets = {};

/**
 * Connect to MongoDB (cached for serverless)
 */
async function connectToDatabase() {
    // Return cached connection if valid
    if (cachedDb && mongoose.connection.readyState === 1 && cachedDb.db) {
        return cachedDb;
    }

    const MONGODB_URI = Config.VMS_MONGODB_URI;
    if (!MONGODB_URI) {
        throw new Error('VMS_MONGODB_URI not defined');
    }

    console.log(`[DB] Connecting to MongoDB...`);

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
        bufferCommands: false,
    });

    // Wait for the db object to be available
    cachedDb = mongoose.connection;

    // mongoose.connection.db may not be immediately available, wait for it
    if (!cachedDb.db) {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for MongoDB connection'));
            }, 10000);

            cachedDb.once('open', () => {
                clearTimeout(timeout);
                resolve();
            });

            cachedDb.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    console.log(`[DB] Connected to MongoDB: ${cachedDb.db.databaseName}`);

    // Initialize GridFS buckets
    initGridFSBuckets(cachedDb.db);

    // Create indexes
    await ensureIndexes();

    return cachedDb;
}

/**
 * Initialize GridFS buckets for file storage
 */
function initGridFSBuckets(db) {
    gridFSBuckets = {
        visitorImages: new GridFSBucket(db, { bucketName: 'visitor_images' }),
        visitorEmbeddings: new GridFSBucket(db, { bucketName: 'visitor_embeddings' }),
        employeeImages: new GridFSBucket(db, { bucketName: 'employee_images' }),
        employeeEmbeddings: new GridFSBucket(db, { bucketName: 'employee_embeddings' }),
    };
}

/**
 * Get GridFS bucket by name
 */
function getGridFSBucket(name) {
    return gridFSBuckets[name];
}

/**
 * Get a collection by name
 */
function getCollection(name) {
    if (!cachedDb) {
        throw new Error('Database not connected');
    }
    return cachedDb.db.collection(name);
}

/**
 * Get the database instance
 */
function getDb() {
    if (!cachedDb) {
        throw new Error('Database not connected');
    }
    return cachedDb.db;
}

// Collection accessors (matching Python naming)
const collections = {
    visitors: () => getCollection('visitors'),
    visits: () => getCollection('visits'),
    employees: () => getCollection('employees'),
    locations: () => getCollection('locations'),
    devices: () => getCollection('devices'),
    settings: () => getCollection('settings'),
    companies: () => getCollection('companies'),
    users: () => getCollection('users'),
    attendance: () => getCollection('attendance'),
    syncAuditLogs: () => getCollection('sync_audit_logs'),
    embeddingJobs: () => getCollection('embedding_jobs'),
    approvals: () => getCollection('approvals'),
    approvalTokens: () => getCollection('approval_tokens'),
};

/**
 * Create database indexes for uniqueness and performance
 */
async function ensureIndexes() {
    try {
        const db = getDb();

        // Visitors: Unique phone per company
        await db.collection('visitors').createIndex(
            { companyId: 1, phone: 1 },
            { unique: true, name: 'unique_visitor_phone_per_company', sparse: true }
        );

        // Visitors: Index on email for lookups
        await db.collection('visitors').createIndex(
            { companyId: 1, email: 1 },
            { name: 'visitor_email_lookup', sparse: true }
        );

        // Employees: Unique employeeId per company
        await db.collection('employees').createIndex(
            { companyId: 1, employeeId: 1 },
            { unique: true, name: 'unique_employee_id_per_company', sparse: true }
        );

        // Employees: Unique email per company
        await db.collection('employees').createIndex(
            { companyId: 1, email: 1 },
            { unique: true, name: 'unique_employee_email_per_company', sparse: true }
        );

        // Visits: Index for querying visits by visitor
        await db.collection('visits').createIndex(
            { companyId: 1, visitorId: 1, status: 1 },
            { name: 'visit_by_visitor_status' }
        );

        // Visits: Index for date-based queries
        await db.collection('visits').createIndex(
            { companyId: 1, expectedArrival: 1 },
            { name: 'visit_by_date' }
        );

        // Locations: Unique name per company
        await db.collection('locations').createIndex(
            { companyId: 1, name: 1 },
            { unique: true, name: 'unique_location_name_per_company', sparse: true }
        );

        // Companies: Unique by name
        await db.collection('companies').createIndex(
            { name: 1 },
            { unique: true, name: 'unique_company_name', sparse: true }
        );

        // Users: Unique username
        await db.collection('users').createIndex(
            { username: 1 },
            { unique: true, name: 'unique_username', sparse: true }
        );

        console.log('[DB] Database indexes ensured');
    } catch (error) {
        console.log(`[DB] Index creation warning (may already exist): ${error.message}`);
    }
}

module.exports = {
    connectToDatabase,
    getDb,
    getCollection,
    getGridFSBucket,
    collections,
    gridFSBuckets: () => gridFSBuckets,
};
