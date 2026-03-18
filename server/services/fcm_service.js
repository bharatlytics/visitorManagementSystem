/**
 * FCM Service — Firebase Cloud Messaging for VMS
 * 
 * Handles sending push notifications to users for:
 * - Visit approval requests
 * - Remote device commands (via device FCM tokens)
 * 
 * Firebase Admin SDK initialized from env vars:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   OR GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
 */

let admin = null;
let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK (lazy, once)
 */
function initFirebase() {
    if (firebaseInitialized) return !!admin;

    try {
        admin = require('firebase-admin');

        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        if (projectId && clientEmail && privateKey) {
            admin.initializeApp({
                credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
            });
            console.log('[FCM] Firebase Admin SDK initialized via env vars');
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
            console.log('[FCM] Firebase Admin SDK initialized via application default credentials');
        } else {
            console.log('[FCM] Firebase not configured — push notifications disabled. Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY to enable.');
            admin = null;
        }

        firebaseInitialized = true;
    } catch (error) {
        console.error('[FCM] Failed to initialize Firebase:', error.message);
        admin = null;
        firebaseInitialized = true;
    }

    return !!admin;
}

/**
 * Send a visit approval notification to a host employee.
 * Multicasts to all their registered devices.
 * 
 * @param {Array} fcmTokens - Array of { token, deviceId, platform } objects
 * @param {Object} visitData - Visit details for the notification
 * @param {string} approvalUrl - URL to the approval page
 * @param {Object} [platformClient] - PlatformClient instance for pruning dead tokens
 * @param {string} [userId] - Platform user ID (for pruning)
 */
async function sendApprovalNotification(fcmTokens, visitData, approvalUrl, platformClient = null, userId = null) {
    if (!initFirebase()) {
        console.log('[FCM] Firebase not initialized — skipping push notification');
        return { sent: false, reason: 'firebase_not_configured' };
    }

    const activeTokens = fcmTokens
        .filter(t => t.isActive !== false)
        .map(t => typeof t === 'string' ? t : t.token);

    if (activeTokens.length === 0) {
        console.log('[FCM] No active FCM tokens — skipping push notification');
        return { sent: false, reason: 'no_active_tokens' };
    }

    const message = {
        notification: {
            title: 'Visitor Approval Required',
            body: `${visitData.visitorName || 'A visitor'} is requesting approval${visitData.purpose ? ` for ${visitData.purpose}` : ''}.`,
        },
        data: {
            type: 'VISITOR_APPROVAL',
            visitId: String(visitData.visitId || visitData._id || ''),
            visitorName: String(visitData.visitorName || ''),
            purpose: String(visitData.purpose || ''),
            deepLink: `vms://approvals/${visitData.visitId || visitData._id}`,
            approvalUrl: String(approvalUrl || ''),
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'visitor_approvals',
                color: '#1E40AF',
            },
        },
        apns: {
            headers: { 'apns-priority': '10' },
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                    'mutable-content': 1,
                },
            },
        },
    };

    try {
        console.log(`[FCM] Sending approval notification to ${activeTokens.length} device(s)`);

        const response = await admin.messaging().sendEachForMulticast({
            tokens: activeTokens,
            ...message,
        });

        console.log(`[FCM] Result: ${response.successCount} success, ${response.failureCount} failure`);

        // Prune dead tokens
        if (response.failureCount > 0 && platformClient && userId) {
            const staleErrors = [
                'messaging/invalid-registration-token',
                'messaging/registration-token-not-registered',
            ];

            response.responses.forEach((resp, idx) => {
                if (!resp.success && staleErrors.includes(resp.error?.code)) {
                    console.log(`[FCM] Pruning stale token at index ${idx}: ${resp.error.code}`);
                    platformClient.pruneStaleToken(userId, activeTokens[idx]).catch(() => { });
                }
            });
        }

        return {
            sent: true,
            successCount: response.successCount,
            failureCount: response.failureCount,
        };
    } catch (error) {
        console.error('[FCM] Error sending notification:', error.message);
        return { sent: false, reason: 'send_error', error: error.message };
    }
}

module.exports = {
    initFirebase,
    sendApprovalNotification,
};
