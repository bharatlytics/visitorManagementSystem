/**
 * Badge API - Generate visitor badges with QR codes
 * Uses HTML/SVG-based badge generation for serverless compatibility
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const QRCode = require('qrcode');
const { collections, getGridFSBucket } = require('../db');

/**
 * GET /api/badge/visits/:visitId/badge
 * Generate a visitor badge as an SVG/HTML image
 */
router.get('/visits/:visitId/badge', async (req, res, next) => {
    try {
        const { visitId } = req.params;

        // Validate ObjectId
        if (!ObjectId.isValid(visitId)) {
            return res.status(400).json({ error: 'Invalid visit ID format' });
        }

        // Fetch visit
        const visit = await collections.visits().findOne({ _id: new ObjectId(visitId) });
        if (!visit) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        // Fetch visitor
        const visitorId = visit.visitorId;
        const visitor = await collections.visitors().findOne({
            _id: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId)
        });
        if (!visitor) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        // Fetch company
        let companyName = 'Visitor Badge';
        try {
            const companyId = visit.companyId;
            const company = await collections.companies().findOne({
                _id: companyId instanceof ObjectId ? companyId : new ObjectId(companyId)
            });
            if (company) {
                companyName = company.companyName || 'Visitor Badge';
            }
        } catch (e) {
            console.log(`[Badge] Could not fetch company: ${e.message}`);
        }

        // Get visitor photo as base64
        let photoBase64 = null;
        if (visitor.visitorImages && visitor.visitorImages.center) {
            try {
                const bucket = getGridFSBucket('visitorImages');
                const imageId = visitor.visitorImages.center;
                const downloadStream = bucket.openDownloadStream(
                    imageId instanceof ObjectId ? imageId : new ObjectId(imageId)
                );

                const chunks = [];
                for await (const chunk of downloadStream) {
                    chunks.push(chunk);
                }
                const imageBuffer = Buffer.concat(chunks);
                photoBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
            } catch (e) {
                console.log(`[Badge] Error loading visitor image: ${e.message}`);
            }
        }

        // Get visit details
        const visitorName = visitor.visitorName || 'Visitor';
        const visitorType = (visitor.visitorType || 'Guest').toUpperCase();
        const hostName = visit.hostEmployeeName || 'N/A';

        let dateStr = 'N/A';
        const visitDate = visit.expectedArrival;
        if (visitDate) {
            if (visitDate instanceof Date) {
                dateStr = visitDate.toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                const d = new Date(visitDate);
                dateStr = d.toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }
        }

        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(visitId, {
            width: 150,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' }
        });

        // Badge dimensions (vertical ID card format)
        const width = 400;
        const height = 650;

        // Generate SVG badge
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
        <style>
            .company-name { font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; fill: white; }
            .visitor-name { font-family: Arial, sans-serif; font-size: 28px; font-weight: bold; fill: #1a1a1a; }
            .visitor-type { font-family: Arial, sans-serif; font-size: 14px; font-weight: 600; fill: white; }
            .label { font-family: Arial, sans-serif; font-size: 12px; fill: #666666; }
            .value { font-family: Arial, sans-serif; font-size: 16px; fill: #1a1a1a; }
            .badge-instruction { font-family: Arial, sans-serif; font-size: 10px; fill: #666666; text-anchor: middle; }
        </style>
        <clipPath id="photoClip">
            <circle cx="${width / 2}" cy="185" r="70"/>
        </clipPath>
    </defs>
    
    <!-- Background -->
    <rect width="${width}" height="${height}" fill="#FFFFFF" rx="12"/>
    
    <!-- Header -->
    <rect width="${width}" height="100" fill="#003366" rx="12"/>
    <rect x="0" y="88" width="${width}" height="12" fill="#003366"/>
    
    <!-- Company Name -->
    <text x="${width / 2}" y="55" text-anchor="middle" class="company-name">${escapeXml(companyName)}</text>
    <text x="${width / 2}" y="78" text-anchor="middle" class="label" style="fill: rgba(255,255,255,0.8); font-size: 11px;">VISITOR PASS</text>
    
    <!-- Photo Circle Background -->
    <circle cx="${width / 2}" cy="185" r="75" fill="#E8EEF4" stroke="#003366" stroke-width="3"/>
    
    ${photoBase64 ? `
    <!-- Photo -->
    <image x="${width / 2 - 70}" y="115" width="140" height="140" 
           xlink:href="${photoBase64}" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>
    ` : `
    <!-- No Photo Placeholder -->
    <text x="${width / 2}" y="190" text-anchor="middle" class="label">No Photo</text>
    `}
    
    <!-- Visitor Name -->
    <text x="${width / 2}" y="295" text-anchor="middle" class="visitor-name">${escapeXml(visitorName)}</text>
    
    <!-- Visitor Type Badge -->
    <rect x="${width / 2 - 50}" y="310" width="100" height="24" rx="12" fill="#0066CC"/>
    <text x="${width / 2}" y="327" text-anchor="middle" class="visitor-type">${escapeXml(visitorType)}</text>
    
    <!-- Details Section -->
    <line x1="30" y1="355" x2="${width - 30}" y2="355" stroke="#E8EEF4" stroke-width="1"/>
    
    <!-- Host -->
    <text x="35" y="385" class="label">HOST</text>
    <text x="35" y="405" class="value">${escapeXml(hostName)}</text>
    
    <!-- Date -->
    <text x="${width / 2 + 20}" y="385" class="label">VALID DATE</text>
    <text x="${width / 2 + 20}" y="405" class="value">${escapeXml(dateStr)}</text>
    
    <line x1="30" y1="425" x2="${width - 30}" y2="425" stroke="#E8EEF4" stroke-width="1"/>
    
    <!-- QR Code -->
    <image x="${width / 2 - 75}" y="440" width="150" height="150" xlink:href="${qrDataUrl}"/>
    
    <!-- Footer -->
    <text x="${width / 2}" y="615" class="badge-instruction">Please wear this badge visibly at all times</text>
    <text x="${width / 2}" y="630" class="badge-instruction">Return badge upon exit</text>
    
    <!-- Border -->
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#E8EEF4" stroke-width="2" rx="12"/>
</svg>`;

        // Send SVG
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(svg);

    } catch (error) {
        console.error('Error generating badge:', error);
        next(error);
    }
});

/**
 * Escape XML special characters
 */
function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

module.exports = router;
