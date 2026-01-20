/**
 * Test Data Residency Implementation (using native fetch)
 */
const jwt = require('jsonwebtoken');

const BASE_URL = 'http://localhost:5001';
const COMPANY_ID = '6827296ab6e06b08639107c4';
const JWT_SECRET = 'supersecret';

// Generate test token
function generateToken() {
    const payload = {
        user_id: 'test_user',
        companyId: COMPANY_ID,
        exp: Math.floor(Date.now() / 1000) + 3600
    };
    return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

async function testEndpoint(name, url) {
    process.stdout.write(`Testing ${name}... `);
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${generateToken()}` }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.log(`✗ ${response.status}: ${error.error || 'Unknown error'}`);
            return false;
        }

        const data = await response.json();
        let count = 0;
        let sample = null;

        if (data.employees) {
            count = data.employees.length;
            sample = data.employees[0];
        } else if (data.locations || data.entities) {
            count = (data.locations || data.entities).length;
            sample = (data.locations || data.entities)[0];
        }

        console.log(`✓ Got ${count} items`);

        if (sample) {
            console.log(`  Sample: name="${sample.name || sample.employeeName}", type="${sample.type || 'employee'}", residency="${sample.dataResidency || 'not set'}"`);
        }

        return true;
    } catch (error) {
        console.log(`✗ ${error.code || 'Error'}: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('=== Data Residency Test ===\n');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Company ID: ${COMPANY_ID}\n`);

    await testEndpoint('Employees API', `${BASE_URL}/api/employees?companyId=${COMPANY_ID}`);
    await testEndpoint('Locations API', `${BASE_URL}/api/locations?companyId=${COMPANY_ID}`);

    console.log('\n=== Test Complete ===');
}

main().catch(console.error);
