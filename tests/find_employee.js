
const { MongoClient } = require('mongodb');
const Config = require('../server/config');
const fs = require('fs');
const path = require('path');

async function findEmployee() {
    const client = new MongoClient(Config.VMS_MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();
        const employee = await db.collection('employees').findOne({ status: 'active' });

        if (employee) {
            console.log('FOUND_EMPLOYEE:', employee._id.toString());
            fs.writeFileSync(path.join(__dirname, 'employee_id.txt'), employee._id.toString());
        } else {
            console.log('NO_ACTIVE_EMPLOYEES_FOUND');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.close();
    }
}

findEmployee();
