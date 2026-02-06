import { useState, useEffect } from 'react'
import { Calendar, Clock, LogIn, LogOut, Plus, Search, User, Building, Eye, BadgeCheck, X, Printer, MapPin, Phone, Mail, Briefcase, FileText, CheckCircle, AlertCircle, Hash, Users, Package, Car } from 'lucide-react'
import api from '../api/client'

// Enterprise Modal Component - 80% viewport
function Modal({ isOpen, onClose, title, children }) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                style={{ width: '80vw', height: '80vh', maxWidth: '1400px' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700">
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
                <Icon className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5 break-words">{value || '—'}</p>
            </div>
        </div>
    )
}

export default function Visits() {
    const [visits, setVisits] = useState([])
    const [visitors, setVisitors] = useState([])
    const [hosts, setHosts] = useState([]) // From actors API
    const [entities, setEntities] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')

    // Entity/Host filters
    const [selectedEntity, setSelectedEntity] = useState('')
    const [selectedHost, setSelectedHost] = useState('')

    // Modal states
    const [showScheduleModal, setShowScheduleModal] = useState(false)
    const [showDetailsModal, setShowDetailsModal] = useState(false)
    const [showBadgeModal, setShowBadgeModal] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState(null)
    const [saving, setSaving] = useState(false)

    // Form state
    const [form, setForm] = useState({
        visitorId: '', hostEmployeeId: '', expectedArrival: '', expectedDeparture: '',
        purpose: '', visitType: 'guest', notes: '', locationId: '', accessAreas: [], vehicleNumber: '',
        requiresApproval: false // Host approval workflow toggle
    })

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)
            const [visitsRes, visitorsRes, hostsRes, entitiesRes] = await Promise.allSettled([
                api.get('/visitors/visits'),
                api.get('/visitors/list'),
                api.get('/employees'), // Uses data_provider which respects installation mappings
                api.get('/entities')
            ])

            setVisits(visitsRes.status === 'fulfilled' ? (visitsRes.value.data.visits || []) : [])
            setVisitors(visitorsRes.status === 'fulfilled' ? (visitorsRes.value.data.visitors || []) : [])

            // Hosts from employees API (respects installation actor mappings)
            if (hostsRes.status === 'fulfilled') {
                // Handle both array response and {employees: [...]} response
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

    const handleSchedule = async (e) => {
        e.preventDefault()
        if (!form.visitorId || !form.hostEmployeeId || !form.expectedArrival) {
            alert('Please fill required fields: Visitor, Host, Expected Arrival')
            return
        }

        setSaving(true)
        try {
            await api.post(`/visitors/${form.visitorId}/schedule-visit`, {
                hostEmployeeId: form.hostEmployeeId,
                expectedArrival: new Date(form.expectedArrival).toISOString(),
                expectedDeparture: form.expectedDeparture ? new Date(form.expectedDeparture).toISOString() : null,
                purpose: form.purpose,
                visitType: form.visitType,
                locationId: form.locationId,
                notes: form.notes,
                accessAreas: form.accessAreas,
                vehicleNumber: form.vehicleNumber,
                requiresApproval: form.requiresApproval
            })

            setShowScheduleModal(false)
            resetForm()
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to schedule visit')
        } finally {
            setSaving(false)
        }
    }

    const handleCheckIn = async (visitId) => {
        try {
            await api.post(`/visitors/visits/${visitId}/check-in`, { method: 'manual' })
            fetchData()
            if (showDetailsModal) {
                // Refresh the selected visit
                const updated = visits.find(v => v._id === visitId)
                if (updated) setSelectedVisit({ ...updated, status: 'checked_in', actualArrival: new Date().toISOString() })
            }
        } catch (err) {
            alert(err.response?.data?.error || 'Check-in failed')
        }
    }

    const handleCheckOut = async (visitId) => {
        try {
            await api.post(`/visitors/visits/${visitId}/check-out`)
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Check-out failed')
        }
    }

    const openDetailsModal = (visit) => {
        setSelectedVisit(visit)
        setShowDetailsModal(true)
    }

    const openBadgeModal = (visit) => {
        setSelectedVisit(visit)
        setShowBadgeModal(true)
    }

    const printBadge = () => {
        if (!selectedVisit) return
        const badgeUrl = `/api/badge/visits/${selectedVisit._id}/badge`
        const printWindow = window.open('', '_blank')
        printWindow.document.write(`
      <html>
        <head><title>Visitor Badge - ${selectedVisit.visitorName}</title>
        <style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;}</style>
        </head>
        <body>
          <img src="${badgeUrl}" style="max-width:100%;max-height:100vh;">
          <script>window.onload = function() { setTimeout(function(){window.print();}, 500); }<\/script>
        </body>
      </html>
    `)
        printWindow.document.close()
    }

    const resetForm = () => {
        setForm({ visitorId: '', hostEmployeeId: '', expectedArrival: '', expectedDeparture: '', purpose: '', visitType: 'guest', notes: '', locationId: '', accessAreas: [], vehicleNumber: '', requiresApproval: false })
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '—'
        // Display the stored time directly without timezone conversion
        // Since backend stores local time values, we use UTC methods to show them as stored
        const date = new Date(dateStr)
        const day = date.getUTCDate()
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const month = months[date.getUTCMonth()]
        const year = date.getUTCFullYear()
        let hours = date.getUTCHours()
        const minutes = date.getUTCMinutes().toString().padStart(2, '0')
        const ampm = hours >= 12 ? 'pm' : 'am'
        hours = hours % 12 || 12
        return `${day} ${month} ${year}, ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`
    }

    const calculateDuration = (checkIn, checkOut) => {
        if (!checkIn) return '—'
        const start = new Date(checkIn)
        const end = checkOut ? new Date(checkOut) : new Date()
        const diffMs = end - start
        const hours = Math.floor(diffMs / (1000 * 60 * 60))
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
    }

    const statusConfig = {
        pending_approval: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-400', label: 'Pending Approval', icon: AlertCircle },
        scheduled: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', label: 'Scheduled', icon: Clock },
        checked_in: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-400', label: 'On Site', icon: CheckCircle },
        checked_out: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', label: 'Completed', icon: LogOut },
        cancelled: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400', label: 'Cancelled', icon: AlertCircle },
    }

    const filters = [
        { id: 'all', label: 'All Visits', count: visits.length },
        { id: 'pending_approval', label: 'Pending Approval', count: visits.filter(v => v.status === 'pending_approval').length },
        { id: 'scheduled', label: 'Scheduled', count: visits.filter(v => v.status === 'scheduled').length },
        { id: 'checked_in', label: 'On-Site', count: visits.filter(v => v.status === 'checked_in').length },
        { id: 'checked_out', label: 'Completed', count: visits.filter(v => v.status === 'checked_out').length },
    ]

    const filteredVisits = visits.filter(v => {
        const matchesStatus = filter === 'all' || v.status === filter
        const matchesSearch = !search ||
            v.visitorName?.toLowerCase().includes(search.toLowerCase()) ||
            v.hostEmployeeName?.toLowerCase().includes(search.toLowerCase())
        const matchesEntity = !selectedEntity || v.locationId === selectedEntity || v.entityId === selectedEntity
        const matchesHost = !selectedHost || v.hostEmployeeId === selectedHost
        return matchesStatus && matchesSearch && matchesEntity && matchesHost
    })

    const getHostName = (host) => {
        return host.employeeName || host.name || host.attributes?.name || 'Unknown'
    }

    const getHostDepartment = (host) => {
        return host.department || host.attributes?.department || 'N/A'
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Visit Management</h1>
                    <p className="text-sm text-gray-500">{visits.length} total visits • {visits.filter(v => v.status === 'checked_in').length} currently on-site</p>
                </div>
                <button
                    onClick={() => { resetForm(); setShowScheduleModal(true) }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl text-sm font-medium shadow-lg shadow-blue-500/25 transition-all"
                >
                    <Plus className="w-4 h-4" /> Schedule Visit
                </button>
            </div>

            {/* Filters Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="relative flex-1 min-w-[250px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by visitor or host name..."
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

                    <select value={selectedHost} onChange={(e) => setSelectedHost(e.target.value)}
                        className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white min-w-[160px]">
                        <option value="">All Hosts</option>
                        {hosts.map(h => (
                            <option key={h._id} value={h._id}>{getHostName(h)}</option>
                        ))}
                    </select>
                </div>

                {/* Status Tabs */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    {filters.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === f.id
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                        >
                            {f.label}
                            <span className={`px-1.5 py-0.5 rounded-full text-xs ${filter === f.id ? 'bg-white/20' : 'bg-gray-200'
                                }`}>{f.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {error} <button onClick={fetchData} className="underline ml-2 font-medium">Retry</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Visitor</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Host</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Check In</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Check Out</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan={7} className="px-5 py-16 text-center">
                                <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-blue-600 mx-auto"></div>
                                <p className="mt-3 text-sm text-gray-500">Loading visits...</p>
                            </td></tr>
                        ) : filteredVisits.length === 0 ? (
                            <tr><td colSpan={7} className="px-5 py-16 text-center">
                                <Calendar className="w-12 h-12 text-gray-300 mx-auto" />
                                <p className="mt-3 text-sm text-gray-400">No visits found</p>
                            </td></tr>
                        ) : (
                            filteredVisits.map((visit) => {
                                const status = statusConfig[visit.status] || statusConfig.scheduled
                                return (
                                    <tr key={visit._id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-md">
                                                    <span className="text-white font-medium">{visit.visitorName?.charAt(0)?.toUpperCase()}</span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-gray-900">{visit.visitorName}</p>
                                                    <p className="text-xs text-gray-500">{visit.visitorPhone || visit.purpose || ''}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm font-medium text-gray-900">{visit.hostEmployeeName || '—'}</p>
                                            <p className="text-xs text-gray-500">{visit.hostDepartment || ''}</p>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-gray-600">{formatDate(visit.actualArrival)}</td>
                                        <td className="px-5 py-4 text-sm text-gray-600">{formatDate(visit.actualDeparture)}</td>
                                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{calculateDuration(visit.actualArrival, visit.actualDeparture)}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${status.bg} ${status.text}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                                                {status.label}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => openDetailsModal(visit)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View Details">
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                                {visit.status === 'scheduled' && (
                                                    <button onClick={() => handleCheckIn(visit._id)} className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Check In">
                                                        <LogIn className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {visit.status === 'checked_in' && (
                                                    <button onClick={() => handleCheckOut(visit._id)} className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors" title="Check Out">
                                                        <LogOut className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button onClick={() => openBadgeModal(visit)} className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="View Badge">
                                                    <BadgeCheck className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Schedule Visit Modal - Enterprise Grade */}
            <Modal isOpen={showScheduleModal} onClose={() => setShowScheduleModal(false)} title="Schedule New Visit">
                <form onSubmit={handleSchedule} className="h-full flex flex-col">
                    <div className="flex-1 grid grid-cols-3 gap-6">
                        {/* Left Column - Visitor & Host */}
                        <div className="space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Visitor & Host</h4>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Visitor *</label>
                                <select value={form.visitorId} onChange={e => setForm({ ...form, visitorId: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" required>
                                    <option value="">Select a visitor</option>
                                    {visitors.map(v => (
                                        <option key={v._id} value={v._id}>{v.visitorName} • {v.phone}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Host Employee *</label>
                                <select value={form.hostEmployeeId} onChange={e => setForm({ ...form, hostEmployeeId: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" required>
                                    <option value="">Select host employee</option>
                                    {hosts.map(h => (
                                        <option key={h._id} value={h._id}>{getHostName(h)} • {getHostDepartment(h)}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Location / Zone</label>
                                <select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                                    <option value="">Select location</option>
                                    {entities.map(e => (
                                        <option key={e._id} value={e._id}>{e.name} ({e.type})</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Middle Column - Schedule Details */}
                        <div className="space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Schedule Details</h4>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Expected Arrival *</label>
                                <input type="datetime-local" value={form.expectedArrival} onChange={e => setForm({ ...form, expectedArrival: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" required />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Expected Departure</label>
                                <input type="datetime-local" value={form.expectedDeparture} onChange={e => setForm({ ...form, expectedDeparture: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Visit Type</label>
                                <select value={form.visitType} onChange={e => setForm({ ...form, visitType: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm">
                                    <option value="guest">General Guest</option>
                                    <option value="meeting">Business Meeting</option>
                                    <option value="interview">Job Interview</option>
                                    <option value="delivery">Delivery</option>
                                    <option value="contractor">Contractor</option>
                                    <option value="vip">VIP Visit</option>
                                    <option value="maintenance">Maintenance</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Vehicle Number</label>
                                <input type="text" value={form.vehicleNumber} onChange={e => setForm({ ...form, vehicleNumber: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="e.g., MH-01-AB-1234" />
                            </div>
                        </div>

                        {/* Right Column - Purpose & Notes */}
                        <div className="space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider pb-2 border-b">Purpose & Additional</h4>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Purpose of Visit</label>
                                <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm" placeholder="e.g., Project discussion, Document submission" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes</label>
                                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none" rows={5}
                                    placeholder="Any special requirements, accessibility needs, or security notes..." />
                            </div>

                            {/* Host Approval Toggle */}
                            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h5 className="text-sm font-semibold text-purple-900">Requires Host Approval</h5>
                                        <p className="text-xs text-purple-700 mt-1">Host employee must approve before visit is confirmed</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setForm({ ...form, requiresApproval: !form.requiresApproval })}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${form.requiresApproval ? 'bg-purple-600' : 'bg-gray-300'}`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.requiresApproval ? 'translate-x-7' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 bg-blue-50 rounded-xl">
                                <h5 className="text-xs font-semibold text-blue-800 uppercase">Quick Tips</h5>
                                <ul className="mt-2 text-xs text-blue-700 space-y-1">
                                    <li>• Enable approval for sensitive visits</li>
                                    <li>• VIP and contractor visits often require approval</li>
                                    <li>• Host will be notified via the system</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-200">
                        <p className="text-xs text-gray-500">* Required fields</p>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowScheduleModal(false)}
                                className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                            <button type="submit" disabled={saving}
                                className="px-8 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl shadow-lg disabled:opacity-50 transition-all">
                                {saving ? 'Scheduling...' : 'Schedule Visit'}
                            </button>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* Visit Details Modal - Enterprise Grade */}
            <Modal isOpen={showDetailsModal} onClose={() => setShowDetailsModal(false)} title="Visit Details">
                {selectedVisit && (
                    <div className="h-full flex flex-col">
                        {/* Header with Status and Actions */}
                        <div className="flex items-start justify-between pb-6 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                                    <span className="text-2xl font-bold text-white">{selectedVisit.visitorName?.charAt(0)}</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">{selectedVisit.visitorName}</h2>
                                    <p className="text-sm text-gray-500">{selectedVisit.visitorPhone} • {selectedVisit.visitorEmail || 'No email'}</p>
                                    <p className="text-sm text-gray-500 mt-1">{selectedVisit.organization || selectedVisit.visitorCompany || 'Individual'}</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                                <span className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full ${statusConfig[selectedVisit.status]?.bg} ${statusConfig[selectedVisit.status]?.text}`}>
                                    {(() => { const Icon = statusConfig[selectedVisit.status]?.icon; return Icon ? <Icon className="w-4 h-4" /> : null })()}
                                    {statusConfig[selectedVisit.status]?.label}
                                </span>
                                <p className="text-xs text-gray-400">Visit ID: {selectedVisit._id?.slice(-8)}</p>
                                {/* Action buttons in header */}
                                <div className="flex items-center gap-2 mt-2">
                                    <button onClick={() => { openBadgeModal(selectedVisit); setShowDetailsModal(false) }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
                                        <BadgeCheck className="w-3.5 h-3.5" /> Badge
                                    </button>
                                    {selectedVisit.status === 'scheduled' && (
                                        <button onClick={() => { handleCheckIn(selectedVisit._id); setShowDetailsModal(false) }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                            <LogIn className="w-3.5 h-3.5" /> Check In
                                        </button>
                                    )}
                                    {selectedVisit.status === 'checked_in' && (
                                        <button onClick={() => { handleCheckOut(selectedVisit._id); setShowDetailsModal(false) }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors">
                                            <LogOut className="w-3.5 h-3.5" /> Check Out
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Content Grid */}
                        <div className="flex-1 grid grid-cols-3 gap-6 py-6">
                            {/* Column 1 - Visit Info */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Visit Information</h4>
                                <InfoField icon={User} label="Host Employee" value={selectedVisit.hostEmployeeName} />
                                <InfoField icon={Briefcase} label="Department" value={selectedVisit.hostDepartment} />
                                <InfoField icon={FileText} label="Purpose" value={selectedVisit.purpose} />
                                <InfoField icon={Hash} label="Visit Type" value={selectedVisit.visitType?.replace('_', ' ')?.toUpperCase()} />
                                <InfoField icon={MapPin} label="Location" value={selectedVisit.locationName || selectedVisit.locationId} />
                            </div>

                            {/* Column 2 - Timing */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Timing Details</h4>
                                <InfoField icon={Calendar} label="Expected Arrival" value={formatDate(selectedVisit.expectedArrival)} />
                                <InfoField icon={Calendar} label="Expected Departure" value={formatDate(selectedVisit.expectedDeparture)} />
                                <InfoField icon={LogIn} label="Actual Check-In" value={formatDate(selectedVisit.actualArrival)} />
                                <InfoField icon={LogOut} label="Actual Check-Out" value={formatDate(selectedVisit.actualDeparture)} />
                                <InfoField icon={Clock} label="Duration" value={calculateDuration(selectedVisit.actualArrival, selectedVisit.actualDeparture)} />
                            </div>

                            {/* Column 3 - Additional */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Additional Details</h4>
                                <InfoField icon={BadgeCheck} label="Check-In Method" value={selectedVisit.checkInMethod === 'FR' ? 'Face Recognition' : selectedVisit.checkInMethod || '—'} />
                                <InfoField icon={Car} label="Vehicle Number" value={selectedVisit.vehicleNumber} />
                                <InfoField icon={Users} label="Number of Persons" value={selectedVisit.numberOfPersons || 1} />

                                {/* Belongings */}
                                {selectedVisit.belongings && selectedVisit.belongings.length > 0 && (
                                    <div className="p-4 bg-blue-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-blue-800 uppercase mb-2 flex items-center gap-2">
                                            <Package className="w-3.5 h-3.5" /> Belongings
                                        </h5>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedVisit.belongings.map((item, idx) => (
                                                <span key={idx} className="px-2.5 py-1 bg-white text-blue-700 text-xs font-medium rounded-lg border border-blue-200">
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {selectedVisit.notes && (
                                    <div className="p-4 bg-yellow-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-yellow-800 uppercase mb-2">Notes</h5>
                                        <p className="text-sm text-yellow-700">{selectedVisit.notes}</p>
                                    </div>
                                )}

                                {selectedVisit.approvalStatus && (
                                    <div className={`p-4 rounded-xl ${selectedVisit.approvalStatus === 'approved' ? 'bg-green-50' : selectedVisit.approvalStatus === 'rejected' ? 'bg-red-50' : 'bg-yellow-50'}`}>
                                        <h5 className="text-xs font-semibold uppercase mb-2">Approval Status</h5>
                                        <p className="text-sm font-medium">{selectedVisit.approvalStatus?.toUpperCase()}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Badge Modal */}
            <Modal isOpen={showBadgeModal} onClose={() => setShowBadgeModal(false)} title={`Visitor Badge - ${selectedVisit?.visitorName || ''}`}>
                {selectedVisit && (
                    <div className="h-full flex flex-col items-center justify-center">
                        <div className="flex-1 flex items-center justify-center w-full">
                            <div className="bg-gray-100 rounded-2xl p-8 shadow-inner">
                                <img
                                    src={`/api/badge/visits/${selectedVisit._id}/badge`}
                                    alt="Visitor Badge"
                                    className="max-h-[50vh] rounded-lg shadow-xl"
                                    onError={(e) => {
                                        e.target.onerror = null
                                        e.target.parentElement.innerHTML = '<div class="text-center py-20 text-gray-400"><p>Badge not available</p></div>'
                                    }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-center gap-4 pt-6 border-t border-gray-200 mt-auto">
                            <button onClick={() => setShowBadgeModal(false)} className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Close</button>
                            <button onClick={printBadge} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-blue-800 transition-all">
                                <Printer className="w-4 h-4" /> Print Badge
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
