const { connectToDatabase, collections } = require('./db');
const Config = require('./config');

async function run() {
    try {
        await connectToDatabase();
        console.log('Connected to DB');
        const employees = await collections.employees().find({}).toArray();
        console.log(`Found ${employees.length} employees`);
        employees.forEach(emp => {
            console.log(`_id: ${emp._id}, employeeId: ${emp.employeeId}, status: ${emp.status}, blacklisted: ${emp.blacklisted}, name: ${emp.name}`);
        });
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
