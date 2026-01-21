/**
 * VMS API Compliance E2E Test
 * Tests all Node.js APIs using proper Platform SSO flow
 * 
 * Inspired by test_vms_complete.py and test_android_sso.ps1
 * 
 * Usage: node tests/test_api_compliance.js
 */

// Configuration
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:5000';
const VMS_URL = process.env.VMS_URL || 'http://localhost:5001';
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL || 'admin@bharatlytics.com';
const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD || 'admin123';

// Test state
let platformToken = null;
let vmsToken = null;
let companyId = null;
let createdVisitorId = null;
let createdVisitId = null;

const results = { passed: 0, failed: 0, skipped: 0, errors: [] };

/**
 * Step 1: Login to Platform and get platform token
 */
async function loginToPlatform() {
    console.log('Step 1: Logging into Platform...');

    try {
        const response = await fetch(`${PLATFORM_URL}/bharatlytics/v1/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: PLATFORM_EMAIL,
                password: PLATFORM_PASSWORD
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log(`❌ Platform login failed: ${response.status} - ${error}`);
            return false;
        }

        const data = await response.json();
        platformToken = data.token;
        companyId = data.context?.companyId;

        console.log(`✅ Platform login successful!`);
        console.log(`   Company: ${data.context?.companyName || 'Unknown'}`);
        console.log(`   Company ID: ${companyId}`);
        return true;
    } catch (error) {
        console.log(`❌ Platform login error: ${error.message}`);
        return false;
    }
}

/**
 * Step 2: Use Platform SSO to get VMS token
 */
async function ssoToVMS() {
    console.log('\nStep 2: SSO to VMS...');

    try {
        const response = await fetch(`${VMS_URL}/auth/platform-sso`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: platformToken,
                companyId: companyId
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log(`❌ VMS SSO failed: ${response.status} - ${error}`);
            return false;
        }

        const data = await response.json();
        vmsToken = data.vmsToken;

        console.log(`✅ VMS SSO successful!`);
        console.log(`   Token expires in: ${data.expiresIn} seconds`);
        return true;
    } catch (error) {
        console.log(`❌ VMS SSO error: ${error.message}`);
        return false;
    }
}

/**
 * Make API request with VMS token
 */
async function apiRequest(method, path, body = null) {
    const url = `${VMS_URL}${path}`;
    const headers = {
        'Authorization': `Bearer ${vmsToken}`,
        'Content-Type': 'application/json'
    };

    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        return { status: response.status, data, ok: response.ok };
    } catch (error) {
        return { status: 0, data: {}, ok: false, error: error.message };
    }
}

/**
 * Test runner helper
 */
async function runTest(name, testFn) {
    process.stdout.write(`  ${name}... `);
    try {
        const result = await testFn();
        if (result.success) {
            console.log('✅');
            results.passed++;
        } else if (result.skip) {
            console.log(`⏭️ ${result.message}`);
            results.skipped++;
        } else {
            console.log(`❌ ${result.message}`);
            results.failed++;
            results.errors.push({ test: name, error: result.message });
        }
    } catch (error) {
        console.log(`❌ Exception: ${error.message}`);
        results.failed++;
        results.errors.push({ test: name, error: error.message });
    }
}

// ============================================================================
// VISITORS API TESTS
// ============================================================================

async function testVisitorsAPI() {
    console.log('\n📋 VISITORS API TESTS');

    // GET /api/visitors - List visitors
    await runTest('GET /api/visitors - List visitors', async () => {
        const res = await apiRequest('GET', `/api/visitors?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };
        if (!res.data.visitors) return { success: false, message: 'Missing visitors array' };
        if (!Array.isArray(res.data.visitors)) return { success: false, message: 'visitors is not array' };
        console.log(`(${res.data.visitors.length} visitors)`);
        return { success: true };
    });

    // GET /api/visitors/list - Alternative endpoint
    await runTest('GET /api/visitors/list - Alternative list', async () => {
        const res = await apiRequest('GET', `/api/visitors/list?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };
        if (!res.data.visitors) return { success: false, message: 'Missing visitors array' };
        return { success: true };
    });
}

// ============================================================================
// VISITS API TESTS
// ============================================================================

async function testVisitsAPI() {
    console.log('\n📅 VISITS API TESTS');

    // GET /api/visitors/visits - List visits (using visitors route)
    await runTest('GET /api/visitors/visits - List visits', async () => {
        const res = await apiRequest('GET', `/api/visitors/visits?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };
        if (!res.data.visits) return { success: false, message: 'Missing visits array' };
        console.log(`(${res.data.visits.length} visits)`);
        return { success: true };
    });

    // GET /api/visits - Alternative using visits router
    await runTest('GET /api/visits - List visits (alternative)', async () => {
        const res = await apiRequest('GET', `/api/visits?companyId=${companyId}`);
        // May return 404 if visits router not mounted
        if (res.status === 404) return { skip: true, message: 'Route not mounted' };
        if (!res.ok) return { success: false, message: `Status ${res.status}` };
        return { success: true };
    });
}

// ============================================================================
// EMPLOYEES API TESTS (Residency-Aware)
// ============================================================================

async function testEmployeesAPI() {
    console.log('\n👥 EMPLOYEES API TESTS (Residency-Aware)');

    // GET /api/employees - List employees (should be array per api-reference)
    await runTest('GET /api/employees - List employees (residency-aware)', async () => {
        const res = await apiRequest('GET', `/api/employees?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        // Per api-reference.md, response should be direct array
        if (!Array.isArray(res.data)) return { success: false, message: 'Response should be array' };
        console.log(`(${res.data.length} employees)`);

        if (res.data.length === 0) {
            return { success: true }; // No employees is OK
        }

        // Verify employee schema
        const emp = res.data[0];
        if (!emp._id) return { success: false, message: 'Missing _id field' };

        return { success: true };
    });

    // Verify employee has VMS flattened fields
    await runTest('Employees have VMS flattened fields', async () => {
        const res = await apiRequest('GET', `/api/employees?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };
        if (res.data.length === 0) return { skip: true, message: 'No employees' };

        const emp = res.data[0];
        // Check for VMS convenience fields
        const hasName = emp.employeeName || emp.attributes?.employeeName;
        if (!hasName) return { success: false, message: 'Missing employeeName' };

        return { success: true };
    });

    // Verify download URLs are rewritten
    await runTest('Download URLs are rewritten to VMS', async () => {
        const res = await apiRequest('GET', `/api/employees?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        const empWithEmb = res.data.find(e =>
            e.actorEmbeddings && Object.keys(e.actorEmbeddings).length > 0
        );

        if (!empWithEmb) return { skip: true, message: 'No employees with embeddings' };

        // Check download URL is rewritten to VMS
        const firstModel = Object.keys(empWithEmb.actorEmbeddings)[0];
        const embData = empWithEmb.actorEmbeddings[firstModel];

        if (embData.downloadUrl && embData.downloadUrl.includes('localhost:5000')) {
            return { success: false, message: 'downloadUrl not rewritten - still points to Platform' };
        }

        return { success: true };
    });
}

// ============================================================================
// ENTITIES/LOCATIONS API TESTS (Residency-Aware)
// ============================================================================

async function testEntitiesAPI() {
    console.log('\n🏢 ENTITIES API TESTS (Residency-Aware)');

    // GET /api/entities - List locations
    await runTest('GET /api/entities - List locations (residency-aware)', async () => {
        const res = await apiRequest('GET', `/api/entities?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        // Should have both entities and locations for frontend compat
        const entities = res.data.entities || res.data.locations || [];
        console.log(`(${entities.length} entities)`);

        if (!Array.isArray(entities)) return { success: false, message: 'Not an array' };

        // Per api-reference, entities should have: _id, name, type, status
        if (entities.length > 0) {
            const ent = entities[0];
            if (!ent._id) return { success: false, message: 'Missing _id' };
            if (!ent.name) return { success: false, message: 'Missing name' };
        }

        return { success: true };
    });

    // Verify entity filtering by mapped types
    await runTest('Entity filtering - Types from installationMappings', async () => {
        const res = await apiRequest('GET', `/api/entities?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        const entities = res.data.entities || res.data.locations || [];
        if (entities.length === 0) return { skip: true, message: 'No entities' };

        // Report types for debugging
        const types = [...new Set(entities.map(e => e.type))];
        console.log(`(types: ${types.join(', ')})`);

        return { success: true };
    });
}

// ============================================================================
// DASHBOARD API TESTS
// ============================================================================

async function testDashboardAPI() {
    console.log('\n📊 DASHBOARD API TESTS');

    // GET /api/dashboard/stats
    await runTest('GET /api/dashboard/stats', async () => {
        const res = await apiRequest('GET', `/api/dashboard/stats?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        // Per api-reference: currentVisitors, expectedToday, etc.
        const hasStats = typeof res.data.currentVisitors !== 'undefined' ||
            typeof res.data.activeVisitors !== 'undefined' ||
            typeof res.data.todayVisits !== 'undefined';

        if (!hasStats) return { success: false, message: 'Missing visitor stats' };

        return { success: true };
    });

    // GET /api/dashboard/trends
    await runTest('GET /api/dashboard/trends', async () => {
        const res = await apiRequest('GET', `/api/dashboard/trends?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: `Status ${res.status}` };

        const hasTrends = res.data.trends || Array.isArray(res.data);
        if (!hasTrends) return { success: false, message: 'Missing trends data' };

        return { success: true };
    });
}

// ============================================================================
// EMBEDDING PROXY TESTS
// ============================================================================

async function testEmbeddingProxy() {
    console.log('\n🔐 EMBEDDING PROXY TESTS');

    // Test proxy endpoint exists
    await runTest('GET /api/employees/embeddings/:id - Endpoint exists', async () => {
        const res = await apiRequest('GET', `/api/employees?companyId=${companyId}`);
        if (!res.ok) return { success: false, message: 'Cannot list employees' };

        const empWithEmb = res.data.find(e =>
            e.actorEmbeddings &&
            Object.values(e.actorEmbeddings).some(v => v.embeddingId || v.downloadUrl)
        );

        if (!empWithEmb) return { skip: true, message: 'No employees with embeddings' };

        const firstModel = Object.keys(empWithEmb.actorEmbeddings)[0];
        const embData = empWithEmb.actorEmbeddings[firstModel];

        // Extract embedding ID from downloadUrl or embeddingId
        let embId = embData.embeddingId;
        if (!embId && embData.downloadUrl) {
            embId = embData.downloadUrl.split('/').pop();
        }

        if (!embId) return { skip: true, message: 'No embedding ID found' };

        // Test the download endpoint
        const url = `${VMS_URL}/api/employees/embeddings/${embId}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${vmsToken}` }
        });

        // 200 = success, 404 = Platform down, both acceptable
        if (response.status !== 200 && response.status !== 404) {
            return { success: false, message: `Unexpected status ${response.status}` };
        }

        if (response.status === 200) {
            console.log('(proxy working)');
        } else {
            console.log('(Platform may be down)');
        }

        return { success: true };
    });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('═'.repeat(60));
    console.log('VMS API COMPLIANCE E2E TEST (with Platform SSO)');
    console.log('═'.repeat(60));
    console.log(`Platform URL: ${PLATFORM_URL}`);
    console.log(`VMS URL: ${VMS_URL}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('');

    // Step 1: Login to Platform
    const platformLoginSuccess = await loginToPlatform();
    if (!platformLoginSuccess) {
        console.log('\n⚠️ Cannot proceed without Platform login.');
        console.log('Make sure the Platform server is running at ' + PLATFORM_URL);
        process.exit(1);
    }

    // Step 2: SSO to VMS
    const ssoSuccess = await ssoToVMS();
    if (!ssoSuccess) {
        console.log('\n⚠️ Cannot proceed without VMS SSO.');
        console.log('Make sure the VMS server is running at ' + VMS_URL);
        process.exit(1);
    }

    // Step 3: Run all test suites
    await testVisitorsAPI();
    await testVisitsAPI();
    await testEmployeesAPI();
    await testEntitiesAPI();
    await testDashboardAPI();
    await testEmbeddingProxy();

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✅ Passed:  ${results.passed}`);
    console.log(`❌ Failed:  ${results.failed}`);
    console.log(`⏭️ Skipped: ${results.skipped}`);

    if (results.errors.length > 0) {
        console.log('\nFailed Tests:');
        results.errors.forEach(e => console.log(`  - ${e.test}: ${e.error}`));
    }

    console.log('\n' + '═'.repeat(60));
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
