import { create } from 'zustand'
import api from '../api/client'

// Keys for localStorage
const STORAGE_KEYS = {
    token: 'vms_token',
    user: 'vms_user',
    companyId: 'vms_company_id',
    company: 'vms_company',
    isPlatformConnected: 'vms_platform_connected',
    platformUrl: 'vms_platform_url'
}

// Helper to get stored data
const getStoredAuth = () => {
    try {
        return {
            token: localStorage.getItem(STORAGE_KEYS.token),
            user: JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || 'null'),
            companyId: localStorage.getItem(STORAGE_KEYS.companyId),
            company: JSON.parse(localStorage.getItem(STORAGE_KEYS.company) || 'null'),
            isPlatformConnected: localStorage.getItem(STORAGE_KEYS.isPlatformConnected) === 'true',
            platformUrl: localStorage.getItem(STORAGE_KEYS.platformUrl)
        }
    } catch {
        return { token: null, user: null, companyId: null, company: null, isPlatformConnected: false, platformUrl: null }
    }
}

// Helper to save auth data
const saveAuthToStorage = (data) => {
    if (data.token) localStorage.setItem(STORAGE_KEYS.token, data.token)
    if (data.user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data.user))
    if (data.companyId) localStorage.setItem(STORAGE_KEYS.companyId, data.companyId)
    if (data.company) localStorage.setItem(STORAGE_KEYS.company, JSON.stringify(data.company))
    localStorage.setItem(STORAGE_KEYS.isPlatformConnected, String(data.isPlatformConnected || false))
    if (data.platformUrl) localStorage.setItem(STORAGE_KEYS.platformUrl, data.platformUrl)
}

const clearAuthStorage = () => {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key))
}

export const useAuthStore = create((set, get) => ({
    user: null,
    token: null,
    companyId: null,
    company: null,
    isAuthenticated: false,
    isPlatformConnected: false,
    platformUrl: null,

    checkAuth: async () => {
        // First, try to restore from localStorage for instant hydration
        const stored = getStoredAuth()

        // If we have valid stored auth with token, trust it and set up the state
        // This prevents the auth loop issue where /auth/me fails after SSO
        if (stored.token && stored.user && stored.companyId) {
            // Set up the auth state immediately
            set({
                user: stored.user,
                token: stored.token,
                companyId: stored.companyId,
                company: stored.company,
                isAuthenticated: true,
                isPlatformConnected: stored.isPlatformConnected,
                platformUrl: stored.platformUrl
            })

            // Ensure axios has the token
            api.defaults.headers.common['Authorization'] = `Bearer ${stored.token}`

            // Return true immediately - no server validation needed
            // The token will be validated by the API endpoints themselves
            return true
        }

        // Validate session with backend (Platform SSO check)
        try {
            // Build fetch options with optional Authorization header
            const fetchOptions = {
                credentials: 'include'  // Include cookies for session-based auth
            }

            // If we have a stored token, include it in the Authorization header
            if (stored.token) {
                fetchOptions.headers = {
                    'Authorization': `Bearer ${stored.token}`
                }
            }

            const response = await fetch('/auth/me', fetchOptions)

            if (response.ok) {
                const data = await response.json()

                const authData = {
                    token: stored.token, // Preserve the token from localStorage
                    user: {
                        id: data.user_id,
                        name: data.company?.name || data.user_name || 'User',
                        email: data.user_email
                    },
                    companyId: data.company_id,
                    company: data.company,
                    isAuthenticated: true,
                    isPlatformConnected: data.connected,
                    platformUrl: data.platform_url
                }

                // Ensure axios has the token for subsequent API calls
                if (stored.token) {
                    api.defaults.headers.common['Authorization'] = `Bearer ${stored.token}`
                }

                set(authData)
                saveAuthToStorage(authData)

                return true
            } else {
                // Session expired or invalid - check if we had stored auth
                if (stored.user && stored.companyId) {
                    // Keep using stored data - might still work for API calls
                    return true
                }
                // No valid session
                clearAuthStorage()
                set({
                    user: null,
                    token: null,
                    companyId: null,
                    company: null,
                    isAuthenticated: false,
                    isPlatformConnected: false,
                    platformUrl: null
                })
                return false
            }
        } catch (error) {
            console.log('Session check failed:', error.message)
            // If network error but we have stored auth, keep it
            if (stored.user && stored.companyId) {
                return true
            }
            return false
        }
    },

    login: async (email, password) => {
        try {
            const response = await api.post('/auth/login', { email, password })
            const { token, user } = response.data
            const companyId = user.companyId

            const authData = {
                token,
                user,
                companyId,
                company: null,
                isAuthenticated: true,
                isPlatformConnected: false,
                platformUrl: null
            }

            api.defaults.headers.common['Authorization'] = `Bearer ${token}`
            set(authData)
            saveAuthToStorage(authData)

            return { success: true }
        } catch (error) {
            return { success: false, error: error.response?.data?.error || 'Login failed' }
        }
    },

    // SSO login - called from SSO callback page
    ssoLogin: (token, companyId, companyName, companyLogo) => {
        const authData = {
            token,
            user: { id: 'sso-user', name: companyName || 'User' },
            companyId,
            company: { id: companyId, name: companyName, logo: companyLogo },
            isAuthenticated: true,
            isPlatformConnected: true,
            platformUrl: null
        }

        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        set(authData)
        saveAuthToStorage(authData)

        return { success: true }
    },

    logout: async () => {
        const { isPlatformConnected, platformUrl } = get()

        // Clear storage
        clearAuthStorage()
        delete api.defaults.headers.common['Authorization']

        // Call logout endpoint to clear server session
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
        } catch (e) {
            // Ignore errors
        }

        set({
            user: null,
            token: null,
            companyId: null,
            company: null,
            isAuthenticated: false,
            isPlatformConnected: false,
            platformUrl: null
        })

        // If connected to platform, redirect back to platform
        if (isPlatformConnected && platformUrl) {
            window.location.href = platformUrl
        }
    },
}))
