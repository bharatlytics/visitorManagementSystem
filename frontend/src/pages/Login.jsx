import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, ArrowRight, Shield, Users, Scan, CheckCircle, Zap, Building2 } from 'lucide-react'
import { useAuthStore } from '../store/authStore'

export default function Login() {
    const [mode, setMode] = useState('login') // 'login' | 'signup'
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    // Signup company mode
    const [companyMode, setCompanyMode] = useState('join') // 'join' | 'create'
    const [companyId, setCompanyId] = useState('')
    const [companyName, setCompanyName] = useState('')
    const [adminSecret, setAdminSecret] = useState('')
    const [verifiedCompany, setVerifiedCompany] = useState(null)
    const [verifying, setVerifying] = useState(false)

    const { login } = useAuthStore()
    const navigate = useNavigate()

    const handleLogin = async (e) => {
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

    const handleSignup = async (e) => {
        e.preventDefault()
        setError('')

        if (password.length < 6) {
            setError('Password must be at least 6 characters')
            return
        }

        setLoading(true)
        try {
            const body = { email, password, name }
            if (companyMode === 'join') {
                if (!companyId.trim()) { setError('Company ID is required'); setLoading(false); return }
                body.companyId = companyId.trim()
            } else {
                if (!companyName.trim()) { setError('Company name is required'); setLoading(false); return }
                body.companyName = companyName.trim()
                body.adminSecret = adminSecret
            }

            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Registration failed')
            } else {
                // Auto-login after signup
                localStorage.setItem('vms_token', data.token)
                localStorage.setItem('vms_user', JSON.stringify(data.user))
                if (data.user.companyId) localStorage.setItem('vms_company_id', data.user.companyId)
                window.location.href = '/'
            }
        } catch (err) {
            setError('Network error — please try again')
        }
        setLoading(false)
    }

    const verifyCompany = async () => {
        if (!companyId.trim()) return
        setVerifying(true)
        setVerifiedCompany(null)
        try {
            const res = await fetch('/api/auth/verify-company', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: companyId.trim() }),
            })
            const data = await res.json()
            if (res.ok) {
                setVerifiedCompany(data.companyName)
            } else {
                setVerifiedCompany(false)
            }
        } catch {
            setVerifiedCompany(false)
        }
        setVerifying(false)
    }

    const handleSSO = () => {
        const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'http://localhost:5000'
        window.location.href = `${platformUrl}`
    }

    const features = [
        { icon: Users, label: 'Visitor Check-In/Out', desc: 'Seamless visitor flow management' },
        { icon: Scan, label: 'Face Recognition', desc: 'AI-powered identity verification' },
        { icon: Shield, label: 'Approval Workflows', desc: 'Multi-level host approvals' },
        { icon: CheckCircle, label: 'Compliance & Audit', desc: 'Complete visit trail & reports' },
    ]

    return (
        <div className="min-h-screen flex bg-gray-50">
            {/* Left — Form */}
            <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-16 py-10">
                <div className="w-full max-w-[400px] mx-auto">
                    {/* Logo */}
                    <div className="flex items-center gap-2.5 mb-8">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <Users className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <div className="font-bold text-gray-900 text-[15px] leading-tight">Visitor Management</div>
                            <div className="text-[10px] text-gray-400 font-medium tracking-wide uppercase">Enterprise Edition</div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
                        <button
                            onClick={() => { setMode('login'); setError('') }}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Sign In
                        </button>
                        <button
                            onClick={() => { setMode('signup'); setError('') }}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Create Account
                        </button>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2.5 animate-in slide-in-from-top-1">
                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-red-600">{error}</span>
                        </div>
                    )}

                    {/* Login Form */}
                    {mode === 'login' && (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
                                <input
                                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                    placeholder="you@company.com" required autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Password</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all pr-10 placeholder:text-gray-400"
                                        placeholder="••••••••" required
                                    />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <button type="submit" disabled={loading}
                                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25">
                                {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
                                    <><span>Sign In</span><ArrowRight className="w-4 h-4" /></>}
                            </button>
                        </form>
                    )}

                    {/* Signup Form */}
                    {mode === 'signup' && (
                        <form onSubmit={handleSignup} className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Full Name</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                    placeholder="John Doe" required autoFocus />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                    placeholder="you@company.com" required />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Password</label>
                                <div className="relative">
                                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all pr-10 placeholder:text-gray-400"
                                        placeholder="Min 6 characters" required />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Company Selector */}
                            <div className="pt-1">
                                <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Company</label>
                                <div className="flex bg-gray-100 rounded-lg p-0.5 mb-3">
                                    <button type="button" onClick={() => setCompanyMode('join')}
                                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${companyMode === 'join' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                                        Join Existing
                                    </button>
                                    <button type="button" onClick={() => setCompanyMode('create')}
                                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${companyMode === 'create' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                                        Create New
                                    </button>
                                </div>

                                {companyMode === 'join' ? (
                                    <div className="space-y-2">
                                        <div className="flex gap-2">
                                            <input type="text" value={companyId} onChange={e => { setCompanyId(e.target.value); setVerifiedCompany(null) }}
                                                className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                                placeholder="Paste Company ID" />
                                            <button type="button" onClick={verifyCompany} disabled={verifying || !companyId.trim()}
                                                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-xs font-semibold text-gray-700 transition-colors whitespace-nowrap">
                                                {verifying ? '...' : 'Verify'}
                                            </button>
                                        </div>
                                        {verifiedCompany === false && <p className="text-xs text-red-500">Company not found</p>}
                                        {verifiedCompany && typeof verifiedCompany === 'string' && (
                                            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg">
                                                <CheckCircle className="w-3.5 h-3.5" />{verifiedCompany}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                            placeholder="Company Name" />
                                        <input type="password" value={adminSecret} onChange={e => setAdminSecret(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400"
                                            placeholder="Admin Secret" />
                                    </div>
                                )}
                            </div>

                            <button type="submit" disabled={loading}
                                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 mt-2">
                                {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
                                    <><span>Create Account</span><ArrowRight className="w-4 h-4" /></>}
                            </button>
                        </form>
                    )}

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                        <div className="relative flex justify-center text-xs"><span className="bg-gray-50 px-3 text-gray-400 font-medium">or</span></div>
                    </div>

                    {/* Platform SSO */}
                    <button onClick={handleSSO}
                        className="w-full py-2.5 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl text-sm font-medium text-gray-700 transition-all flex items-center justify-center gap-2.5 shadow-sm">
                        <div className="w-5 h-5 bg-gradient-to-br from-violet-500 to-blue-600 rounded-md flex items-center justify-center">
                            <Zap className="w-3 h-3 text-white" />
                        </div>
                        Continue with Bharatlytics Platform
                    </button>

                    {/* Footer */}
                    <div className="mt-8 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
                        <Zap className="w-3 h-3" />
                        <span>Powered by <span className="font-semibold text-gray-500">Bharatlytics AI</span></span>
                    </div>
                </div>
            </div>

            {/* Right — Hero */}
            <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 items-center justify-center p-12">
                {/* Subtle grid */}
                <div className="absolute inset-0 opacity-[0.04]"
                    style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
                {/* Glow */}
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-[100px]" />

                <div className="relative max-w-md text-center z-10">
                    <div className="w-16 h-16 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Shield className="w-8 h-8 text-blue-400" />
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">Visitor Management System</h2>
                    <p className="text-blue-200/70 text-sm leading-relaxed mb-10">
                        Enterprise-grade visitor management with AI-powered face recognition,
                        digital badges, and real-time approval workflows.
                    </p>

                    <div className="grid grid-cols-2 gap-3 text-left">
                        {features.map((f, i) => (
                            <div key={i} className="bg-white/[0.04] backdrop-blur border border-white/[0.06] rounded-xl p-3.5 hover:bg-white/[0.07] transition-colors">
                                <f.icon className="w-4.5 h-4.5 text-blue-400 mb-2" strokeWidth={1.5} />
                                <div className="text-white text-xs font-semibold mb-0.5">{f.label}</div>
                                <div className="text-blue-200/50 text-[10px]">{f.desc}</div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-10 flex items-center justify-center gap-5 text-[10px] text-blue-200/40 uppercase tracking-widest font-medium">
                        <span>90+ API Endpoints</span>
                        <span className="w-1 h-1 bg-blue-400/30 rounded-full" />
                        <span>GDPR Compliant</span>
                        <span className="w-1 h-1 bg-blue-400/30 rounded-full" />
                        <span>SOC2 Ready</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
