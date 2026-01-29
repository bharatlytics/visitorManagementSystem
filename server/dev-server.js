/**
 * Local Development Server
 * Runs the Express app on port 5001 for local development
 */
const app = require('../api/index.js');
const fs = require('fs');
const path = require('path');
const Config = require('./config');

const PORT = process.env.PORT || 5001;

/**
 * Sync manifest to Platform on startup
 */
async function syncManifestToPlatform() {
    try {
        const manifestPath = path.join(__dirname, '../manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const platformUrl = Config.PLATFORM_API_URL;
        const appId = Config.APP_ID;
        const baseUrl = Config.APP_URL;

        console.log(`[VMS] Syncing manifest to ${platformUrl} with appId=${appId}`);

        const response = await fetch(`${platformUrl}/bharatlytics/integration/v1/manifest/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appId: appId,
                manifest: manifest,
                baseUrl: baseUrl
            })
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`[VMS] Manifest synced successfully: ${data.message || 'OK'}`);
        } else {
            const text = await response.text();
            console.log(`[VMS] Manifest sync failed: ${response.status} - ${text.substring(0, 200)}`);
        }
    } catch (error) {
        console.log(`[VMS] Manifest sync error (Platform may be down): ${error.message}`);
    }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 VMS Backend running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   API health:   http://localhost:${PORT}/api/health`);
    console.log(`\n📝 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Sync manifest after server starts
    syncManifestToPlatform();
});
