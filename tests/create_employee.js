
const { MongoClient, ObjectId } = require('mongodb');
const Config = require('../server/config');

async function createEmployee() {
    const client = new MongoClient(Config.VMS_MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();

        const employee = {
            _id: new ObjectId(),
            companyId: new ObjectId('507f1f77bcf86cd799439011'),
            employeeId: 'EMP_TEST_001',
            employeeName: 'Test Host',
            email: 'host@example.com',
            phone: '+919876543210',
            status: 'active',
            createdAt: new Date()
        };

        await db.collection('employees').insertOne(employee);
        console.log('CREATED_EMPLOYEE_ID:', employee._id.toString());
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.close();
    }
}

createEmployee();
