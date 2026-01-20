/**
 * Platform Client Service
 * Fetches actors and entities from Platform API
 * 
 * Ported from Python app/services/platform_client_wrapper.py
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');
const Config = require('../config');

console.log('[PlatformClient] MODULE LOADED - Platform API URL:', Config.PLATFORM_API_URL);

/**
 * Platform Client for fetching data from Platform API
 */
class PlatformClient {
    constructor(companyId, sessionToken = null) {
        this.companyId = companyId;
        this.sessionToken = sessionToken;
        // Remove trailing slash from baseUrl to avoid double slashes
        this.baseUrl = (Config.PLATFORM_API_URL || 'http://localhost:5000').replace(/\/$/, '');
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
        console.log(`[PlatformClient] Using sessionToken: ${this.sessionToken ? 'YES (SSO)' : 'NO (self-generated)'}`);
        console.log(`[PlatformClient] Platform URL: ${this.baseUrl}`);

        try {
            const url = `${this.baseUrl}/bharatlytics/v1/actors`;
            console.log(`[PlatformClient] GET ${url} with params: companyId=${cid}, actorType=employee`);

            const response = await axios.get(url, {
                params: {
                    companyId: cid,
                    actorType: 'employee',
                    status: 'active'
                },
                headers: this.getHeaders(),
                timeout: 10000
            });

            console.log(`[PlatformClient] Response status: ${response.status}`);
            console.log(`[PlatformClient] Response data type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`);

            if (response.status === 200) {
                const data = response.data;
                // Platform returns array directly from list_actors, not {actors: [...]}
                const actors = Array.isArray(data) ? data : (data.actors || data.data || []);
                console.log(`[PlatformClient] Fetched ${actors.length} employees from Platform`);

                if (actors.length > 0) {
                    console.log(`[PlatformClient] Sample actor:`, JSON.stringify(actors[0]).substring(0, 200));
                }

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
        console.log(`[PlatformClient] Using sessionToken: ${this.sessionToken ? 'YES (SSO)' : 'NO (self-generated)'}`);

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

            console.log(`[PlatformClient] GET ${url} with params:`, params);

            const response = await axios.get(url, {
                params,
                headers: this.getHeaders(),
                timeout: 10000
            });

            console.log(`[PlatformClient] Entities response status: ${response.status}`);
            console.log(`[PlatformClient] Entities response data type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`);

            if (response.status === 200) {
                const data = response.data;
                // Platform may return array directly OR {entities: []} wrapper
                let entities = Array.isArray(data) ? data : (data.entities || data.data || []);

                console.log(`[PlatformClient] Raw entities count: ${entities.length}`);
                if (entities.length > 0) {
                    console.log(`[PlatformClient] Sample entity:`, JSON.stringify(entities[0]).substring(0, 200));
                }

                // Filter by allowed types from installation mappings
                if (allowedTypes && allowedTypes.length > 0) {
                    entities = entities.filter(e => allowedTypes.includes(e.type));
                    console.log(`[PlatformClient] After filtering: ${entities.length} entities of types ${allowedTypes}`);
                } else {
                    console.log(`[PlatformClient] No type filter - returning all ${entities.length} entities`);
                }

                // Transform to VMS format
                return entities.map(entity => this.transformEntityToLocation(entity));
            }
        } catch (error) {
            console.error(`[PlatformClient] Error fetching entities: ${error.message}`);
            if (error.response) {
                console.error(`[PlatformClient] Entities error status: ${error.response.status}, data:`, JSON.stringify(error.response.data));
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
            console.log(`[PlatformClient] Fetching installation mappings from ${url}`);

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
                console.log(`[PlatformClient] Installation mapping raw response:`, JSON.stringify(data).substring(0, 500));

                // The mapping can be directly in data or in data.mapping
                const mapping = data.mapping || data;
                console.log(`[PlatformClient] Mapping object keys:`, Object.keys(mapping));

                // Check installationMappings array - each mapping has source, mapToType, platformEntityType
                const installationMappings = mapping.installationMappings || [];
                console.log(`[PlatformClient] installationMappings count: ${installationMappings.length}`);

                if (installationMappings.length > 0) {
                    console.log(`[PlatformClient] First installationMapping:`, JSON.stringify(installationMappings[0]));

                    // Extract entity types from mappings where source is "Platform"
                    const entityTypes = installationMappings
                        .filter(m => m.source === 'Platform' && m.mapToType)
                        .map(m => m.mapToType);

                    if (entityTypes.length > 0) {
                        console.log(`[PlatformClient] Found mapped entity types: ${entityTypes}`);
                        return entityTypes;
                    }
                }

                // Fallback: check entityRequirements
                const entityRequirements = mapping.entityRequirements || [];
                console.log(`[PlatformClient] entityRequirements count: ${entityRequirements.length}`);

                if (entityRequirements.length > 0) {
                    console.log(`[PlatformClient] First entityRequirement:`, JSON.stringify(entityRequirements[0]));

                    const entityTypes = entityRequirements
                        .filter(e => e.source === 'Platform')
                        .map(e => e.name);

                    if (entityTypes.length > 0) {
                        console.log(`[PlatformClient] Found entity requirements: ${entityTypes}`);
                        return entityTypes;
                    }
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
