const { connectToDatabase, collections } = require('./db');
const { getResidencyMode } = require('./services/residency_detector');
const { getDataProvider } = require('./services/data_provider');

async function run() {
    await connectToDatabase();
    console.log('Connected to DB');

    // get a company
    const company = await collections.companies().findOne({});
    if (!company) {
        console.log('No company found in local DB');
        process.exit(0);
    }

    const companyId = company._id.toString();
    console.log(`Testing with Company ID: ${companyId}`);

    // Check residency mode
    const mode = await getResidencyMode(companyId, 'employee');
    console.log(`Residency Mode for 'employee': ${mode}`);

    // Test DataProvider
    const provider = getDataProvider(companyId);
    try {
        console.log('Fetching employees via DataProvider...');
        const employees = await provider.getEmployees();
        console.log(`Fetched ${employees.length} employees.`);
        if (employees.length > 0) {
            console.log('Sample Employee:', employees[0]);

            // Try fetching by ID
            const empId = employees[0].employeeId || employees[0]._id;
            console.log(`Fetching specific employee ${empId}...`);
            const emp = await provider.getEmployeeById(empId);
            console.log('Fetched single employee:', emp ? 'Found' : 'Not Found');
            if (emp) console.log(JSON.stringify(emp, null, 2));
        }
    } catch (e) {
        console.error('Error:', e);
    }

    process.exit(0);
}

run();
