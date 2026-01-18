import axios from 'axios'

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,  // Include cookies for session
})

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
    }

    return config
})

// Handle errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Don't redirect on auth check endpoints
            const url = error.config?.url || ''
            if (!url.includes('/auth/me') && !url.includes('/auth/login')) {
                console.log('Unauthorized - redirecting to login')
                localStorage.removeItem('vms_token')
                localStorage.removeItem('vms_user')
                window.location.href = '/login'
            }
        }
        return Promise.reject(error)
    }
)

export default api
