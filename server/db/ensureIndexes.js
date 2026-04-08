/**
 * VMS Database Index Migration
 * 
 * Executes the VMS indexes that were defined in db/index.js (ensureIndexes)
 * but were never called on serverless boot.
 * 
 * Run once: node server/db/ensureIndexes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { connectToDatabase } = require('./index');

const INDEXES = [
    // visitors — queried by companyId + phone/email/name
    { collection: 'visitors', index: { companyId: 1, status: 1 }, name: 'visitors_company_status' },
    { collection: 'visitors', index: { companyId: 1, phone: 1 }, name: 'visitors_company_phone' },
    { collection: 'visitors', index: { companyId: 1, email: 1 }, name: 'visitors_company_email' },

    // visits — the main transactional table
    { collection: 'visits', index: { companyId: 1, status: 1 }, name: 'visits_company_status' },
    { collection: 'visits', index: { companyId: 1, actualArrival: -1 }, name: 'visits_company_arrival' },
    { collection: 'visits', index: { companyId: 1, expectedArrival: -1 }, name: 'visits_company_expected' },
    { collection: 'visits', index: { visitorId: 1, status: 1 }, name: 'visits_visitor_status' },
    { collection: 'visits', index: { hostEmployeeId: 1 }, name: 'visits_host' },

    // employees — queried by companyId
    { collection: 'employees', index: { companyId: 1, status: 1 }, name: 'employees_company_status' },

    // locations/entities
    { collection: 'locations', index: { companyId: 1 }, name: 'locations_companyId' },

    // watchlist
    { collection: 'watchlist', index: { companyId: 1 }, name: 'watchlist_companyId' },

    // access_logs — large time-series collection
    { collection: 'access_logs', index: { companyId: 1, timestamp: -1 }, name: 'logs_company_time' },
    { collection: 'access_logs', index: { visitorId: 1, timestamp: -1 }, name: 'logs_visitor_time' },
];

async function ensureIndexes() {
    const db = await connectToDatabase();
    console.log('🔧 Creating VMS indexes...\n');

    let created = 0, skipped = 0;

    for (const idx of INDEXES) {
        try {
            const opts = { name: idx.name, background: true };
            if (idx.unique) opts.unique = true;
            await db.collection(idx.collection).createIndex(idx.index, opts);
            console.log(`  ✅ ${idx.collection}.${idx.name}`);
            created++;
        } catch (err) {
            if (err.codeName === 'IndexOptionsConflict' || err.code === 85) {
                console.log(`  ⏭️  ${idx.collection}.${idx.name} (already exists)`);
                skipped++;
            } else {
                console.error(`  ❌ ${idx.collection}.${idx.name}: ${err.message}`);
            }
        }
    }

    console.log(`\n✅ Done: ${created} created, ${skipped} skipped`);
    process.exit(0);
}

ensureIndexes().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
