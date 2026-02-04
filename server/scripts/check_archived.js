/**
 * Debug Script: Check for Archived Employees
 * 
 * Run with: node server/scripts/check_archived.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.VMS_MONGODB_URI || process.env.MONGODB_URI;

async function checkArchived() {
    if (!MONGODB_URI) {
        console.error('Error: VMS_MONGODB_URI or MONGODB_URI not set');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const employees = db.collection('employees');

        // Find archived employees
        console.log('\n--- Archived Employees (with _archived_ in employeeId) ---');
        const archived = await employees.find({
            employeeId: { $regex: /_archived_/i }
        }).toArray();

        console.log(`Found ${archived.length} archived employees`);
        for (const emp of archived) {
            console.log(`  _id: ${emp._id}`);
            console.log(`  employeeId: ${emp.employeeId}`);
            console.log(`  originalEmployeeId: ${emp.originalEmployeeId}`);
            console.log(`  email: ${emp.email}`);
            console.log(`  originalEmail: ${emp.originalEmail}`);
            console.log(`  status: ${emp.status}`);
            console.log(`  archivedAt: ${emp.archivedAt}`);
            console.log('---');
        }

        // Find deleted employees (status = deleted)
        console.log('\n--- Deleted Employees (status = deleted) ---');
        const deleted = await employees.find({
            status: 'deleted'
        }).toArray();

        console.log(`Found ${deleted.length} deleted employees`);
        for (const emp of deleted) {
            console.log(`  _id: ${emp._id}`);
            console.log(`  employeeId: ${emp.employeeId}`);
            console.log(`  email: ${emp.email}`);
            console.log(`  deletedAt: ${emp.deletedAt}`);
            console.log('---');
        }

        // Summary
        console.log('\n--- Summary ---');
        const totalCount = await employees.countDocuments();
        const activeCount = await employees.countDocuments({ status: { $ne: 'deleted' } });
        const deletedCount = await employees.countDocuments({ status: 'deleted' });
        const archivedCount = await employees.countDocuments({ employeeId: { $regex: /_archived_/i } });

        console.log(`Total employees: ${totalCount}`);
        console.log(`Active: ${activeCount}`);
        console.log(`Deleted: ${deletedCount}`);
        console.log(`Archived: ${archivedCount}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nDone.');
    }
}

checkArchived();
