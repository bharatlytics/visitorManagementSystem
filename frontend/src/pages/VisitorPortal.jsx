import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
    Building2, Calendar, Clock, User, Shield, CheckCircle2, FileText,
    QrCode, MapPin, AlertCircle, Phone, ArrowRight, Printer, Copy, Check,
    AlertTriangle, Sparkles, UserCheck, ShieldCheck, ChevronRight
} from 'lucide-react'
import api from '../api/client'

export default function VisitorPortal() {
    const { token } = useParams()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [expiredInfo, setExpiredInfo] = useState(null)
    const [portalData, setPortalData] = useState(null)
    const [copied, setCopied] = useState(false)
    const [activeTab, setActiveTab] = useState('pass') // pass, nda, safety

    useEffect(() => {
        if (token) {
            fetchPortalDetails()
        }
    }, [token])

    const fetchPortalDetails = async () => {
        try {
            setLoading(true)
            setError(null)
            const res = await api.get(`/visitor-portal/${token}`)
            setPortalData(res.data)
        } catch (err) {
            if (err.response?.status === 410) {
                setExpiredInfo(err.response.data)
            } else {
                setError(err.response?.data?.error || 'Unable to load visitor portal. Please check your link.')
            }
        } finally {
            setLoading(false)
        }
    }

    const copyPortalLink = () => {
        navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-700 border-t-blue-500 mb-4"></div>
                <p className="text-slate-400 text-sm animate-pulse">Loading your Visitor Portal...</p>
            </div>
        )
    }

    if (expiredInfo) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl space-y-6">
                    <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-500/30">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <span className="px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full border border-amber-500/20">
                            Portal Expired (7-Day Limit)
                        </span>
                        <h2 className="text-2xl font-bold text-white mt-3">Link No Longer Active</h2>
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                            {expiredInfo.error}
                        </p>
                    </div>
                    {expiredInfo.checkoutDate && (
                        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 text-xs text-slate-400">
                            Check-out Date: <span className="text-slate-200 font-semibold">{new Date(expiredInfo.checkoutDate).toLocaleString()}</span>
                        </div>
                    )}
                    <p className="text-[11px] text-slate-500">
                        If you require access to past visit records or assistance, please contact facility security or your host employee.
                    </p>
                </div>
            </div>
        )
    }

    if (error || !portalData) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl space-y-6">
                    <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-500/30">
                        <AlertCircle className="w-8 h-8" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Invalid Visit Link</h2>
                        <p className="text-xs text-slate-400 mt-2">{error || 'The visit portal link could not be found.'}</p>
                    </div>
                    <button
                        onClick={fetchPortalDetails}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        )
    }

    const { company, visit, preregistration, timeline, nda } = portalData
    const isPreReg = !visit && preregistration

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500 selection:text-white">
            {/* Header / Branding Bar */}
            <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-50">
                <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {company.logo ? (
                            <img src={company.logo} alt={company.name} className="h-8 w-auto max-w-[120px] object-contain" />
                        ) : (
                            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
                                <Building2 className="w-5 h-5" />
                            </div>
                        )}
                        <div>
                            <h1 className="font-bold text-base text-white leading-tight">{company.name}</h1>
                            <p className="text-[11px] text-blue-400 font-medium">Digital Visitor Pass Portal</p>
                        </div>
                    </div>
                    <button
                        onClick={copyPortalLink}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                        title="Copy Portal Link"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copied' : 'Share'}</span>
                    </button>
                </div>
            </header>

            {/* Main Portal View */}
            <main className="flex-1 max-w-2xl w-full mx-auto p-4 space-y-6 pb-12">
                {/* Visitor Greeting Card */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

                    <div className="flex items-start justify-between">
                        <div>
                            <span className="px-2.5 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] uppercase font-black rounded-md tracking-wider">
                                {visit?.visitType || preregistration?.visitorType || 'Visitor'}
                            </span>
                            <h2 className="text-2xl font-black text-white mt-2">
                                Welcome, {visit?.visitorName || preregistration?.visitorName}
                            </h2>
                            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                <span>Host:</span> <strong className="text-slate-200 font-semibold">{visit?.hostEmployeeName || preregistration?.hostEmployeeName || 'Assigned Host'}</strong>
                            </p>
                        </div>
                        <div className="text-right">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                                visit?.status === 'checked_in' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                visit?.status === 'checked_out' ? 'bg-slate-800 text-slate-400 border border-slate-700' :
                                'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${
                                    visit?.status === 'checked_in' ? 'bg-emerald-400 animate-ping' :
                                    visit?.status === 'checked_out' ? 'bg-slate-500' : 'bg-amber-400'
                                }`}></span>
                                <span className="uppercase text-[11px]">
                                    {visit?.status?.replace('_', ' ') || preregistration?.status || 'Scheduled'}
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Pre-registration Action Banner if registration incomplete */}
                    {isPreReg && (
                        <div className="mt-5 p-4 bg-gradient-to-r from-blue-900/60 to-indigo-900/60 border border-blue-500/40 rounded-2xl flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <Sparkles className="w-4 h-4 text-blue-400" /> Complete Registration Required
                                </p>
                                <p className="text-[11px] text-blue-200 mt-0.5">Capture photo & sign NDA before check-in</p>
                            </div>
                            <Link
                                to={`/visitor-registration/${preregistration.id}`}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-600/30 whitespace-nowrap"
                            >
                                Register Now <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    )}
                </div>

                {/* Status Timeline Bar */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Visit Progress</h3>
                    <div className="flex items-center justify-between relative px-2">
                        <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-slate-800 -translate-y-1/2 -z-0"></div>
                        {timeline.map((step, idx) => (
                            <div key={idx} className="flex flex-col items-center z-10 space-y-1.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                    step.active
                                        ? 'bg-blue-600 text-white ring-4 ring-blue-600/20 shadow-lg'
                                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                                }`}>
                                    {step.active ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                                </div>
                                <span className={`text-[10px] font-medium text-center max-w-[64px] ${step.active ? 'text-slate-200' : 'text-slate-500'}`}>
                                    {step.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tabs Selector */}
                <div className="flex gap-2 bg-slate-900 p-1.5 rounded-2xl border border-slate-800">
                    <button
                        onClick={() => setActiveTab('pass')}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'pass' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <QrCode className="w-4 h-4" /> Digital Pass & Schedule
                    </button>
                    <button
                        onClick={() => setActiveTab('nda')}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'nda' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <FileText className="w-4 h-4" /> NDA & Compliance
                    </button>
                    <button
                        onClick={() => setActiveTab('safety')}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'safety' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Shield className="w-4 h-4" /> Safety Rules
                    </button>
                </div>

                {/* TAB 1: Pass & Schedule */}
                {activeTab === 'pass' && (
                    <div className="space-y-4">
                        {/* Digital QR Badge */}
                        {visit ? (
                            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-xl">
                                <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-mono font-bold rounded-full">
                                    PASS ID: {visit.id.substring(visit.id.length - 8).toUpperCase()}
                                </div>

                                <div className="bg-white p-4 rounded-2xl max-w-[200px] mx-auto shadow-inner border border-slate-200 flex items-center justify-center">
                                    {visit.qrCodeUrl ? (
                                        <img src={visit.qrCodeUrl} alt="Visitor Pass QR" className="w-40 h-40 object-contain" />
                                    ) : (
                                        <QrCode className="w-36 h-36 text-slate-900" />
                                    )}
                                </div>

                                <div>
                                    <p className="text-xs text-slate-400 font-medium">Scan this QR code at kiosk or security turnstile</p>
                                    <p className="text-xs text-emerald-400 font-semibold mt-1">
                                        NDA Status: {visit.ndaSigned ? '✅ Signed & Verified' : '⚠️ Signing Required'}
                                    </p>
                                </div>

                                <div className="pt-2 border-t border-slate-800/80 flex justify-center">
                                    <button
                                        onClick={() => window.print()}
                                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 border border-slate-700"
                                    >
                                        <Printer className="w-4 h-4" /> Print Visitor Pass
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center text-slate-400 text-xs">
                                QR Pass will be issued once pre-registration is completed.
                            </div>
                        )}

                        {/* Schedule & Details List */}
                        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-3">
                                Visit Schedule & Information
                            </h4>

                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 space-y-1">
                                    <p className="text-slate-500 font-medium flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-blue-400" /> Expected Arrival
                                    </p>
                                    <p className="font-semibold text-slate-200">
                                        {visit?.expectedArrival || preregistration?.expectedArrival
                                            ? new Date(visit?.expectedArrival || preregistration?.expectedArrival).toLocaleString()
                                            : 'Not specified'}
                                    </p>
                                </div>

                                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 space-y-1">
                                    <p className="text-slate-500 font-medium flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5 text-blue-400" /> Purpose of Visit
                                    </p>
                                    <p className="font-semibold text-slate-200">
                                        {visit?.purpose || preregistration?.purpose || 'Business Meeting'}
                                    </p>
                                </div>

                                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 space-y-1">
                                    <p className="text-slate-500 font-medium flex items-center gap-1.5">
                                        <User className="w-3.5 h-3.5 text-blue-400" /> Host Contact
                                    </p>
                                    <p className="font-semibold text-slate-200">
                                        {visit?.hostEmployeeName || preregistration?.hostEmployeeName || 'Host'}
                                    </p>
                                </div>

                                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 space-y-1">
                                    <p className="text-slate-500 font-medium flex items-center gap-1.5">
                                        <MapPin className="w-3.5 h-3.5 text-blue-400" /> Facility Location
                                    </p>
                                    <p className="font-semibold text-slate-200">
                                        {visit?.locationName || company.name}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: NDA Details */}
                {activeTab === 'nda' && (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                            <div>
                                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-blue-400" /> Non-Disclosure Agreement (NDA)
                                </h4>
                                <p className="text-[11px] text-slate-400 mt-0.5">Confidentiality terms governing your visit</p>
                            </div>
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${
                                visit?.ndaSigned
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}>
                                {visit?.ndaSigned ? 'Signed' : 'Pending Signature'}
                            </span>
                        </div>

                        {/* NDA Text Box */}
                        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 space-y-3 max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                            {nda.disclosureText}
                        </div>

                        {/* Signature Details */}
                        {visit?.ndaSigned ? (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between text-xs text-emerald-300">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                                    <div>
                                        <p className="font-semibold">Digitally Signed & Acknowledged</p>
                                        <p className="text-[11px] text-emerald-400/80">
                                            Signed on: {visit.ndaSignedAt ? new Date(visit.ndaSignedAt).toLocaleString() : 'Registered'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between text-xs text-amber-300">
                                <p>You have not signed the digital NDA yet.</p>
                                {isPreReg && (
                                    <Link
                                        to={`/visitor-registration/${preregistration.id}`}
                                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
                                    >
                                        Sign NDA
                                    </Link>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 3: Safety Instructions */}
                {activeTab === 'safety' && (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
                        <div className="border-b border-slate-800 pb-4">
                            <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                <Shield className="w-4 h-4 text-blue-400" /> Mandatory Site Safety Rules
                            </h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">Safety compliance required during your visit</p>
                        </div>

                        <div className="space-y-3">
                            {nda.safetyRules.map((rule, idx) => (
                                <div key={idx} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex items-start gap-3 text-xs text-slate-300">
                                    <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <p className="leading-relaxed">{rule.text}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-[11px] text-slate-400">
                            <strong>Note:</strong> In case of an emergency evacuation, follow facility safety marshals to designated muster assembly points.
                        </div>
                    </div>
                )}
            </main>

            {/* Simple Footer */}
            <footer className="bg-slate-900/60 border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
                <p>Powered by Bharatlytics Enterprise Visitor Management System</p>
                <p className="text-[10px] text-slate-600 mt-1">Zero-download secure visitor access</p>
            </footer>
        </div>
    )
}
