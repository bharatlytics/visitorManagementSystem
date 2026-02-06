/**
 * Backfill QR Codes for Existing Visits
 * 
 * Usage: node scripts/backfill-qrcodes.js
 * 
 * This script adds a qrCode field to all visits that don't have one.
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

// MongoDB connection string from environment
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function backfillQrCodes() {
    if (!MONGODB_URI) {
        console.error('ERROR: MONGODB_URI or MONGO_URI environment variable not set');
        console.log('Set it in .env file or export it:');
        console.log('  export MONGODB_URI="mongodb+srv://..."');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected successfully!');

        const db = client.db(); // Uses default database from URI
        const visitsCollection = db.collection('visits');

        // Find all visits without qrCode
        const query = {
            $or: [
                { qrCode: { $exists: false } },
                { qrCode: null },
                { qrCode: '' }
            ]
        };

        const visitsWithoutQr = await visitsCollection.find(query).toArray();
        console.log(`\nFound ${visitsWithoutQr.length} visits without qrCode`);

        if (visitsWithoutQr.length === 0) {
            console.log('All visits already have qrCode. Nothing to do!');
            return;
        }

        // Show preview
        console.log('\nSample visits to update:');
        visitsWithoutQr.slice(0, 5).forEach(visit => {
            console.log(`  - ${visit._id}: ${visit.visitorName || 'Unknown'} (${visit.status})`);
        });
        if (visitsWithoutQr.length > 5) {
            console.log(`  ... and ${visitsWithoutQr.length - 5} more`);
        }

        // Build bulk update operations
        const bulkOps = visitsWithoutQr.map(visit => ({
            updateOne: {
                filter: { _id: visit._id },
                update: {
                    $set: {
                        qrCode: new ObjectId().toString(),
                        lastUpdated: new Date()
                    }
                }
            }
        }));

        console.log('\nExecuting bulk update...');
        const result = await visitsCollection.bulkWrite(bulkOps);

        console.log('\n✅ BACKFILL COMPLETE!');
        console.log(`   Matched: ${result.matchedCount}`);
        console.log(`   Modified: ${result.modifiedCount}`);

        // Verify
        const remainingWithoutQr = await visitsCollection.countDocuments(query);
        console.log(`\n   Remaining without qrCode: ${remainingWithoutQr}`);

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        throw error;
    } finally {
        await client.close();
        console.log('\nConnection closed.');
    }
}

// Run the script
backfillQrCodes()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
