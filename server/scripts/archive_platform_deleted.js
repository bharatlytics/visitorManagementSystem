/**
 * Script: Archive deleted employees on Platform
 * 
 * This script finds deleted employees on Platform and archives them
 * by renaming their employeeId to prevent conflicts with new registrations.
 * 
 * Run with: node server/scripts/archive_platform_deleted.js <companyId> <platformToken>
 */

require('dotenv').config();

const PLATFORM_API_URL = process.env.PLATFORM_API_URL || 'https://factorlytics.vercel.app';
const companyId = process.argv[2] || '6827296ab6e06b08639107c4';
const platformToken = process.argv[3];

async function archiveDeletedOnPlatform() {
    if (!platformToken) {
        console.error('Usage: node archive_platform_deleted.js <companyId> <platformToken>');
        console.error('Platform token is required');
        process.exit(1);
    }

    console.log(`Fetching employees from Platform for company: ${companyId}`);
    console.log(`Platform API: ${PLATFORM_API_URL}`);

    try {
        // Fetch all employees including deleted ones
        const url = `${PLATFORM_API_URL}/bharatlytics/v1/actors?companyId=${companyId}&actorType=employee&includeDeleted=true`;
        console.log(`Fetching: ${url}`);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${platformToken}`,
                'X-App-Id': 'vms_app_v1'
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return;
        }

        const data = await response.json();
        const actors = Array.isArray(data) ? data : data.actors || [];
        console.log(`Found ${actors.length} employees`);

        // Find deleted employees
        const deletedActors = actors.filter(a => a.status === 'deleted');
        console.log(`Found ${deletedActors.length} deleted employees`);

        for (const actor of deletedActors) {
            const employeeId = actor.attributes?.employeeId;
            const email = actor.attributes?.email;

            // Skip if already archived
            if (employeeId && employeeId.includes('_archived_')) {
                console.log(`  [SKIP] ${actor._id} - already archived`);
                continue;
            }

            console.log(`  [ARCHIVE] ${actor._id}`);
            console.log(`    employeeId: ${employeeId}`);
            console.log(`    email: ${email}`);
            console.log(`    status: ${actor.status}`);

            // Archive by renaming
            const archiveId = employeeId ? `${employeeId}_archived_${Date.now()}` : null;
            const archiveEmail = email ? `${email}_archived_${Date.now()}` : null;

            const updateUrl = `${PLATFORM_API_URL}/bharatlytics/v1/actors/${actor._id}`;
            const updatePayload = {
                attributes: {
                    ...actor.attributes,
                    employeeId: archiveId || actor.attributes?.employeeId,
                    email: archiveEmail || actor.attributes?.email,
                    originalEmployeeId: employeeId,
                    originalEmail: email,
                    archivedAt: new Date().toISOString()
                }
            };

            const updateResponse = await fetch(updateUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${platformToken}`,
                    'Content-Type': 'application/json',
                    'X-App-Id': 'vms_app_v1'
                },
                body: JSON.stringify(updatePayload)
            });

            if (updateResponse.ok) {
                console.log(`    -> Archived: ${employeeId} -> ${archiveId}`);
            } else {
                console.error(`    -> Failed: ${updateResponse.status}`);
                const errorText = await updateResponse.text();
                console.error(`    -> ${errorText}`);
            }
        }

        console.log('\nDone!');

    } catch (error) {
        console.error('Error:', error);
    }
}

archiveDeletedOnPlatform();
