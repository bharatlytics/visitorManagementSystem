/**
 * Migration Script: Archive Deleted Employees
 * 
 * This script archives all existing deleted employees by renaming their
 * employeeId and email fields to avoid unique index conflicts.
 * 
 * Run with: node server/scripts/archive_deleted_employees.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.VMS_MONGODB_URI || process.env.MONGODB_URI;

async function archiveDeletedEmployees() {
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

        console.log('Finding deleted employees...');
        const deletedEmployees = await employees.find({
            status: 'deleted',
            archivedAt: { $exists: false } // Only process not-yet-archived
        }).toArray();

        console.log(`Found ${deletedEmployees.length} deleted employees to archive`);

        let archivedCount = 0;
        for (const employee of deletedEmployees) {
            const timestamp = employee.deletedAt ?
                new Date(employee.deletedAt).getTime() :
                Date.now();

            const updates = {
                archivedAt: new Date()
            };

            // Archive employeeId if exists
            if (employee.employeeId && !employee.employeeId.includes('_archived_')) {
                updates.originalEmployeeId = employee.employeeId;
                updates.employeeId = `${employee.employeeId}_archived_${timestamp}`;
                console.log(`  Archiving employeeId: ${employee.employeeId} -> ${updates.employeeId}`);
            }

            // Archive email if exists
            if (employee.email && !employee.email.includes('_archived_')) {
                updates.originalEmail = employee.email;
                updates.email = `${employee.email}_archived_${timestamp}`;
                console.log(`  Archiving email: ${employee.email} -> ${updates.email}`);
            }

            if (Object.keys(updates).length > 1) { // More than just archivedAt
                await employees.updateOne(
                    { _id: employee._id },
                    { $set: updates }
                );
                archivedCount++;
            }
        }

        console.log(`\nArchived ${archivedCount} employees successfully`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('Done.');
    }
}

archiveDeletedEmployees();
