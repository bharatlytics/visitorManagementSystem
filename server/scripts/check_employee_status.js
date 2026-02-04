/**
 * Debug Script: Check Employee Status
 * 
 * This script checks the status of employees in VMS local DB
 * 
 * Run with: node server/scripts/check_employee_status.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.VMS_MONGODB_URI || process.env.MONGODB_URI;

async function checkEmployeeStatus() {
    if (!MONGODB_URI) {
        console.error('Error: VMS_MONGODB_URI or MONGODB_URI not set');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    console.log('URI:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        console.log('Database:', db.databaseName);

        const employees = db.collection('employees');

        // Find employees with email shashwatg3@gmail.com
        console.log('\n--- Employees with email shashwatg3@gmail.com ---');
        const byEmail = await employees.find({
            email: { $regex: /shashwatg3/i }
        }).toArray();

        console.log(`Found ${byEmail.length} employees`);
        for (const emp of byEmail) {
            console.log(`  _id: ${emp._id}`);
            console.log(`  employeeId: ${emp.employeeId}`);
            console.log(`  employeeName: ${emp.employeeName}`);
            console.log(`  email: ${emp.email}`);
            console.log(`  status: ${emp.status}`);
            console.log(`  deletedAt: ${emp.deletedAt}`);
            console.log('---');
        }

        // Find employees with employeeId 39225 or 39226
        console.log('\n--- Employees with employeeId 39225 or 39226 ---');
        const byId = await employees.find({
            $or: [
                { employeeId: '39225' },
                { employeeId: '39226' },
                { employeeId: { $regex: /3922/ } }
            ]
        }).toArray();

        console.log(`Found ${byId.length} employees`);
        for (const emp of byId) {
            console.log(`  _id: ${emp._id}`);
            console.log(`  employeeId: ${emp.employeeId}`);
            console.log(`  employeeName: ${emp.employeeName}`);
            console.log(`  email: ${emp.email}`);
            console.log(`  status: ${emp.status}`);
            console.log(`  deletedAt: ${emp.deletedAt}`);
            console.log('---');
        }

        // Count by status
        console.log('\n--- Employee Status Summary ---');
        const statusCounts = await employees.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        for (const s of statusCounts) {
            console.log(`  ${s._id || 'null'}: ${s.count}`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nDone.');
    }
}

checkEmployeeStatus();
