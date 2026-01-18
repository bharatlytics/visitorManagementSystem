import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../store/authStore'

export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const { login } = useAuthStore()
    const navigate = useNavigate()

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        const result = await login(email, password)

        if (result.success) {
            navigate('/')
        } else {
            setError(result.error)
        }
        setLoading(false)
    }

    return (
        <div className="min-h-screen flex">
            {/* Left - Form */}
            <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white">
                <div className="w-full max-w-sm">
                    {/* Logo */}
                    <div className="flex items-center gap-2 mb-8">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-sm">
                            <Users className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-bold text-lg text-gray-900">VMS Enterprise</span>
                    </div>

                    <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
                    <p className="text-gray-500 text-sm mb-6">Sign in to your account to continue</p>

                    {error && (
                        <div className="mb-5 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <span className="text-sm text-red-600">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                placeholder="you@company.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all pr-10"
                                    placeholder="••••••••"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    Sign in
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>

            {/* Right - Branding */}
            <div className="hidden lg:flex flex-1 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 items-center justify-center p-12">
                <div className="max-w-md text-center">
                    <div className="w-16 h-16 bg-white/10 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Users className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">Visitor Management System</h2>
                    <p className="text-blue-100 text-sm leading-relaxed">
                        Enterprise-grade visitor management with facial recognition,
                        digital badges, approval workflows, and comprehensive analytics.
                    </p>
                    <div className="mt-8 flex items-center justify-center gap-6 text-xs text-blue-200">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                            90+ API Endpoints
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                            GDPR Compliant
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
