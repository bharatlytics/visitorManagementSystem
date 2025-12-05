// VMS API functions - Dual mode (Platform + Standalone)

const VMS_API = {
    // Detect mode and set base path
    basePath: '/api',  // Default to standalone

    init: function() {
        // Check if running in platform mode
        if (window.location.pathname.includes('/companies/')) {
            this.basePath = '/api';  // Use local API but with platform context
        }
    },

    // Helper for API calls
    call: function(endpoint, method = 'GET', data = null, contentType = 'application/json') {
        const options = {
            method: method,
            headers: {}
        };

        if (data) {
            if (contentType === 'application/json') {
                options.headers['Content-Type'] = contentType;
                options.body = typeof data === 'string' ? data : JSON.stringify(data);
            } else if (data instanceof FormData) {
                options.body = data;
            }
        }

        return fetch(this.basePath + endpoint, options)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => Promise.reject(err));
                }
                return response.json();
            });
    },

    // Dashboard
    getDashboardStats: (companyId) => VMS_API.call(`/dashboard/stats?companyId=${companyId}`),
    getDashboardTrends: (companyId) => VMS_API.call(`/dashboard/trends?companyId=${companyId}`),

    // Visitors
    getVisitors: (companyId) => VMS_API.call(`/visitors?companyId=${companyId}`),
    getVisitorImage: (imageId) => `${VMS_API.basePath}/visitors/images/${imageId}`,
    
    registerVisitor: (formData) => {
        return fetch(VMS_API.basePath + '/visitors/register', {
            method: 'POST',
            body: formData
        }).then(r => r.json());
    },
    
    updateVisitor: (data) => {
        const formData = new FormData();
        Object.keys(data).forEach(k => {
            if (data[k] !== null && data[k] !== undefined) {
                formData.append(k, data[k]);
            }
        });
        return fetch(VMS_API.basePath + '/visitors/update', {
            method: 'PATCH',
            body: formData
        }).then(r => r.json());
    },

    blacklistVisitor: (visitorId, reason) => 
        VMS_API.call('/visitors/blacklist', 'POST', { visitorId, reason }),
    
    unblacklistVisitor: (visitorId) => 
        VMS_API.call('/visitors/unblacklist', 'POST', { visitorId }),

    // Visits
    getVisits: (companyId) => VMS_API.call(`/visitors/visits?companyId=${companyId}`),
    
    scheduleVisit: (visitorId, data) => 
        VMS_API.call(`/visitors/${visitorId}/schedule-visit`, 'POST', data),
    
    checkIn: (visitId, method = 'manual') => 
        VMS_API.call(`/visitors/visits/${visitId}/check-in`, 'POST', { method }),
    
    checkOut: (visitId) => 
        VMS_API.call(`/visitors/visits/${visitId}/check-out`, 'POST'),

    getVisitQR: (visitId) => `${VMS_API.basePath}/visitors/visits/qr/${visitId}`,
    getVisitBadge: (visitId) => `${VMS_API.basePath}/badge/visits/${visitId}/badge`,

    // Employees (for host selection)
    getEmployees: (companyId) => VMS_API.call(`/employees?companyId=${companyId}`),

    // Entities (for filtering)
    getEntities: (companyId) => VMS_API.call(`/entities?companyId=${companyId}`)
};

// Initialize on load
VMS_API.init();
