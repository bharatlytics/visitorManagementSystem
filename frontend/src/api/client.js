import axios from 'axios'

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,  // Include cookies for session
})

// Add a handler for 401 errors that can be set from outside
api.onUnauthorized = null

// Add companyId and auth token to requests
api.interceptors.request.use((config) => {
    // Get companyId from localStorage
    const companyId = localStorage.getItem('vms_company_id')

    // Add companyId to params if not already present
    if (companyId) {
        if (config.method === 'get' || config.method === 'delete') {
            // For GET/DELETE, add to query params
            config.params = { ...config.params, companyId }
        } else if (config.data && typeof config.data === 'object' && !(config.data instanceof FormData)) {
            // For POST/PUT/PATCH with JSON body, add to body
            config.data = { ...config.data, companyId }
        } else if (config.data instanceof FormData && !config.data.has('companyId')) {
            // For FormData, append companyId
            config.data.append('companyId', companyId)
        }
    }

    // Add auth token if available
    const token = localStorage.getItem('vms_token')
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    } else {
        console.warn('[API Client] No token in localStorage for request:', config.url)
    }

    return config
})

// Handle errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const url = error.config?.url || ''
            console.warn('API returned 401:', url)

            // Don't trigger logout for auth-check endpoints (they're expected to fail for new users)
            const isAuthCheck = url.includes('/auth/me') || url.includes('/auth/check')

            // Call the unauthorized handler if set and this isn't an auth check
            if (api.onUnauthorized && !isAuthCheck) {
                console.log('Triggering unauthorized handler (logout)...')
                api.onUnauthorized()
            }
        }
        return Promise.reject(error)
    }
)

export default api
