
const jwt = require('jsonwebtoken');

// Configuration
const Config = require('../server/config');
const API_URL = 'http://localhost:5001/api';
const JWT_SECRET = Config.JWT_SECRET;
const COMPANY_ID = '507f1f77bcf86cd799439011'; // Mock ObjectId
const HOST_ID = '696e076781207f13b76cedbe'; // Created Employee ID

// Mock Platform Token
const PLATFORM_TOKEN = jwt.sign({
    userId: 'platform_user_1',
    companyId: COMPANY_ID,
    roles: ['admin']
}, 'supersecret', { expiresIn: '1h' });

// Create VMS Token
const VMS_TOKEN = jwt.sign({
    userId: 'vms_user_1',
    companyId: COMPANY_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
}, JWT_SECRET);

async function runTest() {
    console.log('Starting Visitor Registration Test...');
    console.log(`Target URL: ${API_URL}/visitors/register`);

    try {
        // Construct multipart body manually to avoid external dependencies
        const boundary = '--------------------------' + Date.now().toString(16);
        let body = '';

        const fields = {
            companyId: COMPANY_ID,
            visitorName: `Test Visitor ${Date.now()}`,
            phone: `+91${Date.now().toString().slice(-10)}`,
            hostEmployeeId: HOST_ID,
            visitorType: 'guest'
        };

        for (const [key, value] of Object.entries(fields)) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
            body += `${value}\r\n`;
        }
        body += `--${boundary}--\r\n`;

        const response = await fetch(`${API_URL}/visitors/register`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VMS_TOKEN}`,
                'X-Platform-Token': PLATFORM_TOKEN,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: body
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.log('Response is not JSON:', text);
            return;
        }

        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(data, null, 2));

        if (data.platformSync) {
            console.log('Platform Sync Status:', data.platformSync.status);
            if (data.platformSync.status === 'success') {
                console.log('SUCCESS: Visitor synced to platform!');
            } else if (data.platformSync.status === 'failed') {
                console.log('WARNING: Platform sync failed (expected if platform is not running):', data.platformSync.error);
            } else {
                console.log('INFO: Platform sync skipped.');
            }
        } else {
            console.log('FAILURE: No platformSync field in response.');
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

runTest();
