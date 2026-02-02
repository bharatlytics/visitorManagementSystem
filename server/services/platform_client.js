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
     * Keeps all Platform fields + adds VMS convenience fields
     */
    transformActorToEmployee(actor) {
        const attrs = actor.attributes || {};

        // Spread all Platform actor fields first to preserve everything (downloadUrl, etc.)
        // Then add VMS convenience fields
        return {
            ...actor,  // All Platform fields including actorImages, actorEmbeddings, etc.
            // VMS flattened fields for convenience (matching Python API)
            employeeId: attrs.employeeId || attrs.code || actor._id,
            employeeName: attrs.name || attrs.employeeName || 'Unknown',
            employeeEmail: attrs.email || attrs.employeeEmail || null,
            employeeMobile: attrs.phone || attrs.employeeMobile || null
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
        console.log(`[PlatformClient] *** getInstallationMappedEntityTypes called for company ${companyId} ***`);
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

                // Platform returns { mapping: {...}, status: 'configured' } or { mapping: null, status: 'not_configured' }
                if (!data.mapping) {
                    console.log(`[PlatformClient] No mapping configured for this app/company`);
                    return null;
                }

                const mapping = data.mapping;
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

                // entityMappings format: { "location": ["organization"], "visitor": ["visitor"] }
                // Each key is the VMS entity name, value is an array of Platform entity types
                const entityMappings = mapping.entityMappings || {};
                console.log(`[PlatformClient] entityMappings:`, JSON.stringify(entityMappings));

                // Collect all Platform entity types from the mappings
                const platformEntityTypes = [];
                for (const [appEntityName, platformTypes] of Object.entries(entityMappings)) {
                    // platformTypes is an array like ["organization"] or could be the old object format
                    if (Array.isArray(platformTypes)) {
                        platformEntityTypes.push(...platformTypes);
                        console.log(`[PlatformClient] Found entity mapping: ${appEntityName} → ${platformTypes.join(', ')}`);
                    } else if (platformTypes && platformTypes.mapToType) {
                        // Legacy format: { source: "Platform", mapToType: "organization" }
                        platformEntityTypes.push(platformTypes.mapToType);
                        console.log(`[PlatformClient] Found entity mapping (legacy): ${appEntityName} → ${platformTypes.mapToType}`);
                    }
                }

                if (platformEntityTypes.length > 0) {
                    console.log(`[PlatformClient] Mapped platform entity types: ${platformEntityTypes}`);
                    return platformEntityTypes;
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
     * Keeps all Platform fields + adds VMS convenience fields
     */
    transformEntityToLocation(entity) {
        const attrs = entity.attributes || {};
        // Build path array from parentId chain if available
        const path = entity.path || (entity.parentId ? ['root', entity.parentId] : ['root']);

        // Spread all Platform entity fields first to preserve everything
        return {
            ...entity,  // All Platform fields
            // VMS convenience fields / overrides
            name: entity.name || attrs.name || 'Unknown',
            type: entity.type || 'location',
            path: path
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

    /**
     * Update an actor in the Platform
     * 
     * @param {string} actorId - Actor ID
     * @param {Object} updateFields - Fields to update
     * @returns {Promise<Object>} Result of update operation
     */
    async updateActor(actorId, updateFields) {
        console.log(`[PlatformClient] Updating actor ${actorId} on Platform`);
        console.log(`[PlatformClient] Update fields:`, JSON.stringify(updateFields));

        try {
            const url = `${this.baseUrl}/bharatlytics/v1/actors/${actorId}`;

            // Build the update payload
            const updatePayload = { ...updateFields };

            // If updating attributes, merge them
            if (updateFields.attributes) {
                updatePayload.attributes = updateFields.attributes;
            }

            const response = await axios.patch(url, updatePayload, {
                headers: this.getHeaders(),
                timeout: 10000
            });

            console.log(`[PlatformClient] Update response status: ${response.status}`);

            if (response.status === 200) {
                return {
                    success: true,
                    actor: response.data.actor || response.data
                };
            }

            return {
                success: false,
                error: `Unexpected status: ${response.status}`
            };
        } catch (error) {
            console.error(`[PlatformClient] Error updating actor: ${error.message}`);
            if (error.response) {
                console.error(`[PlatformClient] Status: ${error.response.status}, Data:`, JSON.stringify(error.response.data));
                return {
                    success: false,
                    error: error.response.data?.error || error.response.data?.message || error.message
                };
            }
            return {
                success: false,
                error: error.message
            };
        }
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
