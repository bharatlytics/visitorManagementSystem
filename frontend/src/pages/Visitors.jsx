import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Search, UserCheck, UserX, Eye, Edit, Ban, CheckCircle, X, User, Phone, Mail, Building, Briefcase, Hash, Calendar, MapPin, FileText, Shield, Camera, ChevronLeft, ChevronRight, RotateCcw, Video, VideoOff } from 'lucide-react'
import api from '../api/client'

// Enterprise Modal Component - 80% viewport
function Modal({ isOpen, onClose, title, children, subtitle }) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                style={{ width: '80vw', height: '80vh', maxWidth: '1400px' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700">
                    <div>
                        <h3 className="font-semibold text-white text-lg">{title}</h3>
                        {subtitle && <p className="text-blue-100 text-sm">{subtitle}</p>}
                    </div>
                    <button onClick={onClose} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">{children}</div>
            </div>
        </div>
    )
}

// Info Field Component
function InfoField({ icon: Icon, label, value, className = '' }) {
    return (
        <div className={`flex items-start gap-3 p-3 bg-gray-50 rounded-lg ${className}`}>
            <div className="p-2 bg-white rounded-lg shadow-sm">
                <Icon className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5 break-words">{value || '—'}</p>
            </div>
        </div>
    )
}

// Step Indicator Component
function StepIndicator({ currentStep, steps }) {
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((step, idx) => (
                <div key={idx} className="flex items-center">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-all ${idx + 1 < currentStep ? 'bg-green-500 text-white' :
                            idx + 1 === currentStep ? 'bg-blue-600 text-white shadow-lg scale-110' :
                                'bg-gray-200 text-gray-500'
                        }`}>
                        {idx + 1 < currentStep ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    {idx < steps.length - 1 && (
                        <div className={`w-16 h-1 mx-2 rounded ${idx + 1 < currentStep ? 'bg-green-500' : 'bg-gray-200'}`} />
                    )}
                </div>
            ))}
        </div>
    )
}

// Face Capture Component with Webcam
function FaceCapture({ capturedImages, onCapture, onRetake }) {
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const [stream, setStream] = useState(null)
    const [cameraError, setCameraError] = useState(null)
    const [currentAngle, setCurrentAngle] = useState('center')

    const angles = [
        { id: 'center', label: 'Look Straight', icon: '👤', instruction: 'Face the camera directly' },
        { id: 'left', label: 'Turn Left', icon: '👈', instruction: 'Turn your head slightly to the left' },
        { id: 'right', label: 'Turn Right', icon: '👉', instruction: 'Turn your head slightly to the right' }
    ]

    const startCamera = useCallback(async () => {
        try {
            setCameraError(null)
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            })
            setStream(mediaStream)
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream
            }
        } catch (err) {
            console.error('Camera error:', err)
            setCameraError(err.message || 'Unable to access camera')
        }
    }, [])

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop())
            setStream(null)
        }
    }, [stream])

    useEffect(() => {
        startCamera()
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
        }
    }, [])

    const captureImage = () => {
        if (!videoRef.current || !canvasRef.current) return

        const video = videoRef.current
        const canvas = canvasRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)

        const imageData = canvas.toDataURL('image/jpeg', 0.9)
        onCapture(currentAngle, imageData)

        // Auto-advance to next angle
        const currentIdx = angles.findIndex(a => a.id === currentAngle)
        if (currentIdx < angles.length - 1) {
            setCurrentAngle(angles[currentIdx + 1].id)
        }
    }

    const currentAngleData = angles.find(a => a.id === currentAngle)
    const capturedCount = Object.keys(capturedImages).filter(k => capturedImages[k]).length

    return (
        <div className="h-full flex flex-col">
            {/* Angle selector tabs */}
            <div className="flex gap-2 mb-4">
                {angles.map((angle) => (
                    <button
                        key={angle.id}
                        onClick={() => setCurrentAngle(angle.id)}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${currentAngle === angle.id
                                ? 'bg-blue-600 text-white shadow-lg'
                                : capturedImages[angle.id]
                                    ? 'bg-green-100 text-green-700 border-2 border-green-300'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        <span className="text-lg">{angle.icon}</span>
                        <span>{angle.label}</span>
                        {capturedImages[angle.id] && <CheckCircle className="w-4 h-4" />}
                    </button>
                ))}
            </div>

            <div className="flex-1 grid grid-cols-2 gap-6">
                {/* Camera View */}
                <div className="flex flex-col">
                    <div className="relative bg-black rounded-2xl overflow-hidden aspect-[4/3]">
                        {cameraError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-gray-900">
                                <VideoOff className="w-12 h-12 mb-4 text-red-400" />
                                <p className="text-red-400 font-medium">Camera Error</p>
                                <p className="text-sm text-gray-400 mt-2">{cameraError}</p>
                                <button onClick={startCamera} className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-sm">
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <>
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover"
                                />
                                {/* Face guide overlay */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-48 h-60 border-4 border-white/50 rounded-[40%] shadow-lg" />
                                </div>
                                {/* Instruction banner */}
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                                    <p className="text-white text-center font-medium">{currentAngleData?.instruction}</p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Capture button */}
                    <div className="flex justify-center mt-4">
                        <button
                            onClick={captureImage}
                            disabled={cameraError || capturedImages[currentAngle]}
                            className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold shadow-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <Camera className="w-5 h-5" />
                            {capturedImages[currentAngle] ? 'Already Captured' : `Capture ${currentAngleData?.label}`}
                        </button>
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Preview thumbnails */}
                <div className="flex flex-col">
                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
                        Captured Images ({capturedCount}/3)
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                        {angles.map((angle) => (
                            <div key={angle.id} className="flex flex-col">
                                <div className={`aspect-[3/4] rounded-xl overflow-hidden border-2 ${capturedImages[angle.id] ? 'border-green-400' : 'border-dashed border-gray-300'
                                    } bg-gray-100 flex items-center justify-center relative`}>
                                    {capturedImages[angle.id] ? (
                                        <>
                                            <img src={capturedImages[angle.id]} alt={angle.label} className="w-full h-full object-cover" />
                                            <button
                                                onClick={() => onRetake(angle.id)}
                                                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 shadow"
                                            >
                                                <RotateCcw className="w-3 h-3" />
                                            </button>
                                        </>
                                    ) : (
                                        <div className="text-center text-gray-400">
                                            <span className="text-3xl">{angle.icon}</span>
                                            <p className="text-xs mt-2">Not captured</p>
                                        </div>
                                    )}
                                </div>
                                <p className="text-xs text-center mt-2 font-medium text-gray-600">{angle.label}</p>
                            </div>
                        ))}
                    </div>

                    {capturedCount === 3 && (
                        <div className="mt-6 p-4 bg-green-50 rounded-xl border border-green-200">
                            <div className="flex items-center gap-3">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                                <div>
                                    <p className="font-semibold text-green-800">All photos captured!</p>
                                    <p className="text-sm text-green-600">Click "Next" to review and submit</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function Visitors() {
    const [visitors, setVisitors] = useState([])
    const [hosts, setHosts] = useState([])
    const [entities, setEntities] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [search, setSearch] = useState('')

    // Filters
    const [selectedEntity, setSelectedEntity] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')

    // Modal states
    const [showRegisterModal, setShowRegisterModal] = useState(false)
    const [showViewModal, setShowViewModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [selectedVisitor, setSelectedVisitor] = useState(null)
    const [saving, setSaving] = useState(false)

    // Multi-step registration
    const [registrationStep, setRegistrationStep] = useState(1)
    const [capturedImages, setCapturedImages] = useState({ center: null, left: null, right: null })

    // Form state
    const [form, setForm] = useState({
        visitorName: '', phone: '', email: '', organization: '',
        hostEmployeeId: '', visitorType: 'guest', idType: '', idNumber: '',
        purpose: '', locationId: '', address: '', emergencyContact: '', notes: ''
    })

    const steps = ['Basic Info', 'Face Capture', 'Review']

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)
            const [visitorsRes, hostsRes, entitiesRes] = await Promise.allSettled([
                api.get('/visitors'),
                api.get('/employees'),
                api.get('/entities')
            ])

            setVisitors(visitorsRes.status === 'fulfilled' ? (visitorsRes.value.data.visitors || []) : [])

            if (hostsRes.status === 'fulfilled') {
                const data = hostsRes.value.data
                const employees = Array.isArray(data) ? data : (data.employees || data || [])
                setHosts(employees)
            } else {
                setHosts([])
            }

            setEntities(entitiesRes.status === 'fulfilled' ? (entitiesRes.value.data.entities || entitiesRes.value.data || []) : [])
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load data')
        } finally {
            setLoading(false)
        }
    }

    const handleRegister = async () => {
        if (!form.visitorName || !form.phone || !form.hostEmployeeId) {
            alert('Please fill required fields: Name, Phone, Host')
            return
        }

        setSaving(true)
        try {
            const formData = new FormData()
            Object.entries(form).forEach(([key, value]) => {
                if (value) formData.append(key, key === 'phone' && !value.startsWith('+91') ? '+91' + value : value)
            })

            // Add captured face images as base64
            if (capturedImages.center) {
                formData.append('faceCenter', capturedImages.center)
            }
            if (capturedImages.left) {
                formData.append('faceLeft', capturedImages.left)
            }
            if (capturedImages.right) {
                formData.append('faceRight', capturedImages.right)
            }

            await api.post('/visitors/register', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
            closeRegisterModal()
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to register visitor')
        } finally {
            setSaving(false)
        }
    }

    const handleUpdate = async (e) => {
        e.preventDefault()
        if (!selectedVisitor) return

        setSaving(true)
        try {
            const formData = new FormData()
            formData.append('visitorId', selectedVisitor._id)
            formData.append('visitorName', form.visitorName)
            formData.append('phone', form.phone)
            formData.append('email', form.email)
            formData.append('organization', form.organization)

            await api.patch('/visitors/update', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
            setShowEditModal(false)
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update visitor')
        } finally {
            setSaving(false)
        }
    }

    const handleBlacklist = async (visitorId, blacklist) => {
        const reason = blacklist ? prompt('Enter reason for blacklisting:') : null
        if (blacklist && reason === null) return

        try {
            await api.post(blacklist ? '/visitors/blacklist' : '/visitors/unblacklist', { visitorId, reason })
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update status')
        }
    }

    const openViewModal = (visitor) => { setSelectedVisitor(visitor); setShowViewModal(true) }

    const openEditModal = (visitor) => {
        setSelectedVisitor(visitor)
        setForm({
            visitorName: visitor.visitorName || '', phone: visitor.phone || '',
            email: visitor.email || '', organization: visitor.organization || '',
            hostEmployeeId: '', visitorType: 'guest', idType: '', idNumber: '', purpose: '', locationId: '', address: '', emergencyContact: '', notes: ''
        })
        setShowEditModal(true)
    }

    const openRegisterModal = () => {
        resetForm()
        setRegistrationStep(1)
        setCapturedImages({ center: null, left: null, right: null })
        setShowRegisterModal(true)
    }

    const closeRegisterModal = () => {
        setShowRegisterModal(false)
        setRegistrationStep(1)
        setCapturedImages({ center: null, left: null, right: null })
        resetForm()
    }

    const resetForm = () => {
        setForm({ visitorName: '', phone: '', email: '', organization: '', hostEmployeeId: '', visitorType: 'guest', idType: '', idNumber: '', purpose: '', locationId: '', address: '', emergencyContact: '', notes: '' })
    }

    const handleImageCapture = (angle, imageData) => {
        setCapturedImages(prev => ({ ...prev, [angle]: imageData }))
    }

    const handleImageRetake = (angle) => {
        setCapturedImages(prev => ({ ...prev, [angle]: null }))
    }

    const canProceedToStep2 = form.visitorName && form.phone && form.hostEmployeeId
    const canProceedToStep3 = capturedImages.center && capturedImages.left && capturedImages.right

    const getVisitorImage = (visitor) => {
        const images = visitor.visitorImages || visitor.faceImages || {}
        return images.center ? `/api/visitors/images/${images.center}` : null
    }

    const getHostName = (h) => h.employeeName || h.name || h.attributes?.name || 'Unknown'
    const getHostDept = (h) => h.department || h.attributes?.department || 'N/A'

    const filters = [
        { id: 'all', label: 'All', count: visitors.length },
        { id: 'active', label: 'Active', count: visitors.filter(v => !v.blacklisted).length },
        { id: 'blacklisted', label: 'Blacklisted', count: visitors.filter(v => v.blacklisted).length }
    ]

    const filteredVisitors = visitors.filter(v => {
        const matchesSearch = !search || v.visitorName?.toLowerCase().includes(search.toLowerCase()) || v.phone?.includes(search) || v.email?.toLowerCase().includes(search.toLowerCase())
        const matchesEntity = !selectedEntity || v.locationId === selectedEntity
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && !v.blacklisted) || (statusFilter === 'blacklisted' && v.blacklisted)
        return matchesSearch && matchesEntity && matchesStatus
    })

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Visitor Management</h1>
                    <p className="text-sm text-gray-500">{visitors.length} total visitors registered</p>
                </div>
                <button
                    onClick={openRegisterModal}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl text-sm font-medium shadow-lg shadow-blue-500/25 transition-all"
                >
                    <Plus className="w-4 h-4" /> Register Visitor
                </button>
            </div>

            {/* Filters Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="relative flex-1 min-w-[250px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, phone or email..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)}
                        className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white min-w-[160px]">
                        <option value="">All Locations</option>
                        {entities.map(e => (
                            <option key={e._id} value={e._id}>{e.name || 'Unnamed'}</option>
                        ))}
                    </select>
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    {filters.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setStatusFilter(f.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === f.id
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                        >
                            {f.label}
                            <span className={`px-1.5 py-0.5 rounded-full text-xs ${statusFilter === f.id ? 'bg-white/20' : 'bg-gray-200'}`}>{f.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
                    {error} <button onClick={fetchData} className="underline ml-2 font-medium">Retry</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Visitor</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Organization</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan={6} className="px-5 py-16 text-center">
                                <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-blue-600 mx-auto"></div>
                                <p className="mt-3 text-sm text-gray-500">Loading visitors...</p>
                            </td></tr>
                        ) : filteredVisitors.length === 0 ? (
                            <tr><td colSpan={6} className="px-5 py-16 text-center">
                                <User className="w-12 h-12 text-gray-300 mx-auto" />
                                <p className="mt-3 text-sm text-gray-400">No visitors found</p>
                            </td></tr>
                        ) : (
                            filteredVisitors.map((visitor) => (
                                <tr key={visitor._id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-md overflow-hidden">
                                                {getVisitorImage(visitor) ? <img src={getVisitorImage(visitor)} alt="" className="w-full h-full object-cover" />
                                                    : <span className="text-white font-medium">{visitor.visitorName?.charAt(0)?.toUpperCase()}</span>}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900">{visitor.visitorName}</p>
                                                <p className="text-xs text-gray-500">{visitor.idType ? `${visitor.idType}: ${visitor.idNumber}` : 'No ID'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <p className="text-sm text-gray-900">{visitor.phone}</p>
                                        <p className="text-xs text-gray-500">{visitor.email || '—'}</p>
                                    </td>
                                    <td className="px-5 py-4 text-sm text-gray-600">{visitor.organization || '—'}</td>
                                    <td className="px-5 py-4">
                                        <span className="px-2.5 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">{visitor.visitorType || 'guest'}</span>
                                    </td>
                                    <td className="px-5 py-4">
                                        {visitor.blacklisted ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                                                <UserX className="w-3 h-3" /> Blacklisted
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                                                <UserCheck className="w-3 h-3" /> Active
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={() => openViewModal(visitor)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View Details">
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => openEditModal(visitor)} className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Edit">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleBlacklist(visitor._id, !visitor.blacklisted)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title={visitor.blacklisted ? 'Remove Blacklist' : 'Blacklist'}>
                                                <Ban className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Multi-Step Register Modal */}
            <Modal
                isOpen={showRegisterModal}
                onClose={closeRegisterModal}
                title="Register New Visitor"
                subtitle={`Step ${registrationStep} of 3: ${steps[registrationStep - 1]}`}
            >
                <div className="h-full flex flex-col">
                    <StepIndicator currentStep={registrationStep} steps={steps} />

                    <div className="flex-1">
                        {/* Step 1: Basic Info */}
                        {registrationStep === 1 && (
                            <div className="grid grid-cols-3 gap-6">
                                <div className="space-y-5">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Personal Information</h4>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                                        <input type="text" value={form.visitorName} onChange={e => setForm({ ...form, visitorName: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" placeholder="Enter full name" required />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
                                        <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="10-digit mobile" required />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                                        <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="visitor@example.com" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Organization</label>
                                        <input type="text" value={form.organization} onChange={e => setForm({ ...form, organization: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="Company name" />
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Visit Details</h4>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Host Employee *</label>
                                        <select value={form.hostEmployeeId} onChange={e => setForm({ ...form, hostEmployeeId: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" required>
                                            <option value="">Select host employee</option>
                                            {hosts.map(h => <option key={h._id} value={h._id}>{getHostName(h)} • {getHostDept(h)}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Visitor Type</label>
                                        <select value={form.visitorType} onChange={e => setForm({ ...form, visitorType: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                                            <option value="guest">Guest</option>
                                            <option value="meeting">Meeting</option>
                                            <option value="interview">Interview</option>
                                            <option value="delivery">Delivery</option>
                                            <option value="contractor">Contractor</option>
                                            <option value="vip">VIP</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Purpose</label>
                                        <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="Meeting, delivery, etc." />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                                        <select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                                            <option value="">Select location</option>
                                            {entities.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">ID & Security</h4>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">ID Type</label>
                                        <select value={form.idType} onChange={e => setForm({ ...form, idType: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                                            <option value="">Select ID type</option>
                                            <option value="aadhar">Aadhar Card</option>
                                            <option value="pan">PAN Card</option>
                                            <option value="driving_license">Driving License</option>
                                            <option value="passport">Passport</option>
                                            <option value="voter_id">Voter ID</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">ID Number</label>
                                        <input type="text" value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="Document number" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                                        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none" rows={3} placeholder="Any special notes..." />
                                    </div>
                                    <div className="p-4 bg-blue-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-blue-800 uppercase">Next Step</h5>
                                        <p className="text-sm text-blue-700 mt-1">After filling this info, you'll capture 3 face photos</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Face Capture */}
                        {registrationStep === 2 && (
                            <FaceCapture
                                capturedImages={capturedImages}
                                onCapture={handleImageCapture}
                                onRetake={handleImageRetake}
                            />
                        )}

                        {/* Step 3: Review */}
                        {registrationStep === 3 && (
                            <div className="grid grid-cols-3 gap-6">
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Personal Info</h4>
                                    <InfoField icon={User} label="Full Name" value={form.visitorName} />
                                    <InfoField icon={Phone} label="Phone" value={form.phone} />
                                    <InfoField icon={Mail} label="Email" value={form.email} />
                                    <InfoField icon={Building} label="Organization" value={form.organization} />
                                </div>
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Visit Details</h4>
                                    <InfoField icon={User} label="Host" value={hosts.find(h => h._id === form.hostEmployeeId)?.employeeName || form.hostEmployeeId} />
                                    <InfoField icon={Briefcase} label="Type" value={form.visitorType} />
                                    <InfoField icon={FileText} label="Purpose" value={form.purpose} />
                                    <InfoField icon={Hash} label="ID" value={form.idType ? `${form.idType}: ${form.idNumber}` : '—'} />
                                </div>
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Captured Photos</h4>
                                    <div className="grid grid-cols-3 gap-3">
                                        {['center', 'left', 'right'].map(angle => (
                                            <div key={angle} className="aspect-[3/4] rounded-xl overflow-hidden border-2 border-green-400">
                                                {capturedImages[angle] && <img src={capturedImages[angle]} alt={angle} className="w-full h-full object-cover" />}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-4 bg-green-50 rounded-xl border border-green-200">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                            <p className="font-medium text-green-800">Ready to register!</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-200">
                        <div>
                            {registrationStep > 1 && (
                                <button onClick={() => setRegistrationStep(registrationStep - 1)}
                                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl">
                                    <ChevronLeft className="w-4 h-4" /> Previous
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={closeRegisterModal}
                                className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl">Cancel</button>
                            {registrationStep < 3 ? (
                                <button
                                    onClick={() => setRegistrationStep(registrationStep + 1)}
                                    disabled={registrationStep === 1 ? !canProceedToStep2 : !canProceedToStep3}
                                    className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
                                >
                                    Next <ChevronRight className="w-4 h-4" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleRegister}
                                    disabled={saving}
                                    className="flex items-center gap-2 px-8 py-2.5 text-sm font-medium bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl shadow-lg disabled:opacity-50 hover:from-green-700 hover:to-green-800"
                                >
                                    {saving ? 'Registering...' : 'Complete Registration'}
                                    <CheckCircle className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* View Modal */}
            <Modal isOpen={showViewModal} onClose={() => setShowViewModal(false)} title="Visitor Profile">
                {selectedVisitor && (
                    <div className="h-full flex flex-col">
                        <div className="flex items-start gap-6 pb-6 border-b border-gray-200">
                            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg overflow-hidden">
                                {getVisitorImage(selectedVisitor) ? <img src={getVisitorImage(selectedVisitor)} alt="" className="w-full h-full object-cover" />
                                    : <span className="text-3xl font-bold text-white">{selectedVisitor.visitorName?.charAt(0)}</span>}
                            </div>
                            <div className="flex-1">
                                <h2 className="text-2xl font-bold text-gray-900">{selectedVisitor.visitorName}</h2>
                                <p className="text-sm text-gray-500 mt-1">{selectedVisitor.organization || 'Individual Visitor'}</p>
                                <div className="flex items-center gap-4 mt-3">
                                    {selectedVisitor.blacklisted ? (
                                        <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold bg-red-100 text-red-700 rounded-full"><UserX className="w-4 h-4" /> Blacklisted</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold bg-green-100 text-green-700 rounded-full"><UserCheck className="w-4 h-4" /> Active</span>
                                    )}
                                    <span className="px-3 py-1.5 text-sm font-medium bg-blue-100 text-blue-700 rounded-full">{selectedVisitor.visitorType || 'guest'}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-gray-400">Visitor ID</p>
                                <p className="text-sm font-mono text-gray-600">{selectedVisitor._id?.slice(-12)}</p>
                                <p className="text-xs text-gray-400 mt-2">Registered</p>
                                <p className="text-sm text-gray-600">{formatDate(selectedVisitor.createdAt)}</p>
                            </div>
                        </div>

                        <div className="flex-1 grid grid-cols-3 gap-6 py-6">
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Contact Information</h4>
                                <InfoField icon={Phone} label="Phone Number" value={selectedVisitor.phone} />
                                <InfoField icon={Mail} label="Email Address" value={selectedVisitor.email} />
                                <InfoField icon={MapPin} label="Address" value={selectedVisitor.address} />
                                <InfoField icon={Phone} label="Emergency Contact" value={selectedVisitor.emergencyContact} />
                            </div>
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Identification</h4>
                                <InfoField icon={FileText} label="ID Type" value={selectedVisitor.idType?.replace('_', ' ')?.toUpperCase()} />
                                <InfoField icon={Hash} label="ID Number" value={selectedVisitor.idNumber} />
                                <InfoField icon={Building} label="Organization" value={selectedVisitor.organization} />
                                <InfoField icon={Briefcase} label="Visitor Type" value={selectedVisitor.visitorType} />
                            </div>
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Visit History</h4>
                                <InfoField icon={Calendar} label="Total Visits" value={selectedVisitor.visitCount || '0'} />
                                <InfoField icon={Calendar} label="Last Visit" value={formatDate(selectedVisitor.lastVisit)} />
                                {selectedVisitor.blacklisted && selectedVisitor.blacklistReason && (
                                    <div className="p-4 bg-red-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-red-800 uppercase">Blacklist Reason</h5>
                                        <p className="text-sm text-red-700 mt-1">{selectedVisitor.blacklistReason}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                            <button onClick={() => { openEditModal(selectedVisitor); setShowViewModal(false) }}
                                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">
                                <Edit className="w-4 h-4" /> Edit Profile
                            </button>
                            <div className="flex gap-3">
                                {selectedVisitor.blacklisted ? (
                                    <button onClick={() => { handleBlacklist(selectedVisitor._id, false); setShowViewModal(false) }}
                                        className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-green-600 text-white rounded-xl hover:bg-green-700">
                                        <CheckCircle className="w-4 h-4" /> Remove from Blacklist
                                    </button>
                                ) : (
                                    <button onClick={() => { handleBlacklist(selectedVisitor._id, true); setShowViewModal(false) }}
                                        className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-red-600 text-white rounded-xl hover:bg-red-700">
                                        <Ban className="w-4 h-4" /> Add to Blacklist
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Edit Modal */}
            <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Visitor Profile">
                <form onSubmit={handleUpdate} className="h-full flex flex-col">
                    <div className="flex-1 grid grid-cols-2 gap-6">
                        <div className="space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Basic Information</h4>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                                <input type="text" value={form.visitorName} onChange={e => setForm({ ...form, visitorName: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" />
                            </div>
                        </div>
                        <div className="space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Additional Details</h4>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Organization</label>
                                <input type="text" value={form.organization} onChange={e => setForm({ ...form, organization: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" />
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-gray-200">
                        <button type="button" onClick={() => setShowEditModal(false)} className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl">Cancel</button>
                        <button type="submit" disabled={saving} className="px-8 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl shadow-lg disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}
