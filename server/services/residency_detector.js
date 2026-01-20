/**
 * Residency Detector Service
 * Determines data residency mode for companies
 * 
 * Ported from Python app/services/residency_detector.py
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const Config = require('../config');
const { getDb, collections } = require('../db');

/**
 * Get residency mode for a company and data type
 * 
 * SAFETY RULES:
 * 1. Visitors ALWAYS default to 'app' (stay in VMS)
 * 2. Employees default to 'platform' if company not in VMS DB
 * 3. Entities (locations) default to 'platform' (come from Platform)
 * 
 * @param {string} companyId - Company ID
 * @param {string} dataType - Actor/entity type ('employee', 'visitor', 'location', 'zone')
 * @returns {Promise<'platform'|'app'>} Residency mode
 */
async function getResidencyMode(companyId, dataType) {
    // SAFETY: Require data_type
    if (!dataType) {
        console.log('[ResidencyDetector] WARNING: No dataType provided, defaulting to app for safety');
        return 'app';
    }

    const ACTOR_TYPES = ['employee', 'visitor'];
    const ENTITY_TYPES = ['location', 'zone', 'organization', 'plant', 'building', 'gate'];

    // Try Platform API first (most authoritative)
    try {
        const mode = await getFromPlatform(companyId, dataType);
        if (mode) {
            console.log(`[ResidencyDetector] Platform API returned mode=${mode} for ${dataType}`);
            return mode;
        }
    } catch (e) {
        console.log(`[ResidencyDetector] Platform API error: ${e.message}`);
    }

    // Try local installations (second priority)
    try {
        const mode = await getFromInstallations(companyId, dataType);
        if (mode) {
            console.log(`[ResidencyDetector] Local installation mode=${mode} for ${dataType}`);
            return mode;
        }
    } catch (e) {
        console.log(`[ResidencyDetector] Installations check error: ${e.message}`);
    }

    // CRITICAL: Entities ALWAYS come from Platform
    if (ENTITY_TYPES.includes(dataType)) {
        console.log(`[ResidencyDetector] Entity '${dataType}': Always from Platform (platform mode)`);
        return 'platform';
    }

    // Check if company exists in VMS DB (only for actors)
    let companyExists = false;
    try {
        companyExists = await companyExistsInVms(companyId);
        if (companyExists) {
            console.log(`[ResidencyDetector] Company ${companyId} found in VMS DB -> app mode`);
            return 'app';
        }
    } catch (e) {
        console.log(`[ResidencyDetector] VMS DB check error: ${e.message}`);
    }

    // SAFE DEFAULTS based on data type
    if (dataType === 'visitor') {
        // SAFETY: Visitors default to 'app' (stay in VMS)
        console.log(`[ResidencyDetector] SAFE DEFAULT: Actor 'visitor' stays in VMS (app mode)`);
        return 'app';
    } else if (dataType === 'employee') {
        // Employees can default to platform if company not in VMS
        if (!companyExists) {
            console.log(`[ResidencyDetector] Actor 'employee': Company not in VMS DB -> platform mode`);
            return 'platform';
        } else {
            console.log(`[ResidencyDetector] Actor 'employee': Company in VMS DB -> app mode`);
            return 'app';
        }
    }

    // Unknown data type - safest is 'app'
    console.log(`[ResidencyDetector] WARNING: Unknown dataType '${dataType}' -> defaulting to 'app' for safety`);
    return 'app';
}

/**
 * Get residency mode from Platform API
 */
async function getFromPlatform(companyId, entityType) {
    try {
        const url = `${Config.PLATFORM_API_URL}/bharatlytics/integration/v1/installations/mapping`;

        // Generate JWT token for auth
        const platformSecret = Config.PLATFORM_JWT_SECRET || Config.JWT_SECRET;
        const payload = {
            sub: Config.APP_ID || 'vms_app_v1',
            companyId,
            iss: 'vms',
            exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        };
        const token = jwt.sign(payload, platformSecret, { algorithm: 'HS256' });

        const response = await axios.get(url, {
            params: { companyId, appId: 'vms_app_v1' },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000
        });

        if (response.status === 200) {
            const data = response.data;
            const mapping = data.mapping || {};

            // Check for entity-specific residency mode
            if (entityType) {
                const entityRequirements = mapping.entityRequirements || [];

                for (const entityConfig of entityRequirements) {
                    if ((entityConfig.name || '').toLowerCase() === entityType.toLowerCase()) {
                        const source = entityConfig.source || 'Platform';

                        if (source === 'Platform') {
                            console.log(`[ResidencyDetector] Manifest: ${entityType} source=Platform -> mode=platform`);
                            return 'platform';
                        } else if (source === 'Visitor Management System') {
                            console.log(`[ResidencyDetector] Manifest: ${entityType} source=VMS -> mode=app`);
                            return 'app';
                        }
                    }
                }

                // Fallback: check old residencyMode structure
                const residencyMode = mapping.residencyMode || {};
                const actorKey = `actor_${entityType}`;
                const actorConfig = residencyMode[actorKey] || {};
                const mode = actorConfig.mode;

                if (mode) {
                    console.log(`[ResidencyDetector] Platform API returned mode=${mode} for ${entityType}`);
                    return mode;
                }
            }
        }
    } catch (e) {
        console.log(`[ResidencyDetector] Platform API failed: ${e.message}`);
    }
    return null;
}

/**
 * Get residency mode from local installations collection
 */
async function getFromInstallations(companyId, entityType) {
    try {
        const db = getDb();
        const installation = await db.collection('installations').findOne({ company_id: companyId });

        if (installation && installation.residency_mode) {
            console.log(`[ResidencyDetector] Local installation mode=${installation.residency_mode}`);
            return installation.residency_mode;
        }
    } catch (e) {
        // Collection might not exist
    }
    return null;
}

/**
 * Check if company exists in VMS database
 */
async function companyExistsInVms(companyId) {
    try {
        let company = null;
        try {
            company = await collections.companies().findOne({ _id: new ObjectId(companyId) });
        } catch {
            company = await collections.companies().findOne({ _id: companyId });
        }
        return company !== null;
    } catch (e) {
        return false;
    }
}

/**
 * Check if in platform mode
 */
async function isPlatformMode(companyId, entityType) {
    const mode = await getResidencyMode(companyId, entityType);
    return mode === 'platform';
}

/**
 * Check if in app mode
 */
async function isAppMode(companyId, entityType) {
    const mode = await getResidencyMode(companyId, entityType);
    return mode === 'app';
}

module.exports = {
    getResidencyMode,
    isPlatformMode,
    isAppMode,
    companyExistsInVms
};
