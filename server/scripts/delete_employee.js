/**
 * Utility Script: Delete Employee
 * 
 * This script soft-deletes an employee by ID or email
 * 
 * Run with: node server/scripts/delete_employee.js <employeeId or email>
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.VMS_MONGODB_URI || process.env.MONGODB_URI;
const target = process.argv[2];

async function deleteEmployee() {
    if (!MONGODB_URI) {
        console.error('Error: VMS_MONGODB_URI or MONGODB_URI not set');
        process.exit(1);
    }

    if (!target) {
        console.log('Usage: node delete_employee.js <employeeId or email>');
        console.log('Example: node delete_employee.js 39225');
        console.log('Example: node delete_employee.js shashwatg3@gmail.com');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const employees = db.collection('employees');

        // Find employee
        const query = target.includes('@')
            ? { email: target }
            : { employeeId: target };

        console.log(`Finding employee with: ${JSON.stringify(query)}`);
        const employee = await employees.findOne(query);

        if (!employee) {
            console.log('Employee not found');
            return;
        }

        console.log(`Found employee:`);
        console.log(`  _id: ${employee._id}`);
        console.log(`  employeeId: ${employee.employeeId}`);
        console.log(`  employeeName: ${employee.employeeName}`);
        console.log(`  email: ${employee.email}`);
        console.log(`  status: ${employee.status}`);

        if (employee.status === 'deleted') {
            console.log('Employee is already deleted');
            return;
        }

        // Soft delete
        console.log('\nSoft deleting employee...');
        const result = await employees.updateOne(
            { _id: employee._id },
            {
                $set: {
                    status: 'deleted',
                    deletedAt: new Date(),
                    lastUpdated: new Date()
                }
            }
        );

        console.log(`Modified ${result.modifiedCount} document(s)`);

        // Now archive it
        const timestamp = Date.now();
        const archiveId = `${employee.employeeId}_archived_${timestamp}`;
        const archiveEmail = employee.email ? `${employee.email}_archived_${timestamp}` : null;

        console.log('Archiving employee...');
        await employees.updateOne(
            { _id: employee._id },
            {
                $set: {
                    employeeId: archiveId,
                    email: archiveEmail,
                    originalEmployeeId: employee.employeeId,
                    originalEmail: employee.email,
                    archivedAt: new Date()
                }
            }
        );

        console.log(`Archived:`);
        console.log(`  employeeId: ${employee.employeeId} -> ${archiveId}`);
        console.log(`  email: ${employee.email} -> ${archiveEmail}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nDone.');
    }
}

deleteEmployee();
