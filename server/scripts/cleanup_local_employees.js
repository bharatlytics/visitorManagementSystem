/**
 * Cleanup Script: Delete all local employees for Platform-mode companies
 * 
 * This script removes stale local employee data since data resides on Platform
 * 
 * Run with: node server/scripts/cleanup_local_employees.js <companyId>
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.VMS_MONGODB_URI || process.env.MONGODB_URI;
const companyId = process.argv[2] || '6827296ab6e06b08639107c4'; // Default to the company from earlier

async function cleanupLocalEmployees() {
    if (!MONGODB_URI) {
        console.error('Error: VMS_MONGODB_URI or MONGODB_URI not set');
        process.exit(1);
    }

    console.log(`Cleaning up local employees for company: ${companyId}`);
    console.log('Connecting to MongoDB...');

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const employees = db.collection('employees');

        // Count before
        const beforeCount = await employees.countDocuments({
            companyId: ObjectId.isValid(companyId) ? new ObjectId(companyId) : companyId
        });
        console.log(`Found ${beforeCount} employees for this company`);

        if (beforeCount === 0) {
            console.log('No employees to delete.');
            return;
        }

        // Delete all employees for this company
        console.log('Deleting all local employees for this company...');
        const result = await employees.deleteMany({
            companyId: ObjectId.isValid(companyId) ? new ObjectId(companyId) : companyId
        });

        console.log(`Deleted ${result.deletedCount} employees`);

        // Verify
        const afterCount = await employees.countDocuments({
            companyId: ObjectId.isValid(companyId) ? new ObjectId(companyId) : companyId
        });
        console.log(`Remaining employees for this company: ${afterCount}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nDone.');
    }
}

cleanupLocalEmployees();
