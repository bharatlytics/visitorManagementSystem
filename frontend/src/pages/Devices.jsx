import { useState, useEffect } from 'react'
import { Plus, Search, Monitor, Tablet, Smartphone, Laptop, MapPin, Wifi, WifiOff, Settings, Trash2, Eye, RefreshCw, X, QrCode, Fingerprint, Printer, Clock, CheckCircle, AlertTriangle, Power, Edit } from 'lucide-react'
import api from '../api/client'

// Modal Component
function Modal({ isOpen, onClose, title, children, size = 'large' }) {
    if (!isOpen) return null

    const sizeStyles = {
        large: { width: '80vw', height: '80vh', maxWidth: '1400px' },
        medium: { width: '600px', maxHeight: '90vh' },
        small: { width: '450px', maxHeight: '80vh' }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                style={sizeStyles[size]}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-600 to-purple-700">
                    <h3 className="font-semibold text-white text-lg">{title}</h3>
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
                <Icon className="w-4 h-4 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5 break-words">{value || '—'}</p>
            </div>
        </div>
    )
}

// Device Type Icon
function DeviceIcon({ type, className = "w-5 h-5" }) {
    const icons = {
        kiosk: Monitor,
        tablet: Tablet,
        mobile: Smartphone,
        desktop: Laptop
    }
    const Icon = icons[type] || Monitor
    return <Icon className={className} />
}

export default function Devices() {
    const [devices, setDevices] = useState([])
    const [stats, setStats] = useState({ total: 0, online: 0, offline: 0, maintenance: 0 })
    const [locations, setLocations] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')

    // Modal states
    const [showRegisterModal, setShowRegisterModal] = useState(false)
    const [showDetailsModal, setShowDetailsModal] = useState(false)
    const [showActivationModal, setShowActivationModal] = useState(false)
    const [selectedDevice, setSelectedDevice] = useState(null)
    const [saving, setSaving] = useState(false)
    const [activationCode, setActivationCode] = useState('')

    // Form state
    const [form, setForm] = useState({
        deviceName: '', deviceType: 'kiosk', locationId: '', locationName: '',
        features: { faceRecognition: true, badgePrinting: false, qrScanning: true }
    })

    useEffect(() => {
        fetchData()
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchData, 30000)
        return () => clearInterval(interval)
    }, [])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)
            const [devicesRes, statsRes, locationsRes] = await Promise.allSettled([
                api.get('/devices'),
                api.get('/devices/stats'),
                api.get('/entities')
            ])

            if (devicesRes.status === 'fulfilled') {
                setDevices(devicesRes.value.data.devices || [])
            }
            if (statsRes.status === 'fulfilled') {
                setStats(statsRes.value.data.stats || { total: 0, online: 0, offline: 0, maintenance: 0 })
            }
            if (locationsRes.status === 'fulfilled') {
                setLocations(locationsRes.value.data.entities || locationsRes.value.data || [])
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load devices')
        } finally {
            setLoading(false)
        }
    }

    const handleRegister = async (e) => {
        e.preventDefault()
        if (!form.deviceName || !form.deviceType) {
            alert('Please fill required fields: Device Name, Type')
            return
        }

        setSaving(true)
        try {
            // Find location name
            const location = locations.find(l => l._id === form.locationId)

            await api.post('/devices/register', {
                ...form,
                locationName: location?.name || ''
            })
            setShowRegisterModal(false)
            resetForm()
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to register device')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (deviceId) => {
        if (!confirm('Are you sure you want to remove this device?')) return

        try {
            await api.delete(`/devices/${deviceId}`)
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete device')
        }
    }

    const handleStatusChange = async (deviceId, status) => {
        try {
            await api.patch(`/devices/${deviceId}`, { status })
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update status')
        }
    }

    const generateActivationCode = async () => {
        setSaving(true)
        try {
            const location = locations.find(l => l._id === form.locationId)
            const res = await api.post('/devices/activation-codes', {
                locationId: form.locationId,
                locationName: location?.name || '',
                expiresIn: 24
            })
            setActivationCode(res.data.code)
            setShowActivationModal(true)
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to generate code')
        } finally {
            setSaving(false)
        }
    }

    const resetForm = () => {
        setForm({
            deviceName: '', deviceType: 'kiosk', locationId: '', locationName: '',
            features: { faceRecognition: true, badgePrinting: false, qrScanning: true }
        })
    }

    const filters = [
        { id: 'all', label: 'All Devices', count: stats.total },
        { id: 'online', label: 'Online', count: stats.online },
        { id: 'offline', label: 'Offline', count: stats.offline },
        { id: 'maintenance', label: 'Maintenance', count: stats.maintenance }
    ]

    const filteredDevices = devices.filter(d => {
        const matchesSearch = !search || d.deviceName?.toLowerCase().includes(search.toLowerCase()) || d.deviceId?.includes(search.toUpperCase())
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'online' && d.isOnline && d.status !== 'maintenance') ||
            (statusFilter === 'offline' && !d.isOnline && d.status !== 'maintenance') ||
            (statusFilter === 'maintenance' && d.status === 'maintenance')
        return matchesSearch && matchesStatus
    })

    const formatDate = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Device Management</h1>
                    <p className="text-sm text-gray-500">Monitor and manage check-in devices</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={generateActivationCode}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors">
                        <QrCode className="w-4 h-4" /> Generate Code
                    </button>
                    <button onClick={() => setShowRegisterModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl text-sm font-medium shadow-lg shadow-purple-500/25 transition-all">
                        <Plus className="w-4 h-4" /> Register Device
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-purple-100 rounded-xl">
                            <Monitor className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                            <p className="text-sm text-gray-500">Total Devices</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-green-100 rounded-xl">
                            <Wifi className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-green-600">{stats.online}</p>
                            <p className="text-sm text-gray-500">Online</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-red-100 rounded-xl">
                            <WifiOff className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-red-600">{stats.offline}</p>
                            <p className="text-sm text-gray-500">Offline</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-amber-100 rounded-xl">
                            <Settings className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-amber-600">{stats.maintenance}</p>
                            <p className="text-sm text-gray-500">Maintenance</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="relative flex-1 min-w-[250px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="text" placeholder="Search by name or device ID..."
                            value={search} onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                        />
                    </div>
                    <button onClick={fetchData} className="p-2.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    {filters.map((f) => (
                        <button key={f.id} onClick={() => setStatusFilter(f.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === f.id ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}>
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

            {/* Device Grid */}
            <div className="grid grid-cols-3 gap-4">
                {loading ? (
                    <div className="col-span-3 py-16 text-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-purple-600 mx-auto"></div>
                        <p className="mt-3 text-sm text-gray-500">Loading devices...</p>
                    </div>
                ) : filteredDevices.length === 0 ? (
                    <div className="col-span-3 py-16 text-center bg-white rounded-xl border border-gray-200">
                        <Monitor className="w-12 h-12 text-gray-300 mx-auto" />
                        <p className="mt-3 text-gray-500">No devices found</p>
                        <button onClick={() => setShowRegisterModal(true)} className="mt-4 text-purple-600 hover:underline text-sm font-medium">
                            Register your first device
                        </button>
                    </div>
                ) : (
                    filteredDevices.map((device) => (
                        <div key={device._id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg transition-shadow">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`p-3 rounded-xl ${device.isOnline && device.status !== 'maintenance' ? 'bg-green-100' : device.status === 'maintenance' ? 'bg-amber-100' : 'bg-gray-100'}`}>
                                        <DeviceIcon type={device.deviceType} className={`w-6 h-6 ${device.isOnline && device.status !== 'maintenance' ? 'text-green-600' : device.status === 'maintenance' ? 'text-amber-600' : 'text-gray-400'}`} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{device.deviceName}</h3>
                                        <p className="text-xs text-gray-500 font-mono">{device.deviceId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {device.isOnline && device.status !== 'maintenance' ? (
                                        <span className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> Online
                                        </span>
                                    ) : device.status === 'maintenance' ? (
                                        <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                                            <Settings className="w-3 h-3" /> Maintenance
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span> Offline
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2 mb-4">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <MapPin className="w-4 h-4 text-gray-400" />
                                    {device.locationName || 'Unassigned'}
                                </div>
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                    Last seen: {device.lastSeen ? formatDate(device.lastSeen) : 'Never'}
                                </div>
                            </div>

                            {/* Features */}
                            <div className="flex gap-2 mb-4">
                                {device.features?.faceRecognition && (
                                    <span className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs">
                                        <Fingerprint className="w-3 h-3" /> Face
                                    </span>
                                )}
                                {device.features?.qrScanning && (
                                    <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                                        <QrCode className="w-3 h-3" /> QR
                                    </span>
                                )}
                                {device.features?.badgePrinting && (
                                    <span className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs">
                                        <Printer className="w-3 h-3" /> Badge
                                    </span>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-3 border-t border-gray-100">
                                <button onClick={() => { setSelectedDevice(device); setShowDetailsModal(true) }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                    <Eye className="w-4 h-4" /> Details
                                </button>
                                <button onClick={() => handleStatusChange(device._id, device.status === 'maintenance' ? 'active' : 'maintenance')}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                                    <Settings className="w-4 h-4" /> {device.status === 'maintenance' ? 'Activate' : 'Maint.'}
                                </button>
                                <button onClick={() => handleDelete(device._id)}
                                    className="flex items-center justify-center p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Register Modal */}
            <Modal isOpen={showRegisterModal} onClose={() => { setShowRegisterModal(false); resetForm() }} title="Register New Device" size="medium">
                <form onSubmit={handleRegister} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Device Name *</label>
                        <input type="text" value={form.deviceName} onChange={e => setForm({ ...form, deviceName: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-purple-500" placeholder="e.g., Reception Kiosk 1" required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Device Type *</label>
                        <div className="grid grid-cols-4 gap-3">
                            {['kiosk', 'tablet', 'desktop', 'mobile'].map(type => (
                                <button key={type} type="button" onClick={() => setForm({ ...form, deviceType: type })}
                                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${form.deviceType === type ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
                                        }`}>
                                    <DeviceIcon type={type} className={`w-6 h-6 ${form.deviceType === type ? 'text-purple-600' : 'text-gray-400'}`} />
                                    <span className={`text-xs font-medium capitalize ${form.deviceType === type ? 'text-purple-700' : 'text-gray-600'}`}>{type}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                        <select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                            <option value="">Select location</option>
                            {locations.map(loc => <option key={loc._id} value={loc._id}>{loc.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3">Device Features</label>
                        <div className="space-y-3">
                            {[
                                { key: 'faceRecognition', icon: Fingerprint, label: 'Face Recognition' },
                                { key: 'qrScanning', icon: QrCode, label: 'QR Code Scanning' },
                                { key: 'badgePrinting', icon: Printer, label: 'Badge Printing' }
                            ].map(({ key, icon: Icon, label }) => (
                                <label key={key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100">
                                    <input type="checkbox" checked={form.features[key]}
                                        onChange={e => setForm({ ...form, features: { ...form.features, [key]: e.target.checked } })}
                                        className="w-4 h-4 text-purple-600 rounded" />
                                    <Icon className="w-5 h-5 text-gray-500" />
                                    <span className="text-sm font-medium text-gray-700">{label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => { setShowRegisterModal(false); resetForm() }}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="flex-1 px-4 py-2.5 text-sm font-medium bg-purple-600 text-white rounded-xl shadow-lg disabled:opacity-50 hover:bg-purple-700">
                            {saving ? 'Registering...' : 'Register Device'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Details Modal */}
            <Modal isOpen={showDetailsModal} onClose={() => setShowDetailsModal(false)} title="Device Details">
                {selectedDevice && (
                    <div className="grid grid-cols-3 gap-6">
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Device Info</h4>
                            <InfoField icon={Monitor} label="Device Name" value={selectedDevice.deviceName} />
                            <InfoField icon={QrCode} label="Device ID" value={selectedDevice.deviceId} />
                            <InfoField icon={Laptop} label="Device Type" value={selectedDevice.deviceType} />
                            <InfoField icon={Power} label="Status" value={selectedDevice.isOnline ? 'Online' : 'Offline'} />
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Location & Network</h4>
                            <InfoField icon={MapPin} label="Location" value={selectedDevice.locationName} />
                            <InfoField icon={Wifi} label="IP Address" value={selectedDevice.ipAddress} />
                            <InfoField icon={Clock} label="Last Seen" value={formatDate(selectedDevice.lastSeen)} />
                            <InfoField icon={Clock} label="Registered" value={formatDate(selectedDevice.registeredAt)} />
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Software</h4>
                            <InfoField icon={Settings} label="App Version" value={selectedDevice.appVersion} />
                            <InfoField icon={Laptop} label="OS Version" value={selectedDevice.osVersion} />
                            <div className="p-4 bg-purple-50 rounded-xl">
                                <h5 className="text-xs font-semibold text-purple-800 uppercase mb-2">Features</h5>
                                <div className="flex flex-wrap gap-2">
                                    {selectedDevice.features?.faceRecognition && <span className="px-2 py-1 bg-white text-purple-700 rounded text-xs">Face Recognition</span>}
                                    {selectedDevice.features?.qrScanning && <span className="px-2 py-1 bg-white text-purple-700 rounded text-xs">QR Scanning</span>}
                                    {selectedDevice.features?.badgePrinting && <span className="px-2 py-1 bg-white text-purple-700 rounded text-xs">Badge Printing</span>}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Activation Code Modal */}
            <Modal isOpen={showActivationModal} onClose={() => { setShowActivationModal(false); setActivationCode('') }} title="Device Activation Code" size="small">
                <div className="text-center py-6">
                    <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <QrCode className="w-10 h-10 text-purple-600" />
                    </div>
                    <p className="text-sm text-gray-500 mb-4">Enter this code on your device to activate:</p>
                    <div className="bg-gray-100 rounded-2xl p-6 mb-4">
                        <p className="text-3xl font-mono font-bold text-gray-900 tracking-widest">{activationCode}</p>
                    </div>
                    <p className="text-xs text-gray-400">This code expires in 24 hours</p>
                </div>
            </Modal>
        </div>
    )
}
