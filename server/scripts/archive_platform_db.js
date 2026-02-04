/**
 * Script: Archive deleted employees directly in Platform MongoDB
 * 
 * Run with: node server/scripts/archive_platform_db.js
 */

const { MongoClient, ObjectId } = require('mongodb');

const PLATFORM_MONGODB_URI = 'mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'factorylyticsDB';
const COMPANY_ID = '6827296ab6e06b08639107c4';

async function archiveDeletedEmployees() {
    console.log('Connecting to Platform MongoDB...');
    const client = new MongoClient(PLATFORM_MONGODB_URI);

    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const actors = db.collection('actors');

        // Find deleted employees for this company
        console.log(`\nFinding deleted employees for company ${COMPANY_ID}...`);
        const deletedEmployees = await actors.find({
            companyId: new ObjectId(COMPANY_ID),
            actorType: 'employee',
            status: 'deleted',
            'attributes.employeeId': { $not: /_archived_/ }  // Not already archived
        }).toArray();

        console.log(`Found ${deletedEmployees.length} deleted employees to archive`);

        for (const actor of deletedEmployees) {
            const employeeId = actor.attributes?.employeeId;
            const email = actor.attributes?.email;

            console.log(`\n[ARCHIVE] ${actor._id}`);
            console.log(`  employeeId: ${employeeId}`);
            console.log(`  email: ${email}`);

            const archiveId = employeeId ? `${employeeId}_archived_${Date.now()}` : null;
            const archiveEmail = email ? `${email}_archived_${Date.now()}` : null;

            const result = await actors.updateOne(
                { _id: actor._id },
                {
                    $set: {
                        'attributes.employeeId': archiveId || actor.attributes?.employeeId,
                        'attributes.email': archiveEmail || actor.attributes?.email,
                        'attributes.originalEmployeeId': employeeId,
                        'attributes.originalEmail': email,
                        'attributes.archivedAt': new Date().toISOString()
                    }
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`  -> Archived: ${employeeId} -> ${archiveId}`);
            } else {
                console.log(`  -> Failed to archive`);
            }
        }

        // Verify
        console.log(`\n--- Verification ---`);
        const remaining = await actors.countDocuments({
            companyId: new ObjectId(COMPANY_ID),
            actorType: 'employee',
            status: 'deleted',
            'attributes.employeeId': { $not: /_archived_/ }
        });
        console.log(`Remaining unarchived deleted employees: ${remaining}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nDone.');
    }
}

archiveDeletedEmployees();
