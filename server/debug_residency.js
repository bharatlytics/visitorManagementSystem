require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const jwt = require('jsonwebtoken');

const COMPANY_ID = '6827296ab6e06b08639107c4';
const PLATFORM_API_URL = process.env.VITE_PLATFORM_API_URL || process.env.PLATFORM_API_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;
const APP_ID = process.env.APP_ID || 'vms_app_v1';
const APP_OBJECT_ID = '69797865ab47a2cab9992eb1'; // From screenshot _id

async function generateToken(sub) {
    const payload = {
        sub: sub || APP_ID,
        companyId: COMPANY_ID,
        iss: 'vms',
        exp: Math.floor(Date.now() / 1000) + 3600
    };
    return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

async function debugPlatformEmployeesWithAppObjectId() {
    console.log(`\n--- 2. Employee Fetch Check (sub=AppObjectId) ---`);
    console.log(`Using AppObjectId: ${APP_OBJECT_ID}`);
    const token = await generateToken(APP_OBJECT_ID);

    const baseUrl = PLATFORM_API_URL.replace(/\/$/, '');

    try {
        const url = `${baseUrl}/bharatlytics/v1/actors`;
        console.log(`GET ${url}`);
        const params = {
            companyId: COMPANY_ID,
            actorType: 'employee',
            status: 'active'
        };

        const response = await axios.get(url, {
            params,
            headers: {
                Authorization: `Bearer ${token}`,
                'X-App-ID': APP_ID
            },
            timeout: 10000
        });

        console.log(`Response Status: ${response.status}`);
        const data = response.data;
        const actors = Array.isArray(data) ? data : (data.actors || data.data || []);
        console.log(`Actors Found: ${actors.length}`);
        if (actors.length > 0) console.log('Sample:', JSON.stringify(actors[0]).substring(0, 100));

    } catch (error) {
        console.error('Fetch Failed:', error.message);
        if (error.response) {
            console.error('Data:', JSON.stringify(error.response.data));
        }
    }
}

async function run() {
    await debugPlatformEmployeesWithAppObjectId();
}

run();
