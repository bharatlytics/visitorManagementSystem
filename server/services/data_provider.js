/**
 * Data Provider Service
 * Residency-aware data fetching layer
 * 
 * Provides unified data access based on residency mode:
 * - App mode: Fetch from VMS local database
 * - Platform mode: Fetch from Platform using manifest actor mapping
 * 
 * Ported from Python app/services/data_provider.py
 */
const { ObjectId } = require('mongodb');
const { collections, getDb } = require('../db');
const { getResidencyMode } = require('./residency_detector');
const { createPlatformClient } = require('./platform_client');

/**
 * Data Provider class for residency-aware data fetching
 */
class DataProvider {
    constructor(companyId, sessionToken = null) {
        this.companyId = companyId;
        this.sessionToken = sessionToken;
        this._platformClient = null;
    }

    /**
     * Get Platform client instance (lazy init)
     */
    get platformClient() {
        if (!this._platformClient) {
            this._platformClient = createPlatformClient(this.companyId, this.sessionToken);
        }
        return this._platformClient;
    }

    /**
     * Get employees with residency-aware logic
     * 
     * @param {string} companyId - Company ID (optional, uses instance companyId)
     * @returns {Promise<Array>} List of employees
     */
    async getEmployees(companyId = null) {
        const cid = companyId || this.companyId;

        // Check residency mode
        const mode = await getResidencyMode(cid, 'employee');
        console.log(`[DataProvider.getEmployees] Company ${cid}, mode: ${mode}`);

        if (mode === 'app') {
            return this._getEmployeesFromVms(cid);
        }

        // Platform mode
        return this._getEmployeesFromPlatform(cid);
    }

    /**
     * Fetch employees from VMS local database
     */
    async _getEmployeesFromVms(companyId) {
        console.log(`[DataProvider] Fetching employees from VMS DB`);

        let query;
        try {
            const cidOid = new ObjectId(companyId);
            query = { $or: [{ companyId: cidOid }, { companyId }] };
        } catch {
            query = { companyId };
        }

        const employees = await collections.employees().find(query).toArray();
        console.log(`[DataProvider] Found ${employees.length} employees in VMS DB`);

        // Mark as app residency
        return employees.map(emp => ({
            ...emp,
            dataResidency: 'app'
        }));
    }

    /**
     * Fetch employees from Platform
     */
    async _getEmployeesFromPlatform(companyId) {
        console.log(`[DataProvider] Fetching employees from Platform`);
        return this.platformClient.getEmployees(companyId);
    }

    /**
     * Get single employee by ID
     * 
     * @param {string} employeeId - Employee ID
     * @param {string} companyId - Company ID
     * @returns {Promise<Object|null>} Employee or null
     */
    async getEmployeeById(employeeId, companyId = null) {
        const cid = companyId || this.companyId;

        const mode = await getResidencyMode(cid, 'employee');

        if (mode === 'app') {
            // Fetch from VMS DB
            let employee = null;
            try {
                employee = await collections.employees().findOne({ _id: new ObjectId(employeeId) });
            } catch {
                employee = await collections.employees().findOne({ employeeId });
            }

            if (employee) {
                employee.dataResidency = 'app';
            }
            return employee;
        }

        // Platform mode
        return this.platformClient.getEmployeeById(employeeId, cid);
    }

    /**
     * Get entities/locations with residency-aware logic
     * 
     * @param {string} companyId - Company ID
     * @param {Array<string>} types - Entity types to filter
     * @returns {Promise<Array>} List of entities
     */
    async getEntities(companyId = null, types = null) {
        const cid = companyId || this.companyId;

        // Check residency mode for locations
        const mode = await getResidencyMode(cid, 'location');
        console.log(`[DataProvider.getEntities] Company ${cid}, mode: ${mode}`);

        if (mode === 'app') {
            return this._getEntitiesFromVms(cid, types);
        }

        // Platform mode - entities come from Platform
        return this._getEntitiesFromPlatform(cid, types);
    }

    /**
     * Fetch entities from VMS local database
     */
    async _getEntitiesFromVms(companyId, types = null) {
        console.log(`[DataProvider] Fetching entities from VMS DB`);

        let query;
        try {
            const cidOid = new ObjectId(companyId);
            query = { $or: [{ companyId: cidOid }, { companyId }] };
        } catch {
            query = { companyId };
        }

        if (types && types.length > 0) {
            query.type = { $in: types };
        }

        const entities = await collections.locations().find(query).toArray();
        console.log(`[DataProvider] Found ${entities.length} entities in VMS DB`);

        // Mark as app residency
        return entities.map(entity => ({
            ...entity,
            dataResidency: 'app'
        }));
    }

    /**
     * Fetch entities from Platform
     */
    async _getEntitiesFromPlatform(companyId, types = null) {
        console.log(`[DataProvider] Fetching entities from Platform`);
        return this.platformClient.getEntities(companyId, types);
    }

    /**
     * Get visitors with residency-aware logic
     * 
     * @param {string} companyId - Company ID
     * @returns {Promise<Array>} List of visitors
     */
    async getVisitors(companyId = null) {
        const cid = companyId || this.companyId;

        // Check residency mode
        const mode = await getResidencyMode(cid, 'visitor');
        console.log(`[DataProvider.getVisitors] Company ${cid}, mode: ${mode}`);

        // Visitors typically stay in app mode, but we check anyway
        if (mode === 'app') {
            return this._getVisitorsFromVms(cid);
        }

        // Platform mode (rare for visitors)
        return this._getVisitorsFromPlatform(cid);
    }

    /**
     * Get single visitor by ID
     * 
     * @param {string} visitorId - Visitor ID
     * @param {string} companyId - Company ID
     * @returns {Promise<Object|null>} Visitor or null
     */
    async getVisitorById(visitorId, companyId = null) {
        const cid = companyId || this.companyId;

        const mode = await getResidencyMode(cid, 'visitor');
        console.log(`[DataProvider.getVisitorById] Company ${cid}, mode: ${mode}`);

        // Visitors always stay in app mode
        let visitor = null;
        try {
            visitor = await collections.visitors().findOne({ _id: new ObjectId(visitorId) });
        } catch {
            // visitorId might not be a valid ObjectId
        }

        if (visitor) {
            visitor.dataResidency = 'app';
        }
        return visitor;
    }

    /**
     * Fetch visitors from VMS local database
     */
    async _getVisitorsFromVms(companyId) {
        console.log(`[DataProvider] Fetching visitors from VMS DB`);

        let query;
        try {
            const cidOid = new ObjectId(companyId);
            query = { $or: [{ companyId: cidOid }, { companyId }] };
        } catch {
            query = { companyId };
        }

        const visitors = await collections.visitors().find(query).toArray();
        console.log(`[DataProvider] Found ${visitors.length} visitors in VMS DB`);

        return visitors.map(v => ({
            ...v,
            dataResidency: 'app'
        }));
    }

    /**
     * Fetch visitors from Platform (rare)
     */
    async _getVisitorsFromPlatform(companyId) {
        console.log(`[DataProvider] Fetching visitors from Platform (unusual)`);
        // Visitors rarely go to platform, but support it anyway
        return this.platformClient.getEmployees(companyId); // reuse actor fetch
    }
}


/**
 * Factory function to create DataProvider
 */
function getDataProvider(companyId, sessionToken = null) {
    return new DataProvider(companyId, sessionToken);
}

module.exports = {
    DataProvider,
    getDataProvider
};
