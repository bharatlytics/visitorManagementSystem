import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

/**
 * SSO Callback Page
 * Handles redirect from Platform SSO with token in URL params
 */
export default function SSOCallback() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const { ssoLogin } = useAuthStore()

    useEffect(() => {
        const token = searchParams.get('token')
        const companyId = searchParams.get('companyId')
        const companyName = searchParams.get('companyName')
        const companyLogo = searchParams.get('companyLogo')

        // Parse permissions JSON from URL params (set by Platform SSO)
        let permissions = null
        const permissionsStr = searchParams.get('permissions')
        if (permissionsStr) {
            try {
                permissions = JSON.parse(permissionsStr)
                console.log('[SSO] Permissions received:', permissions)
            } catch (e) {
                console.warn('[SSO] Failed to parse permissions:', e)
            }
        }

        if (token && companyId) {
            // Store the auth data with permissions
            ssoLogin(token, companyId, companyName, companyLogo, permissions)
            // Redirect to dashboard
            navigate('/', { replace: true })
        } else {
            // No valid token, redirect to login
            console.error('SSO callback missing token or companyId')
            navigate('/login', { replace: true })
        }
    }, [searchParams, navigate, ssoLogin])

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Signing in via Platform SSO...</p>
            </div>
        </div>
    )
}
