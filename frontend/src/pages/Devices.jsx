import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Search, Monitor, Tablet, Smartphone, Laptop, MapPin, Wifi, WifiOff, Settings, Trash2, Eye, RefreshCw, X, QrCode, Clock, CheckCircle, AlertTriangle, Power, Edit, RotateCcw, Lock, Unlock, Camera, Download, Send, ChevronDown, ChevronRight, Copy, ExternalLink, Wrench, History } from 'lucide-react'
import api from '../api/client'

// ─── Helpers ──────────────────────────────────────────────────────

function Modal({ isOpen, onClose, title, children, size = 'large' }) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className={`bg-white rounded-xl shadow-2xl ${size === 'small' ? 'max-w-md' : size === 'medium' ? 'max-w-lg' : 'max-w-2xl'} w-full max-h-[90vh] overflow-hidden`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="overflow-y-auto max-h-[calc(90vh-64px)]">
                    {children}
                </div>
            </div>
        </div>
    )
}

function DeviceIcon({ type, className = "w-5 h-5" }) {
    switch (type) {
        case 'tablet': return <Tablet className={className} />
        case 'phone': return <Smartphone className={className} />
        case 'laptop': return <Laptop className={className} />
        default: return <Monitor className={className} />
    }
}

function StatusBadge({ status, lastSeen }) {
    const isOnline = lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000

    if (status === 'maintenance') {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700"><Wrench className="w-3 h-3" /> Maintenance</span>
    }
    if (status === 'inactive' || status === 'pending_activation') {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600"><WifiOff className="w-3 h-3" /> {status === 'pending_activation' ? 'Pending' : 'Inactive'}</span>
    }
    if (isOnline) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700"><Wifi className="w-3 h-3" /> Online</span>
    }
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-600"><WifiOff className="w-3 h-3" /> Offline</span>
}

function CommandBadge({ status }) {
    const colors = {
        pending: 'bg-yellow-50 text-yellow-700',
        completed: 'bg-green-50 text-green-700',
        failed: 'bg-red-50 text-red-600'
    }
    return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
}

// ─── Main Component ──────────────────────────────────────────────

export default function Devices() {
    const [devices, setDevices] = useState([])
    const [stats, setStats] = useState({ total: 0, online: 0, offline: 0, maintenance: 0 })
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')

    // Modals
    const [showRegister, setShowRegister] = useState(false)
    const [showQR, setShowQR] = useState(false)
    const [selectedDevice, setSelectedDevice] = useState(null)
    const [showDetail, setShowDetail] = useState(false)
    const [showCommandHistory, setShowCommandHistory] = useState(false)
    const [showEdit, setShowEdit] = useState(false)

    // Edit form
    const [editForm, setEditForm] = useState({ deviceName: '', deviceType: 'kiosk', location: '', capabilities: '' })

    // Register form
    const [registerForm, setRegisterForm] = useState({ deviceName: '', deviceType: 'kiosk', location: '' })

    // QR
    const [qrData, setQrData] = useState(null)
    const [qrLoading, setQrLoading] = useState(false)

    // Commands
    const [commandHistory, setCommandHistory] = useState([])
    const [sendingCommand, setSendingCommand] = useState(null)

    const companyId = localStorage.getItem('vms_company_id')

    // ─── Data Fetching ────────────────────────────────────────────

    const fetchData = useCallback(async () => {
        if (!companyId) {
            setLoading(false)
            return
        }
        try {
            setLoading(true)
            const [devRes, statRes] = await Promise.all([
                api.get('/devices'),
                api.get('/devices/stats')
            ])
            setDevices(devRes.data.devices || [])
            const s = statRes.data.stats || {}
            setStats({
                total: s.total || 0,
                online: s.online || 0,
                offline: s.offline || 0,
                maintenance: (devRes.data.devices || []).filter(d => d.status === 'maintenance').length
            })
        } catch (err) {
            console.error('Error fetching devices:', err)
        } finally {
            setLoading(false)
        }
    }, [companyId])

    useEffect(() => { fetchData() }, [fetchData])

    // ─── Register Device ──────────────────────────────────────────

    const handleRegister = async (e) => {
        e.preventDefault()
        try {
            await api.post('/devices/register', { ...registerForm })
            setShowRegister(false)
            setRegisterForm({ deviceName: '', deviceType: 'kiosk', location: '' })
            fetchData()
        } catch (err) {
            alert('Error registering device: ' + (err.response?.data?.error || err.message))
        }
    }

    // ─── QR Code ──────────────────────────────────────────────────

    const generateQR = async () => {
        try {
            setQrLoading(true)
            const res = await api.post('/devices/qr-code', {
                deviceType: 'kiosk',
                expiresInHours: 24
            })
            setQrData(res.data)
            setShowQR(true)
        } catch (err) {
            alert('Error generating QR code: ' + (err.response?.data?.error || err.message))
        } finally {
            setQrLoading(false)
        }
    }

    const copyQRCode = () => {
        if (qrData?.code) {
            navigator.clipboard.writeText(qrData.code)
        }
    }

    // ─── Remote Commands ──────────────────────────────────────────

    const sendCommand = async (deviceId, command, params = {}) => {
        try {
            setSendingCommand(command)
            await api.post(`/devices/${deviceId}/command`, { command, params })
            fetchData()
        } catch (err) {
            alert('Error sending command: ' + (err.response?.data?.error || err.message))
        } finally {
            setSendingCommand(null)
        }
    }

    const loadCommandHistory = async (deviceId) => {
        try {
            const res = await api.get(`/devices/${deviceId}/command-history?limit=20`)
            setCommandHistory(res.data.commands || [])
        } catch (err) {
            console.error('Error loading command history:', err)
            setCommandHistory([])
        }
    }

    // ─── Delete / Status ──────────────────────────────────────────

    const handleDelete = async (deviceId) => {
        if (!confirm('Are you sure you want to deactivate this device?')) return
        try {
            await api.delete(`/devices/${deviceId}`)
            fetchData()
            if (showDetail) setShowDetail(false)
        } catch (err) {
            alert('Error: ' + (err.response?.data?.error || err.message))
        }
    }

    // ─── Edit Device ──────────────────────────────────────────────

    const openEditModal = (device) => {
        setEditForm({
            deviceName: device.deviceName || '',
            deviceType: device.deviceType || 'kiosk',
            location: device.location || '',
            capabilities: (device.capabilities || []).join(', '),
        })
        setSelectedDevice(device)
        setShowEdit(true)
    }

    const handleEditSave = async (e) => {
        e.preventDefault()
        try {
            const payload = {
                deviceName: editForm.deviceName,
                deviceType: editForm.deviceType,
                location: editForm.location,
                capabilities: editForm.capabilities
                    .split(',')
                    .map(c => c.trim())
                    .filter(Boolean),
            }
            await api.patch(`/devices/${selectedDevice._id}`, payload)
            setShowEdit(false)
            setShowDetail(false)
            fetchData()
        } catch (err) {
            alert('Error updating device: ' + (err.response?.data?.error || err.message))
        }
    }

    // ─── Filtered Devices ─────────────────────────────────────────

    const filteredDevices = useMemo(() => {
        let result = devices
        if (filter === 'online') {
            result = result.filter(d => d.lastSeen && (Date.now() - new Date(d.lastSeen).getTime()) < 5 * 60 * 1000)
        } else if (filter === 'offline') {
            result = result.filter(d => d.status === 'active' && (!d.lastSeen || (Date.now() - new Date(d.lastSeen).getTime()) >= 5 * 60 * 1000))
        } else if (filter === 'maintenance') {
            result = result.filter(d => d.status === 'maintenance')
        }
        if (search) {
            const q = search.toLowerCase()
            result = result.filter(d =>
                d.deviceName?.toLowerCase().includes(q) ||
                d.deviceId?.toLowerCase().includes(q) ||
                d.location?.toLowerCase().includes(q)
            )
        }
        return result
    }, [devices, filter, search])

    const formatDate = (d) => d ? new Date(d).toLocaleString() : 'Never'
    const timeAgo = (d) => {
        if (!d) return 'Never'
        const diff = Date.now() - new Date(d).getTime()
        if (diff < 60000) return 'Just now'
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
        return `${Math.floor(diff / 86400000)}d ago`
    }

    // ─── Render ──────────────────────────────────────────────────

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Device Management</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Monitor and manage check-in devices</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={generateQR} disabled={qrLoading}
                        className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                        <QrCode className="w-4 h-4" />
                        Generate Code
                    </button>
                    <button onClick={() => setShowRegister(true)}
                        className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                        <Plus className="w-4 h-4" />
                        Register Device
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: 'Total Devices', value: stats.total, icon: Monitor, color: 'blue' },
                    { label: 'Online', value: stats.online, icon: Wifi, color: 'green' },
                    { label: 'Offline', value: stats.offline, icon: WifiOff, color: 'red' },
                    { label: 'Maintenance', value: stats.maintenance, icon: Wrench, color: 'amber' }
                ].map(stat => (
                    <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${stat.color}-50`}>
                            <stat.icon className={`w-5 h-5 text-${stat.color}-600`} />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                            <p className="text-xs text-gray-500">{stat.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search + Filters */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by name or device ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                </div>
                <button onClick={fetchData} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Refresh">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5">
                {[
                    { id: 'all', label: 'All Devices', count: stats.total },
                    { id: 'online', label: 'Online', count: stats.online },
                    { id: 'offline', label: 'Offline', count: stats.offline },
                    { id: 'maintenance', label: 'Maintenance', count: stats.maintenance }
                ].map(tab => (
                    <button key={tab.id} onClick={() => setFilter(tab.id)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === tab.id
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}>
                        {tab.label} <span className={`ml-1 ${filter === tab.id ? 'text-blue-200' : 'text-gray-400'}`}>{tab.count}</span>
                    </button>
                ))}
            </div>

            {/* Device Cards */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading devices...
                </div>
            ) : filteredDevices.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No devices found</p>
                    <p className="text-sm mt-1">Register a device or generate a QR code to get started</p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredDevices.map(device => (
                        <div key={device._id} className="bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all">
                            {/* Card Header */}
                            <div className="p-4 pb-3">
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                                            <DeviceIcon type={device.deviceType} className="w-4.5 h-4.5" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{device.deviceName || 'Unnamed'}</h3>
                                            <p className="text-xs text-gray-400 mt-0.5">{device.deviceId}</p>
                                        </div>
                                    </div>
                                    <StatusBadge status={device.status} lastSeen={device.lastSeen} />
                                </div>

                                {/* Quick Info */}
                                <div className="flex items-center gap-3 text-xs text-gray-500 mt-2">
                                    {device.location && (
                                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{device.location}</span>
                                    )}
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Last seen: {timeAgo(device.lastSeen)}</span>
                                </div>
                            </div>

                            {/* Card Actions */}
                            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-50 bg-gray-50/50 rounded-b-xl">
                                <div className="flex items-center gap-1">
                                    <button onClick={() => { setSelectedDevice(device); setShowDetail(true) }}
                                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                                        <Eye className="w-3.5 h-3.5" /> Details
                                    </button>
                                    <button onClick={() => { setSelectedDevice(device); loadCommandHistory(device._id); setShowCommandHistory(true) }}
                                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors">
                                        <History className="w-3.5 h-3.5" /> History
                                    </button>
                                </div>
                                <div className="flex items-center gap-1">
                                    {device.status === 'maintenance' ? (
                                        <button onClick={() => sendCommand(device._id, 'maintenance_off')}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 rounded-md transition-colors">
                                            <CheckCircle className="w-3.5 h-3.5" /> End Maint.
                                        </button>
                                    ) : (
                                        <button onClick={() => sendCommand(device._id, 'maintenance_on')}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 rounded-md transition-colors">
                                            <Wrench className="w-3.5 h-3.5" /> Maint.
                                        </button>
                                    )}
                                    <button onClick={() => handleDelete(device._id)}
                                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 rounded-md transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ─── Register Device Modal ───────────────────────────── */}
            <Modal isOpen={showRegister} onClose={() => setShowRegister(false)} title="Register New Device" size="medium">
                <form onSubmit={handleRegister} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Device Name *</label>
                        <input type="text" required value={registerForm.deviceName}
                            onChange={e => setRegisterForm(f => ({ ...f, deviceName: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            placeholder="e.g., Lobby Kiosk 1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Device Type</label>
                        <select value={registerForm.deviceType}
                            onChange={e => setRegisterForm(f => ({ ...f, deviceType: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                            <option value="kiosk">Kiosk</option>
                            <option value="tablet">Tablet</option>
                            <option value="phone">Phone</option>
                            <option value="laptop">Laptop</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                        <input type="text" value={registerForm.location}
                            onChange={e => setRegisterForm(f => ({ ...f, location: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            placeholder="e.g., Main Entrance" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={() => setShowRegister(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                            Cancel
                        </button>
                        <button type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm">
                            Register Device
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ─── QR Code Modal ────────────────────────────────────── */}
            <Modal isOpen={showQR} onClose={() => setShowQR(false)} title="Device Registration QR Code" size="medium">
                {qrData && (
                    <div className="p-5 text-center">
                        {/* QR Code Display (rendered as data URL) */}
                        <div className="bg-gray-50 rounded-xl p-6 mb-4 inline-block">
                            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 inline-block">
                                {/* Simple QR representation using the qrString */}
                                <div className="w-48 h-48 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-700 rounded-lg">
                                    <QrCode className="w-20 h-20 text-white" />
                                </div>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-900 mb-1">Scan to Register Device</h4>
                        <p className="text-sm text-gray-500 mb-4">Point the device's camera at this code to auto-register</p>

                        {/* Activation Code */}
                        <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between mb-3">
                            <div className="text-left">
                                <p className="text-xs text-gray-500">Activation Code</p>
                                <p className="font-mono font-semibold text-gray-900">{qrData.code}</p>
                            </div>
                            <button onClick={copyQRCode} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <Copy className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Expiry */}
                        <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires: {formatDate(qrData.expiresAt)}
                        </p>

                        {/* QR Payload (collapsible) */}
                        <details className="mt-4 text-left">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">View QR payload</summary>
                            <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 overflow-x-auto">
                                {JSON.stringify(qrData.qrPayload, null, 2)}
                            </pre>
                        </details>
                    </div>
                )}
            </Modal>

            {/* ─── Device Detail Modal ──────────────────────────────── */}
            <Modal isOpen={showDetail && selectedDevice} onClose={() => setShowDetail(false)} title={selectedDevice?.deviceName || 'Device Details'} size="large">
                {selectedDevice && (
                    <div className="p-5">
                        {/* Status Header */}
                        <div className="flex items-center justify-between mb-5 bg-gray-50 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                                    <DeviceIcon type={selectedDevice.deviceType} className="w-6 h-6 text-gray-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{selectedDevice.deviceName}</h3>
                                    <p className="text-sm text-gray-500">{selectedDevice.deviceId}</p>
                                </div>
                            </div>
                            <StatusBadge status={selectedDevice.status} lastSeen={selectedDevice.lastSeen} />
                        </div>

                        {/* Device Info Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            {[
                                { label: 'Type', value: selectedDevice.deviceType || 'kiosk' },
                                { label: 'Location', value: selectedDevice.location || 'Not assigned' },
                                { label: 'Last Seen', value: timeAgo(selectedDevice.lastSeen) },
                                { label: 'Created', value: formatDate(selectedDevice.createdAt) },
                                { label: 'Firmware', value: selectedDevice.firmwareVersion || '—' },
                                { label: 'OS', value: selectedDevice.osVersion || '—' },
                                { label: 'IP Address', value: selectedDevice.ipAddress || '—' },
                                { label: 'Locked', value: selectedDevice.locked ? 'Yes' : 'No' },
                            ].map(item => (
                                <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                                    <p className="text-xs text-gray-500">{item.label}</p>
                                    <p className="text-sm font-medium text-gray-900 mt-0.5">{item.value}</p>
                                </div>
                            ))}
                        </div>

                        {/* Capabilities */}
                        {selectedDevice.capabilities?.length > 0 && (
                            <div className="mb-5">
                                <p className="text-sm font-medium text-gray-700 mb-2">Capabilities</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedDevice.capabilities.map(cap => (
                                        <span key={cap} className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-md">{cap.replace(/_/g, ' ')}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Remote Control */}
                        <div className="border-t border-gray-100 pt-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                <Settings className="w-4 h-4" /> Remote Control
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { cmd: 'restart', label: 'Restart', icon: RotateCcw, color: 'blue' },
                                    { cmd: 'lock', label: 'Lock', icon: Lock, color: 'amber' },
                                    { cmd: 'unlock', label: 'Unlock', icon: Unlock, color: 'green' },
                                    { cmd: 'screenshot', label: 'Screenshot', icon: Camera, color: 'purple' },
                                    { cmd: 'update', label: 'Update', icon: Download, color: 'indigo' },
                                    { cmd: 'sync_data', label: 'Sync Data', icon: RefreshCw, color: 'teal' },
                                    { cmd: 'clear_cache', label: 'Clear Cache', icon: Trash2, color: 'orange' },
                                    {
                                        cmd: selectedDevice.status === 'maintenance' ? 'maintenance_off' : 'maintenance_on',
                                        label: selectedDevice.status === 'maintenance' ? 'End Maint.' : 'Maintenance',
                                        icon: Wrench, color: 'yellow'
                                    },
                                ].map(action => (
                                    <button key={action.cmd}
                                        onClick={() => sendCommand(selectedDevice._id, action.cmd)}
                                        disabled={sendingCommand === action.cmd}
                                        className={`flex items-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700 disabled:opacity-50`}>
                                        <action.icon className="w-3.5 h-3.5" />
                                        {sendingCommand === action.cmd ? 'Sending...' : action.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-between border-t border-gray-100 pt-4 mt-5">
                            <button onClick={() => openEditModal(selectedDevice)}
                                className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5">
                                <Edit className="w-4 h-4" /> Edit Details
                            </button>
                            <button onClick={() => handleDelete(selectedDevice._id)}
                                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                                Deactivate Device
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* ─── Edit Device Modal ──────────────────────────────── */}
            <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Device" size="medium">
                <form onSubmit={handleEditSave} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Device Name *</label>
                        <input type="text" required value={editForm.deviceName}
                            onChange={e => setEditForm(f => ({ ...f, deviceName: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            placeholder="e.g., Lobby Kiosk 1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Device Type</label>
                        <select value={editForm.deviceType}
                            onChange={e => setEditForm(f => ({ ...f, deviceType: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                            <option value="kiosk">Kiosk</option>
                            <option value="tablet">Tablet</option>
                            <option value="phone">Phone</option>
                            <option value="laptop">Laptop</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                        <input type="text" value={editForm.location}
                            onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            placeholder="e.g., Main Entrance" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Capabilities</label>
                        <input type="text" value={editForm.capabilities}
                            onChange={e => setEditForm(f => ({ ...f, capabilities: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            placeholder="face_recognition, qr_scan, nfc" />
                        <p className="text-xs text-gray-400 mt-1">Comma-separated capability tags</p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={() => setShowEdit(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                            Cancel
                        </button>
                        <button type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm">
                            Save Changes
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ─── Command History Modal ────────────────────────────── */}
            <Modal isOpen={showCommandHistory && selectedDevice} onClose={() => setShowCommandHistory(false)} title={`Command History — ${selectedDevice?.deviceName || ''}`} size="large">
                <div className="p-5">
                    {commandHistory.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <History className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                            <p className="text-sm">No commands sent to this device yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {commandHistory.map(cmd => (
                                <div key={cmd.commandId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                                            <Send className="w-3.5 h-3.5 text-gray-500" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{cmd.command.replace(/_/g, ' ')}</p>
                                            <p className="text-xs text-gray-500">{formatDate(cmd.createdAt)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <CommandBadge status={cmd.status} />
                                        {cmd.completedAt && (
                                            <span className="text-xs text-gray-400">{timeAgo(cmd.completedAt)}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    )
}
