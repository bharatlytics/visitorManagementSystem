/**
 * SMS Service
 * Sends SMS notifications to visitors when SMS is enabled in company settings
 * Supports Twilio and generic HTTP-based SMS gateways
 */
const { collections } = require('../db');
const { ObjectId } = require('mongodb');
const { isValidObjectId } = require('../utils/helpers');

/**
 * Get SMS configuration from company settings
 */
async function getSMSConfig(companyId) {
    try {
        let query;
        if (isValidObjectId(companyId)) {
            query = { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] };
        } else {
            query = { companyId };
        }

        const settings = await collections.settings().findOne(query);

        if (!settings?.integrations?.smsEnabled) {
            return null;
        }

        return {
            provider: settings.integrations.smsProvider || 'twilio',
            apiKey: settings.integrations.smsApiKey,
            senderId: settings.integrations.smsSenderId,
            // Twilio-specific
            accountSid: settings.integrations.smsAccountSid,
            authToken: settings.integrations.smsAuthToken,
            fromNumber: settings.integrations.smsFromNumber
        };
    } catch (error) {
        console.error('[SMSService] Error fetching SMS config:', error);
        return null;
    }
}

/**
 * Send SMS via configured provider
 */
async function sendSMS(config, toNumber, message) {
    try {
        if (config.provider === 'twilio') {
            // Twilio integration
            const accountSid = config.accountSid || config.apiKey;
            const authToken = config.authToken;
            const fromNumber = config.fromNumber || config.senderId;

            if (!accountSid || !authToken || !fromNumber) {
                return { success: false, error: 'Incomplete Twilio configuration' };
            }

            const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    To: toNumber,
                    From: fromNumber,
                    Body: message
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`[SMSService] SMS sent via Twilio: ${result.sid}`);
                return { success: true, messageId: result.sid };
            } else {
                const errorText = await response.text();
                console.error(`[SMSService] Twilio error: ${response.status} - ${errorText}`);
                return { success: false, error: errorText.substring(0, 200) };
            }
        }

        // Generic HTTP SMS gateway fallback
        console.log(`[SMSService] SMS provider '${config.provider}' not fully implemented. Message: ${message.substring(0, 50)}...`);
        return { success: false, error: `SMS provider '${config.provider}' not fully implemented` };
    } catch (error) {
        console.error('[SMSService] Error sending SMS:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send visitor invite SMS with portal link
 */
async function sendVisitorInviteSMS(companyId, phoneNumber, visitData, portalUrl) {
    try {
        const smsConfig = await getSMSConfig(companyId);

        if (!smsConfig) {
            console.log('[SMSService] SMS not enabled for company');
            return { success: false, error: 'SMS not enabled' };
        }

        // Get company name from settings
        let companyName = 'our office';
        try {
            const settings = await collections.settings().findOne({
                $or: [
                    { companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId },
                    { companyId: String(companyId) }
                ]
            });
            if (settings?.general?.companyName) {
                companyName = settings.general.companyName;
            }
        } catch (e) { /* use default */ }

        const arrivalDate = visitData.expectedArrival
            ? new Date(visitData.expectedArrival).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'your scheduled date';

        const message = `Hi ${visitData.visitorName}, you're invited to visit ${companyName} on ${arrivalDate}. Host: ${visitData.hostEmployeeName || 'Assigned'}. View details & NDA: ${portalUrl}`;

        const result = await sendSMS(smsConfig, phoneNumber, message);

        if (result.success) {
            console.log(`[SMSService] Visitor invite SMS sent to ${phoneNumber}`);
        }

        return result;
    } catch (error) {
        console.error('[SMSService] Error sending visitor invite SMS:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendVisitorInviteSMS,
    getSMSConfig,
    sendSMS
};
