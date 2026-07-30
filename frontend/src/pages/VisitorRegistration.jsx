import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    User, Mail, Phone, Building, Calendar, Clock, Camera, CheckCircle2,
    Shield, FileText, QrCode, AlertTriangle, ArrowRight, ArrowLeft, RefreshCw,
    Download, Printer, Sparkles, CheckSquare, Square
} from 'lucide-react'
import api from '../api/client'

export default function VisitorRegistration() {
    const { token } = useParams()
    const navigate = useNavigate()

    const [step, setStep] = useState(1)
    const [loading, setLoading] = useState(false)
    const [inviteData, setInviteData] = useState(null)
    const [inviteError, setInviteError] = useState(null)

    // Form fields
    const [formData, setFormData] = useState({
        visitorName: '',
        email: '',
        phone: '',
        organization: '',
        visitorType: 'guest', // guest, contractor, interview, vendor, vip
        idType: 'national_id',
        idNumber: '',
        hostEmployeeId: '',
        hostEmployeeName: '',
        purpose: 'Business Meeting',
        vehicleNumber: '',
        workPermitNumber: '',
    })

    // Hosts list for walk-in kiosk
    const [hosts, setHosts] = useState([])
    const [hostSearch, setHostSearch] = useState('')

    // Camera photo capture
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const [cameraActive, setCameraActive] = useState(false)
    const [capturedPhoto, setCapturedPhoto] = useState(null)

    // NDA & Safety Signoff
    const signatureCanvasRef = useRef(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [hasSignature, setHasSignature] = useState(false)
    const [safetyAgreed, setSafetyAgreed] = useState({
        ppe: false,
        noPhoto: false,
        escortRequired: false,
        emergencyExit: false
    })

    // Result after submission
    const [resultPass, setResultPass] = useState(null)

    useEffect(() => {
        if (token) {
            fetchInviteDetails()
        } else {
            fetchHosts()
        }
    }, [token])

    const fetchInviteDetails = async () => {
        try {
            setLoading(true)
            const res = await api.get(`/preregistration/${token}`)
            if (res.data.valid) {
                setInviteData(res.data)
                setFormData(prev => ({
                    ...prev,
                    visitorName: res.data.visitorName || '',
                    email: res.data.visitorEmail || '',
                    phone: res.data.visitorPhone || '',
                    hostEmployeeName: res.data.hostName || '',
                    purpose: res.data.purpose || 'Meeting',
                    visitorType: res.data.visitType || 'guest'
                }))
            }
        } catch (err) {
            setInviteError(err.response?.data?.error || 'Invalid or expired invitation link')
        } finally {
            setLoading(false)
        }
    }

    const fetchHosts = async () => {
        try {
            const res = await api.get('/employees')
            const list = res.data.employees || res.data || []
            setHosts(list)
        } catch (err) {
            console.error('Failed to load hosts:', err)
        }
    }

    // Camera handler
    const startCamera = async () => {
        try {
            setCameraActive(true)
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
            if (videoRef.current) {
                videoRef.current.srcObject = stream
            }
        } catch (err) {
            alert('Unable to access webcam. You may proceed without photo.')
            setCameraActive(false)
        }
    }

    const capturePhoto = () => {
        if (!videoRef.current || !canvasRef.current) return
        const video = videoRef.current
        const canvas = canvasRef.current
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const photoData = canvas.toDataURL('image/jpeg')
        setCapturedPhoto(photoData)

        // Stop camera stream
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop())
        }
        setCameraActive(false)
    }

    // Signature drawing
    const startDrawing = (e) => {
        const canvas = signatureCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const rect = canvas.getBoundingClientRect()
        const x = (e.clientX || e.touches[0].clientX) - rect.left
        const y = (e.clientY || e.touches[0].clientY) - rect.top
        ctx.beginPath()
        ctx.moveTo(x, y)
        setIsDrawing(true)
        setHasSignature(true)
    }

    const draw = (e) => {
        if (!isDrawing) return
        const canvas = signatureCanvasRef.current
        const ctx = canvas.getContext('2d')
        const rect = canvas.getBoundingClientRect()
        const x = (e.clientX || e.touches[0]?.clientX) - rect.left
        const y = (e.clientY || e.touches[0]?.clientY) - rect.top
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.strokeStyle = '#1E3A8A'
        ctx.lineTo(x, y)
        ctx.stroke()
    }

    const stopDrawing = () => {
        setIsDrawing(false)
    }

    const clearSignature = () => {
        const canvas = signatureCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        setHasSignature(false)
    }

    const handleSubmit = async () => {
        try {
            setLoading(true)

            let signatureData = null
            if (signatureCanvasRef.current && hasSignature) {
                signatureData = signatureCanvasRef.current.toDataURL('image/png')
            }

            const payload = {
                ...formData,
                photo: capturedPhoto,
                ndaSigned: hasSignature,
                signatureData: signatureData,
                safetyAgreed: safetyAgreed,
                signedAt: new Date().isoformat ? new Date().toISOString() : new Date()
            }

            let response
            if (token) {
                // Submit via preregistration invite endpoint
                response = await api.post(`/preregistration/${token}/submit`, payload)
            } else {
                // Submit walk-in check-in via visitor API
                response = await api.post('/visitors/register', payload)
            }

            setResultPass(response.data)
            setStep(4) // Move to confirmation pass step
        } catch (err) {
            alert(err.response?.data?.error || 'Registration failed. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const allSafetyChecked = Object.values(safetyAgreed).every(Boolean)

    const filteredHosts = hosts.filter(h =>
        h.employeeName?.toLowerCase().includes(hostSearch.toLowerCase()) ||
        h.employeeId?.toLowerCase().includes(hostSearch.toLowerCase()) ||
        h.department?.toLowerCase().includes(hostSearch.toLowerCase())
    )

    if (inviteError) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Invitation Expired</h2>
                    <p className="text-sm text-gray-600 mb-6">{inviteError}</p>
                    <button
                        onClick={() => navigate('/login')}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg transition-all"
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white flex flex-col">
            {/* Kiosk Header */}
            <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <Shield className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight">Express Visitor Check-In</h1>
                        <p className="text-xs text-blue-400">Enterprise Security Kiosk System</p>
                    </div>
                </div>
                {token && inviteData && (
                    <div className="text-right">
                        <p className="text-xs text-slate-400">Invited by</p>
                        <p className="text-sm font-semibold text-blue-300">{inviteData.hostName}</p>
                    </div>
                )}
            </header>

            {/* Stepper Bar */}
            {step < 4 && (
                <div className="bg-slate-900/40 border-b border-slate-800 py-3 px-6">
                    <div className="max-w-2xl mx-auto flex items-center justify-between text-xs font-semibold">
                        {[
                            { num: 1, label: 'Visitor Details' },
                            { num: 2, label: 'Photo Capture' },
                            { num: 3, label: 'NDA & Safety' }
                        ].map((s) => (
                            <div key={s.num} className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all ${step === s.num
                                        ? 'bg-blue-600 text-white font-bold ring-4 ring-blue-500/30'
                                        : step > s.num
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-slate-800 text-slate-400'
                                    }`}>
                                    {step > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                                </div>
                                <span className={step === s.num ? 'text-white' : 'text-slate-400'}>{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-center">
                {/* STEP 1: Personal Details & Host Selection */}
                {step === 1 && (
                    <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
                        <div className="border-b border-slate-700 pb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <User className="w-5 h-5 text-blue-400" /> Personal Information
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">Please fill in your details for verification.</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.visitorName}
                                    onChange={e => setFormData({ ...formData, visitorName: e.target.value })}
                                    placeholder="John Doe"
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Phone Number *</label>
                                <input
                                    type="tel"
                                    required
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+91 98765 43210"
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="john@example.com"
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Company / Organization</label>
                                <input
                                    type="text"
                                    value={formData.organization}
                                    onChange={e => setFormData({ ...formData, organization: e.target.value })}
                                    placeholder="Acme Corp"
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Visitor Category</label>
                                <select
                                    value={formData.visitorType}
                                    onChange={e => setFormData({ ...formData, visitorType: e.target.value })}
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                                >
                                    <option value="guest">Guest / Business Meeting</option>
                                    <option value="contractor">Contractor / Technical Staff</option>
                                    <option value="vendor">Vendor / Supplier</option>
                                    <option value="interview">Job Applicant / Candidate</option>
                                    <option value="vip">VIP / Executive Visitor</option>
                                </select>
                            </div>

                            {formData.visitorType === 'contractor' && (
                                <div>
                                    <label className="block text-xs font-medium text-amber-400 mb-1">Work Permit / Induction #</label>
                                    <input
                                        type="text"
                                        value={formData.workPermitNumber}
                                        onChange={e => setFormData({ ...formData, workPermitNumber: e.target.value })}
                                        placeholder="WP-2026-9041"
                                        className="w-full px-4 py-2.5 bg-slate-900/90 border border-amber-500/50 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Purpose of Visit</label>
                                <input
                                    type="text"
                                    value={formData.purpose}
                                    onChange={e => setFormData({ ...formData, purpose: e.target.value })}
                                    placeholder="Quarterly Review Meeting"
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>

                        {/* Host Selection if Walk-in */}
                        {!token && (
                            <div className="pt-4 border-t border-slate-700">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Select Host Employee *</label>
                                <input
                                    type="text"
                                    value={hostSearch}
                                    onChange={e => setHostSearch(e.target.value)}
                                    placeholder="Search host by name or ID..."
                                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white mb-2"
                                />
                                <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded-xl p-1 bg-slate-900/60">
                                    {filteredHosts.slice(0, 8).map(h => (
                                        <div
                                            key={h._id || h.employeeId}
                                            onClick={() => {
                                                setFormData({ ...formData, hostEmployeeId: h._id || h.employeeId, hostEmployeeName: h.employeeName })
                                                setHostSearch(h.employeeName)
                                            }}
                                            className={`p-2 rounded-lg text-xs flex items-center justify-between cursor-pointer transition-colors ${formData.hostEmployeeName === h.employeeName
                                                    ? 'bg-blue-600 text-white font-semibold'
                                                    : 'hover:bg-slate-800 text-slate-300'
                                                }`}
                                        >
                                            <span>{h.employeeName}</span>
                                            <span className="text-[11px] opacity-75">{h.department || h.employeeId}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <button
                                disabled={!formData.visitorName || !formData.phone}
                                onClick={() => setStep(2)}
                                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
                            >
                                Next: Photo Capture <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 2: Live Web Camera Capture */}
                {step === 2 && (
                    <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
                        <div className="border-b border-slate-700 pb-4">
                            <h2 className="text-xl font-bold flex items-center justify-center gap-2">
                                <Camera className="w-5 h-5 text-blue-400" /> Visitor Biometric Photo Capture
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">Take a clear front-facing photo for facial badge printing.</p>
                        </div>

                        <div className="relative max-w-sm mx-auto aspect-video bg-slate-950 rounded-2xl overflow-hidden border border-slate-700 flex items-center justify-center shadow-inner">
                            {capturedPhoto ? (
                                <img src={capturedPhoto} alt="Captured" className="w-full h-full object-cover" />
                            ) : cameraActive ? (
                                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-slate-500 flex flex-col items-center gap-2 p-6">
                                    <Camera className="w-12 h-12 stroke-1 text-slate-600" />
                                    <p className="text-xs">Camera is ready</p>
                                </div>
                            )}
                            <canvas ref={canvasRef} className="hidden" />
                        </div>

                        <div className="flex items-center justify-center gap-3 pt-2">
                            {!capturedPhoto ? (
                                !cameraActive ? (
                                    <button
                                        onClick={startCamera}
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-md"
                                    >
                                        <Camera className="w-4 h-4" /> Turn On Camera
                                    </button>
                                ) : (
                                    <button
                                        onClick={capturePhoto}
                                        className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg ring-4 ring-emerald-500/30"
                                    >
                                        <Camera className="w-4 h-4" /> Snap Photo
                                    </button>
                                )
                            ) : (
                                <button
                                    onClick={() => {
                                        setCapturedPhoto(null)
                                        startCamera()
                                    }}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" /> Retake Photo
                                </button>
                            )}
                        </div>

                        <div className="flex items-center justify-between pt-6 border-t border-slate-700">
                            <button
                                onClick={() => setStep(1)}
                                className="px-4 py-2 text-slate-400 hover:text-white text-sm font-medium flex items-center gap-1.5"
                            >
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                            <button
                                onClick={() => setStep(3)}
                                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-blue-600/30"
                            >
                                Next: NDA & Safety <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: Digital NDA & Safety Compliance */}
                {step === 3 && (
                    <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
                        <div className="border-b border-slate-700 pb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <FileText className="w-5 h-5 text-blue-400" /> Digital NDA & Safety Sign-Off
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">Please review site safety rules and sign the visitor disclosure.</p>
                        </div>

                        {/* Safety Checklist */}
                        <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 space-y-2.5">
                            <h3 className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-2">Mandatory Safety Rules</h3>
                            {[
                                { key: 'ppe', text: 'I will wear mandated Personal Protective Equipment (Helmet/Safety Shoes) in operational zones.' },
                                { key: 'noPhoto', text: 'I understand photography or recording without written approval is strictly prohibited.' },
                                { key: 'escortRequired', text: 'I will remain escorted by host personnel in restricted production areas at all times.' },
                                { key: 'emergencyExit', text: 'In case of fire/alarm, I will follow safety marshals to designated muster assembly points.' }
                            ].map((rule) => (
                                <label key={rule.key} className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 hover:text-white">
                                    <input
                                        type="checkbox"
                                        checked={safetyAgreed[rule.key]}
                                        onChange={e => setSafetyAgreed({ ...safetyAgreed, [rule.key]: e.target.checked })}
                                        className="mt-0.5 w-4 h-4 accent-blue-600 rounded"
                                    />
                                    <span>{rule.text}</span>
                                </label>
                            ))}
                        </div>

                        {/* Digital Signature Canvas */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-medium text-slate-300">Sign Your Digital Signature Below *</label>
                                {hasSignature && (
                                    <button onClick={clearSignature} className="text-xs text-red-400 hover:underline">Clear Signature</button>
                                )}
                            </div>
                            <div className="border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-xl bg-white overflow-hidden touch-none">
                                <canvas
                                    ref={signatureCanvasRef}
                                    width={600}
                                    height={140}
                                    onMouseDown={startDrawing}
                                    onMouseMove={draw}
                                    onMouseUp={stopDrawing}
                                    onMouseLeave={stopDrawing}
                                    onTouchStart={startDrawing}
                                    onTouchMove={draw}
                                    onTouchEnd={stopDrawing}
                                    className="w-full h-32 cursor-crosshair"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                            <button
                                onClick={() => setStep(2)}
                                className="px-4 py-2 text-slate-400 hover:text-white text-sm font-medium flex items-center gap-1.5"
                            >
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                            <button
                                disabled={!allSafetyChecked || !hasSignature || loading}
                                onClick={handleSubmit}
                                className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-500/30 transition-all"
                            >
                                {loading ? 'Issuing Pass...' : 'Complete & Issue Pass'} <CheckCircle2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 4: Confirmation & Instant Digital QR Badge */}
                {step === 4 && resultPass && (
                    <div className="bg-slate-800/90 backdrop-blur-xl border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6 max-w-md mx-auto">
                        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
                            <CheckCircle2 className="w-10 h-10" />
                        </div>

                        <div>
                            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded-full border border-emerald-500/30">
                                Registration Approved
                            </span>
                            <h2 className="text-2xl font-black mt-2">{formData.visitorName}</h2>
                            <p className="text-xs text-slate-400">Host: {formData.hostEmployeeName || 'Host Assigned'}</p>
                        </div>

                        {/* Digital QR Badge Pass Card */}
                        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-700 rounded-2xl p-5 shadow-inner text-left space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                                <div>
                                    <p className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Visitor Pass ID</p>
                                    <p className="text-sm font-mono font-bold text-white">{resultPass.visitorId || 'PASS-9821'}</p>
                                </div>
                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] font-bold rounded uppercase">
                                    {formData.visitorType}
                                </span>
                            </div>

                            <div className="flex items-center justify-center p-3 bg-white rounded-xl">
                                <QrCode className="w-32 h-32 text-slate-900" />
                            </div>

                            <div className="text-center">
                                <p className="text-[11px] text-slate-400">Scan at Security Turnstile / Gate Kiosk</p>
                                <p className="text-xs font-semibold text-emerald-400 mt-0.5">Status: Valid for Today</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                            {resultPass.portalUrl && (
                                <a
                                    href={resultPass.portalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30"
                                >
                                    <Sparkles className="w-4 h-4" /> View Digital Portal
                                </a>
                            )}
                            <button
                                onClick={() => window.print()}
                                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-medium flex items-center gap-2"
                            >
                                <Printer className="w-4 h-4" /> Print Badge
                            </button>
                            <button
                                onClick={() => navigate('/visits')}
                                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
                            >
                                Return to Console
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
