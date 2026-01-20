/**
 * Platform Client Service
 * Fetches actors and entities from Platform API
 * 
 * Ported from Python app/services/platform_client_wrapper.py
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');
const Config = require('../config');

/**
 * Platform Client for fetching data from Platform API
 */
class PlatformClient {
    constructor(companyId, sessionToken = null) {
        this.companyId = companyId;
        this.sessionToken = sessionToken;
        this.baseUrl = Config.PLATFORM_API_URL;
    }

    /**
     * Generate a JWT token for Platform API auth
     */
    generateToken() {
        if (this.sessionToken) {
            return this.sessionToken;
        }

        const platformSecret = Config.PLATFORM_JWT_SECRET || Config.JWT_SECRET;
        const payload = {
            sub: Config.APP_ID || 'vms_app_v1',
            companyId: this.companyId,
            iss: 'vms',
            exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        };
        return jwt.sign(payload, platformSecret, { algorithm: 'HS256' });
    }

    /**
     * Get default headers for Platform API requests
     */
    getHeaders() {
        return {
            'Authorization': `Bearer ${this.generateToken()}`,
            'Content-Type': 'application/json',
            'X-App-ID': Config.APP_ID || 'vms_app_v1'
        };
    }

    /**
     * Fetch employees from Platform actors API
     * 
     * @param {string} companyId - Company ID
     * @returns {Promise<Array>} List of employees
     */
    async getEmployees(companyId = null) {
        const cid = companyId || this.companyId;
        console.log(`[PlatformClient] Fetching employees from Platform for company ${cid}`);

        try {
            const url = `${this.baseUrl}/bharatlytics/v1/actors`;
            const response = await axios.get(url, {
                params: {
                    companyId: cid,
                    actorType: 'employee',
                    status: 'active'
                },
                headers: this.getHeaders(),
                timeout: 10000
            });

            if (response.status === 200) {
                const data = response.data;
                const actors = data.actors || data.data || [];
                console.log(`[PlatformClient] Fetched ${actors.length} employees from Platform`);

                // Transform Platform actors to VMS employee format
                return actors.map(actor => this.transformActorToEmployee(actor));
            }
        } catch (error) {
            console.error(`[PlatformClient] Error fetching employees: ${error.message}`);
            if (error.response) {
                console.error(`[PlatformClient] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
        }
        return [];
    }

    /**
     * Transform Platform actor to VMS employee format
     */
    transformActorToEmployee(actor) {
        const attrs = actor.attributes || {};

        return {
            _id: actor._id || actor.id,
            employeeId: attrs.employeeId || attrs.code || actor._id,
            employeeName: attrs.name || attrs.employeeName || 'Unknown',
            email: attrs.email || null,
            phone: attrs.phone || null,
            department: attrs.department || null,
            designation: attrs.designation || null,
            status: actor.status || 'active',
            blacklisted: actor.blacklisted || attrs.blacklisted || false,
            companyId: actor.companyId || this.companyId,
            dataResidency: 'platform',
            platformActorId: actor._id,
            // Include original attributes for reference
            attributes: attrs
        };
    }

    /**
     * Fetch entities from Platform API
     * 
     * @param {string} companyId - Company ID
     * @param {Array<string>} types - Entity types to filter
     * @returns {Promise<Array>} List of entities
     */
    async getEntities(companyId = null, types = null) {
        const cid = companyId || this.companyId;
        console.log(`[PlatformClient] Fetching entities from Platform for company ${cid}, types: ${types}`);

        try {
            // First, get installation mappings to filter by allowed entity types
            const allowedTypes = await this.getInstallationMappedEntityTypes(cid);
            console.log(`[PlatformClient] Installation mapped entity types: ${JSON.stringify(allowedTypes)}`);

            const url = `${this.baseUrl}/bharatlytics/v1/entities`;
            const params = { companyId: cid };

            // Use installation mappings if available, otherwise use provided types
            const filterTypes = types || allowedTypes;
            if (filterTypes && filterTypes.length > 0) {
                params.types = filterTypes.join(',');
            }

            const response = await axios.get(url, {
                params,
                headers: this.getHeaders(),
                timeout: 10000
            });

            if (response.status === 200) {
                const data = response.data;
                let entities = data.entities || data.data || [];

                // Filter by allowed types from installation mappings
                if (allowedTypes && allowedTypes.length > 0) {
                    entities = entities.filter(e => allowedTypes.includes(e.type));
                    console.log(`[PlatformClient] After filtering: ${entities.length} entities of types ${allowedTypes}`);
                } else {
                    console.log(`[PlatformClient] Fetched ${entities.length} entities from Platform`);
                }

                // Transform to VMS format
                return entities.map(entity => this.transformEntityToLocation(entity));
            }
        } catch (error) {
            console.error(`[PlatformClient] Error fetching entities: ${error.message}`);
            if (error.response) {
                console.error(`[PlatformClient] Status: ${error.response.status}`);
            }
        }
        return [];
    }

    /**
     * Get entity types from installation mappings
     */
    async getInstallationMappedEntityTypes(companyId) {
        try {
            const url = `${this.baseUrl}/bharatlytics/integration/v1/installations/mapping`;
            const response = await axios.get(url, {
                params: {
                    companyId,
                    appId: Config.APP_ID || 'vms_app_v1'
                },
                headers: this.getHeaders(),
                timeout: 5000
            });

            if (response.status === 200) {
                const data = response.data;
                const mapping = data.mapping || {};

                // Check installationMappings for entity types
                const installationMappings = mapping.installationMappings || [];
                if (installationMappings.length > 0) {
                    // Extract entity types from mappings
                    const entityTypes = installationMappings
                        .filter(m => m.platformEntityType)
                        .map(m => m.platformEntityType);

                    if (entityTypes.length > 0) {
                        console.log(`[PlatformClient] Found installation mappings: ${entityTypes}`);
                        return entityTypes;
                    }
                }

                // Fallback: check entityRequirements
                const entityRequirements = mapping.entityRequirements || [];
                const entityTypes = entityRequirements
                    .filter(e => e.source === 'Platform')
                    .map(e => e.name);

                if (entityTypes.length > 0) {
                    console.log(`[PlatformClient] Found entity requirements: ${entityTypes}`);
                    return entityTypes;
                }
            }
        } catch (error) {
            console.log(`[PlatformClient] Could not get installation mappings: ${error.message}`);
        }

        // Default: return common entity types
        return null;
    }

    /**
     * Transform Platform entity to VMS location format
     */
    transformEntityToLocation(entity) {
        return {
            _id: entity._id || entity.id,
            name: entity.name || 'Unknown',
            type: entity.type || 'location',
            description: entity.description || null,
            code: entity.code || null,
            parentId: entity.parentId || null,
            companyId: entity.companyId || this.companyId,
            status: entity.status || 'active',
            dataResidency: 'platform',
            platformEntityId: entity._id,
            // Include metadata
            metadata: entity.metadata || entity.attributes || {}
        };
    }

    /**
     * Fetch a single employee by ID from Platform
     */
    async getEmployeeById(employeeId, companyId = null) {
        const cid = companyId || this.companyId;
        console.log(`[PlatformClient] Fetching employee ${employeeId} from Platform`);

        try {
            // Try direct lookup first
            const url = `${this.baseUrl}/bharatlytics/v1/actors/${employeeId}`;
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                timeout: 10000
            });

            if (response.status === 200) {
                const actor = response.data.actor || response.data;
                return this.transformActorToEmployee(actor);
            }
        } catch (error) {
            // If direct lookup fails, search in all employees
            console.log(`[PlatformClient] Direct lookup failed, searching in employees list`);
        }

        // Fallback: search in all employees
        const employees = await this.getEmployees(cid);

        for (const emp of employees) {
            const idMatch = String(emp._id) === String(employeeId);
            const employeeIdMatch = emp.employeeId === employeeId;
            const attrMatch = emp.attributes?.employeeId === employeeId;

            if (idMatch || employeeIdMatch || attrMatch) {
                return emp;
            }
        }

        return null;
    }
}

/**
 * Create a PlatformClient instance
 */
function createPlatformClient(companyId, sessionToken = null) {
    return new PlatformClient(companyId, sessionToken);
}

module.exports = {
    PlatformClient,
    createPlatformClient
};
