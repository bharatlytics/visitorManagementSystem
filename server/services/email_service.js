/**
 * Email Service
 * Handles sending approval emails using nodemailer
 */
const nodemailer = require('nodemailer');
const { collections } = require('../db');
const { isValidObjectId } = require('../utils/helpers');
const { ObjectId } = require('mongodb');

/**
 * Get SMTP configuration from company settings
 */
async function getSMTPConfig(companyId) {
    try {
        const companyOid = isValidObjectId(companyId) ? new ObjectId(companyId) : companyId;

        const settings = await collections.settings().findOne({ companyId: companyOid });

        if (!settings || !settings.smtp || !settings.smtp.host) {
            console.log('[EmailService] No SMTP configuration found for company:', companyId);
            return null;
        }

        return {
            host: settings.smtp.host,
            port: settings.smtp.port || 587,
            secure: settings.smtp.secure !== undefined ? settings.smtp.secure : false, // true for 465, false for other ports
            auth: {
                user: settings.smtp.user,
                pass: settings.smtp.password
            }
        };
    } catch (error) {
        console.error('[EmailService] Error fetching SMTP config:', error);
        return null;
    }
}

/**
 * Create approval email HTML template
 */
function createApprovalEmailHTML(visitData, approvalUrl) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 20px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .info-grid { background: #f8f9fa; border-radius: 6px; padding: 20px; margin: 20px 0; }
        .info-row { display: flex; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; width: 140px; }
        .info-value { color: #333; }
        .button-container { text-align: center; margin: 30px 0; }
        .button { display: inline-block; padding: 14px 40px; margin: 0 8px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; transition: all 0.3s; }
        .button-approve { background: #10b981; color: white; }
        .button-reject { background: #ef4444; color: white; }
        .button:hover { opacity: 0.9; transform: translateY(-1px); }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔔 Visit Approval Required</h1>
        </div>
        <div class="content">
            <p>Hello <strong>${visitData.hostEmployeeName || 'there'}</strong>,</p>
            <p>A visit has been scheduled that requires your approval:</p>
            
            <div class="info-grid">
                <div class="info-row">
                    <div class="info-label">Visitor Name:</div>
                    <div class="info-value"><strong>${visitData.visitorName}</strong></div>
                </div>
                <div class="info-row">
                    <div class="info-label">Contact:</div>
                    <div class="info-value">${visitData.visitorMobile || 'N/A'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">Purpose:</div>
                    <div class="info-value">${visitData.purpose || 'Not specified'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">Visit Type:</div>
                    <div class="info-value">${visitData.visitType || 'General'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">Expected Arrival:</div>
                    <div class="info-value">${new Date(visitData.expectedArrival).toLocaleString()}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">Expected Departure:</div>
                    <div class="info-value">${visitData.expectedDeparture ? new Date(visitData.expectedDeparture).toLocaleString() : 'Not specified'}</div>
                </div>
            </div>

            <div class="button-container">
                <a href="${approvalUrl}" class="button button-approve">✓ Approve Visit</a>
            </div>

            <div class="warning">
                <strong>⚠️ Important:</strong> This approval link is valid for 24 hours and can only be used once.
            </div>

            <p style="font-size: 13px; color: #666; margin-top: 20px;">
                If you did not expect this request or have concerns, please contact your security team immediately.
            </p>
        </div>
        <div class="footer">
            <p>This is an automated message from Visitor Management System</p>
            <p>Please do not reply to this email</p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

/**
 * Send approval email to host employee
 */
async function sendApprovalEmail(companyId, hostEmail, visitData, approvalToken, req = null) {
    try {
        // Get SMTP configuration
        const smtpConfig = await getSMTPConfig(companyId);

        if (!smtpConfig) {
            console.log('[EmailService] Cannot send email - SMTP not configured');
            return {
                success: false,
                error: 'SMTP not configured for this company'
            };
        }

        // Create transporter
        const transporter = nodemailer.createTransporter(smtpConfig);

        // Get from email from settings
        const settings = await collections.settings().findOne({
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId
        });
        const fromEmail = settings?.smtp?.fromEmail || smtpConfig.auth.user;

        // Auto-detect frontend URL from request headers or use environment variable as fallback
        let frontendUrl = process.env.FRONTEND_URL;

        if (!frontendUrl && req) {
            // Try to detect from Origin header (most reliable for CORS requests)
            if (req.headers.origin) {
                frontendUrl = req.headers.origin;
            }
            // Fallback to Referer header
            else if (req.headers.referer) {
                const refererUrl = new URL(req.headers.referer);
                frontendUrl = `${refererUrl.protocol}//${refererUrl.host}`;
            }
            // Fallback to building from host header
            else if (req.headers.host || req.headers['x-forwarded-host']) {
                const host = req.headers['x-forwarded-host'] || req.headers.host;
                const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
                frontendUrl = `${protocol}://${host}`;
            }
        }

        // Final fallback
        if (!frontendUrl) {
            frontendUrl = 'http://localhost:3000';
            console.warn('[EmailService] Could not auto-detect frontend URL, using fallback:', frontendUrl);
        }

        // Generate approval URL (will be handled by frontend route)
        const approvalUrl = `${frontendUrl}/approval/${approvalToken}`;

        // Create email HTML
        const htmlContent = createApprovalEmailHTML(visitData, approvalUrl);

        // Email options
        const mailOptions = {
            from: `"Visitor Management System" <${fromEmail}>`,
            to: hostEmail,
            subject: `Visit Approval Required - ${visitData.visitorName}`,
            html: htmlContent,
            text: `
Visit Approval Required

Hello ${visitData.hostEmployeeName || 'there'},

A visit has been scheduled that requires your approval:

Visitor: ${visitData.visitorName}
Contact: ${visitData.visitorMobile || 'N/A'}
Purpose: ${visitData.purpose || 'Not specified'}
Expected Arrival: ${new Date(visitData.expectedArrival).toLocaleString()}

To approve this visit, click the link below:
${approvalUrl}

This link is valid for 24 hours and can only be used once.

---
Visitor Management System
            `.trim()
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);

        console.log('[EmailService] Approval email sent:', info.messageId);

        return {
            success: true,
            messageId: info.messageId,
            approvalUrl
        };
    } catch (error) {
        console.error('[EmailService] Error sending approval email:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Send test email to verify SMTP configuration
 */
async function sendTestEmail(companyId, toEmail) {
    try {
        const smtpConfig = await getSMTPConfig(companyId);

        if (!smtpConfig) {
            return {
                success: false,
                error: 'SMTP not configured'
            };
        }

        const transporter = nodemailer.createTransport(smtpConfig);

        const settings = await collections.settings().findOne({
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId
        });
        const fromEmail = settings?.smtp?.fromEmail || smtpConfig.auth.user;

        const mailOptions = {
            from: `"Visitor Management System" <${fromEmail}>`,
            to: toEmail,
            subject: 'Test Email - SMTP Configuration',
            html: `
                <h2>✅ SMTP Configuration Successful</h2>
                <p>Your SMTP settings are configured correctly and emails can be sent.</p>
                <p><small>This is a test email from Visitor Management System</small></p>
            `,
            text: 'SMTP Configuration Test - Your settings are working correctly!'
        };

        const info = await transporter.sendMail(mailOptions);

        return {
            success: true,
            messageId: info.messageId
        };
    } catch (error) {
        console.error('[EmailService] Test email failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Send visitor invite email with portal link and NDA instructions
 */
async function sendVisitorInviteEmail(companyId, visitorEmail, visitData, portalUrl, registrationUrl, req = null) {
    try {
        const smtpConfig = await getSMTPConfig(companyId);
        if (!smtpConfig) {
            console.log('[EmailService] Cannot send visitor email - SMTP not configured');
            return { success: false, error: 'SMTP not configured' };
        }

        const transporter = nodemailer.createTransport(smtpConfig);

        const settings = await collections.settings().findOne({
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId
        });
        const fromEmail = settings?.smtp?.fromEmail || smtpConfig.auth.user;
        const companyName = settings?.general?.companyName || 'Our Company';

        const arrivalDate = visitData.expectedArrival
            ? new Date(visitData.expectedArrival).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : 'To be confirmed';

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #1e3a8a, #3b82f6); padding: 32px; text-align: center; border-radius: 16px 16px 0 0; }
        .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 700; }
        .header p { color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px; }
        .body { background: white; padding: 32px; }
        .greeting { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
        .info-grid { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #64748b; font-size: 13px; font-weight: 500; }
        .info-value { color: #1e293b; font-size: 13px; font-weight: 600; text-align: right; }
        .cta-button { display: inline-block; background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: white !important; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 700; font-size: 15px; margin: 8px 4px; }
        .cta-secondary { background: linear-gradient(135deg, #059669, #10b981); }
        .nda-box { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 12px; padding: 16px; margin: 20px 0; }
        .nda-box h3 { color: #92400e; margin: 0 0 8px; font-size: 14px; }
        .nda-box p { color: #78350f; font-size: 12px; margin: 0; line-height: 1.5; }
        .footer { background: #f8fafc; padding: 20px 32px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0; }
        .footer p { color: #94a3b8; font-size: 11px; margin: 4px 0; }
    </style>
</head>
<body>
    <div class="container" style="padding: 20px;">
        <div class="header">
            <h1>🏢 ${companyName}</h1>
            <p>Visitor Management System</p>
        </div>
        <div class="body">
            <p class="greeting">Hello ${visitData.visitorName},</p>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                You have been invited to visit <strong>${companyName}</strong>. Please review your visit details below and complete the required steps before your arrival.
            </p>

            <div class="info-grid">
                <div class="info-row">
                    <span class="info-label">Host</span>
                    <span class="info-value">${visitData.hostEmployeeName || 'To be assigned'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Purpose</span>
                    <span class="info-value">${visitData.purpose || 'Business Visit'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Expected Arrival</span>
                    <span class="info-value">${arrivalDate}</span>
                </div>
                ${visitData.expectedDeparture ? `<div class="info-row">
                    <span class="info-label">Expected Departure</span>
                    <span class="info-value">${new Date(visitData.expectedDeparture).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>` : ''}
            </div>

            <div class="nda-box">
                <h3>📋 NDA & Safety Compliance Required</h3>
                <p>Before your visit, you must review and sign the Non-Disclosure Agreement and acknowledge the safety guidelines. You can complete this through the portal link below.</p>
            </div>

            <div style="text-align: center; margin: 24px 0;">
                <a href="${portalUrl}" class="cta-button">📱 View Visit Portal</a>
                ${registrationUrl ? `<a href="${registrationUrl}" class="cta-button cta-secondary">✍️ Complete Registration</a>` : ''}
            </div>

            <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">
                Use the portal to view your visit details, NDA requirements, and check-in status at any time.
            </p>
        </div>
        <div class="footer">
            <p>This is an automated message from ${companyName} Visitor Management System</p>
            <p>Please do not reply to this email</p>
        </div>
    </div>
</body>
</html>`.trim();

        const mailOptions = {
            from: `"${companyName} - Visitor Management" <${fromEmail}>`,
            to: visitorEmail,
            subject: `You're Invited — Visit ${companyName} on ${arrivalDate}`,
            html: htmlContent,
            text: `
Hello ${visitData.visitorName},

You have been invited to visit ${companyName}.

Host: ${visitData.hostEmployeeName || 'To be assigned'}
Purpose: ${visitData.purpose || 'Business Visit'}
Expected Arrival: ${arrivalDate}

View your visit details and complete NDA: ${portalUrl}
${registrationUrl ? `Complete your registration: ${registrationUrl}` : ''}

---
${companyName} Visitor Management System
            `.trim()
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[EmailService] Visitor invite email sent:', info.messageId);

        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('[EmailService] Error sending visitor invite email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendApprovalEmail,
    sendVisitorInviteEmail,
    sendTestEmail,
    getSMTPConfig
};
