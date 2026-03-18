import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle, Star, Ban, Shield, Plus, Search, X, User, Clock, Eye, Trash2, Edit3, ChevronDown, UserPlus, Phone, Mail, Hash, FileText, Calendar, AlertCircle, CheckCircle, Activity, MapPin } from 'lucide-react'
import api from '../api/client'

// ─── Modal ──────────────────────────────────────────────────────────
function Modal({ isOpen, onClose, title, wide, children }) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className={`bg-white rounded-2xl shadow-2xl ${wide ? 'w-[80vw] max-w-6xl' : 'w-full max-w-lg'} max-h-[90vh] flex flex-col`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto">{children}</div>
            </div>
        </div>
    )
}

// ─── Person Picker (searchable dropdown — visitors & employees) ─────
function PersonPicker({ onSelect, onManual }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState([])
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)
    const [source, setSource] = useState('visitors') // visitors | employees
    const ref = useRef(null)
    const debounce = useRef(null)

    useEffect(() => {
        const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    const doSearch = useCallback(async (q, src) => {
        if (q.length < 2) { setResults([]); return }
        setLoading(true)
        try {
            const endpoint = src === 'employees' ? '/employees' : '/visitors'
            const res = await api.get(endpoint, { params: { search: q, limit: 8 } })
            const data = src === 'employees'
                ? (res.data.employees || res.data || [])
                : (res.data.visitors || res.data || [])
            setResults(data.slice(0, 8))
        } catch { setResults([]) }
        setLoading(false)
    }, [])

    const handleInput = (val) => {
        setQuery(val)
        setOpen(true)
        clearTimeout(debounce.current)
        debounce.current = setTimeout(() => doSearch(val, source), 300)
    }

    const pick = (person) => {
        const name = person.visitorName || person.employeeName || person.name || ''
        onSelect({
            name,
            phone: person.phone || person.visitorPhone || '',
            email: person.email || person.visitorEmail || '',
            entityType: source === 'employees' ? 'employee' : 'visitor',
            entityId: person._id,
        })
        setQuery(name)
        setOpen(false)
    }

    return (
        <div ref={ref} className="relative">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Search Visitor or Employee</label>
            {/* Source toggle */}
            <div className="flex bg-gray-100 rounded-lg p-0.5 mb-2">
                {['visitors', 'employees'].map(s => (
                    <button key={s} type="button" onClick={() => { setSource(s); if (query.length >= 2) doSearch(query, s) }}
                        className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all capitalize ${source === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                        {s}
                    </button>
                ))}
            </div>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={query} onChange={e => handleInput(e.target.value)} onFocus={() => query.length >= 2 && setOpen(true)}
                    placeholder={`Search ${source} by name, phone, email…`}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400" />
            </div>

            {open && (query.length >= 2) && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    {loading ? (
                        <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                            <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" /> Searching…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="px-4 py-3">
                            <p className="text-sm text-gray-400">No {source} found for "{query}"</p>
                            <button type="button" onClick={() => { onManual(query); setOpen(false) }}
                                className="mt-2 text-xs text-blue-600 font-medium hover:underline flex items-center gap-1">
                                <UserPlus className="w-3 h-3" /> Add "{query}" manually
                            </button>
                        </div>
                    ) : (
                        results.map(p => {
                            const name = p.visitorName || p.employeeName || p.name || '—'
                            const phone = p.phone || p.visitorPhone || ''
                            const email = p.email || p.visitorEmail || ''
                            return (
                                <button key={p._id} type="button" onClick={() => pick(p)}
                                    className="w-full px-4 py-2.5 text-left hover:bg-blue-50 flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0">
                                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <User className="w-4 h-4 text-gray-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                                        <p className="text-xs text-gray-400 truncate">{[phone, email].filter(Boolean).join(' · ') || 'No contact info'}</p>
                                    </div>
                                </button>
                            )
                        })
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Main Component ─────────────────────────────────────────────────
export default function Watchlist() {
    const [entries, setEntries] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [showAddModal, setShowAddModal] = useState(false)
    const [showDetailModal, setShowDetailModal] = useState(null)
    const [editEntry, setEditEntry] = useState(null)
    const [saving, setSaving] = useState(false)
    const [alerts, setAlerts] = useState([])
    const [alertsExpanded, setAlertsExpanded] = useState(false)
    const [activityData, setActivityData] = useState([])
    const [activityLoading, setActivityLoading] = useState(false)

    const emptyForm = { name: '', phone: '', email: '', category: 'blacklist', severity: 'medium', reason: '', notes: '', expiresAt: '', entityType: '', entityId: '' }
    const [form, setForm] = useState({ ...emptyForm })

    useEffect(() => { fetchWatchlist(); fetchAlerts() }, [])
    useEffect(() => { if (showDetailModal?._id) fetchActivity(showDetailModal._id) }, [showDetailModal])

    const fetchWatchlist = async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await api.get('/watchlist')
            setEntries(response.data.watchlist || response.data.entries || [])
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load watchlist')
        } finally {
            setLoading(false)
        }
    }

    const fetchAlerts = async () => {
        try {
            const res = await api.get('/watchlist/alerts')
            setAlerts(res.data.alerts || [])
        } catch { /* silent */ }
    }

    const fetchActivity = async (entryId) => {
        setActivityLoading(true)
        setActivityData([])
        try {
            const res = await api.get(`/watchlist/${entryId}/activity`)
            setActivityData(res.data.activity || [])
        } catch { setActivityData([]) }
        finally { setActivityLoading(false) }
    }

    const handleAdd = async (e) => {
        e.preventDefault()
        if (!form.name.trim()) { alert('Name is required'); return }
        setSaving(true)
        try {
            const body = { ...form }
            if (!body.expiresAt) delete body.expiresAt
            if (!body.entityId) { delete body.entityId; delete body.entityType }
            await api.post('/watchlist', body)
            setShowAddModal(false)
            setForm({ ...emptyForm })
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to add')
        } finally { setSaving(false) }
    }

    const handleUpdate = async (e) => {
        e.preventDefault()
        if (!editEntry) return
        setSaving(true)
        try {
            const body = { ...form }
            if (!body.expiresAt) delete body.expiresAt
            await api.put(`/watchlist/${editEntry._id}`, body)
            setEditEntry(null)
            setForm({ ...emptyForm })
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update')
        } finally { setSaving(false) }
    }

    const handleRemove = async (entryId) => {
        if (!confirm('Permanently remove this entry? This cannot be undone. If you just want to clear them, use "Mark as Cleared" instead.')) return
        try {
            await api.delete(`/watchlist/${entryId}`)
            setShowDetailModal(null)
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to remove')
        }
    }

    const handleToggleStatus = async (entryId, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'cleared' : 'active'
        const reason = prompt(
            newStatus === 'cleared'
                ? 'Why is this person being cleared? (optional)'
                : 'Why is this person being reactivated? (optional)',
            ''
        )
        if (reason === null) return // cancelled
        try {
            await api.patch(`/watchlist/${entryId}/status`, { status: newStatus, reason })
            setShowDetailModal(null)
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to change status')
        }
    }

    const openEdit = (entry) => {
        setForm({
            name: entry.name || '',
            phone: entry.phone || '',
            email: entry.email || '',
            category: entry.category || 'blacklist',
            severity: entry.severity || 'medium',
            reason: entry.reason || '',
            notes: entry.notes || '',
            expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString().split('T')[0] : '',
            entityType: entry.entityType || '',
            entityId: entry.entityId || '',
        })
        setEditEntry(entry)
    }

    // ─── Filters ────────────────────────────────────────────────────
    const categories = [
        { id: 'all', label: 'All', icon: AlertTriangle, count: entries.length },
        { id: 'vip', label: 'VIP', icon: Star, count: entries.filter(e => e.category === 'vip' && e.status !== 'cleared').length },
        { id: 'blacklist', label: 'Blacklist', icon: Ban, count: entries.filter(e => e.category === 'blacklist' && e.status !== 'cleared').length },
        { id: 'restricted', label: 'Restricted', icon: Shield, count: entries.filter(e => e.category === 'restricted' && e.status !== 'cleared').length },
        { id: 'cleared', label: 'Cleared', icon: CheckCircle, count: entries.filter(e => e.status === 'cleared').length },
    ]

    const filteredEntries = entries.filter(e => {
        if (filter === 'cleared') return e.status === 'cleared'
        if (filter !== 'all' && e.category !== filter) return false
        if (!search) return true
        const q = search.toLowerCase()
        return (e.name || '').toLowerCase().includes(q) || (e.phone || '').includes(q) || (e.email || '').toLowerCase().includes(q)
    })

    const getCatConfig = (cat) => {
        switch (cat) {
            case 'vip': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', icon: Star, label: 'VIP' }
            case 'blacklist': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', icon: Ban, label: 'Blacklisted' }
            case 'restricted': return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500', icon: Shield, label: 'Restricted' }
            default: return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-500', icon: AlertTriangle, label: cat }
        }
    }

    const getSeverityConfig = (sev) => {
        switch (sev) {
            case 'high': return { bg: 'bg-red-100', text: 'text-red-700', label: 'High' }
            case 'medium': return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Medium' }
            case 'low': return { bg: 'bg-green-100', text: 'text-green-700', label: 'Low' }
            default: return { bg: 'bg-gray-100', text: 'text-gray-700', label: sev || 'Medium' }
        }
    }

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

    // ─── Person picker callbacks ────────────────────────────────────
    const handlePersonSelect = (person) => {
        setForm(f => ({ ...f, name: person.name, phone: person.phone, email: person.email, entityType: person.entityType, entityId: person.entityId }))
    }
    const handleManual = (name) => {
        setForm(f => ({ ...f, name }))
    }

    // ─── Form Fields Component ──────────────────────────────────────
    const FormFields = ({ isEdit }) => (
        <div className="space-y-4">
            {!isEdit && (
                <>
                    <PersonPicker onSelect={handlePersonSelect} onManual={handleManual} />
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                        <div className="relative flex justify-center text-xs"><span className="bg-white px-3 text-gray-400">or fill manually</span></div>
                    </div>
                </>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Name *</label>
                    <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" required />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Phone</label>
                    <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Email</label>
                    <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Category</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white">
                        <option value="vip">⭐ VIP</option>
                        <option value="blacklist">🚫 Blacklist</option>
                        <option value="restricted">⚠️ Restricted</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Severity</label>
                    <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Expires</label>
                    <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                </div>
            </div>

            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Reason *</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none" rows={2}
                    placeholder="Why is this person being added?" />
            </div>
            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none" rows={2}
                    placeholder="Additional notes (optional)" />
            </div>
        </div>
    )

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Watchlist</h1>
                    <p className="text-sm text-gray-500">Manage VIP, blacklisted, and restricted visitors & employees</p>
                </div>
                <button onClick={() => { setForm({ ...emptyForm }); setShowAddModal(true) }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-600/20 transition-all">
                    <Plus className="w-4 h-4" /> Add Entry
                </button>
            </div>

            {/* ─── Escalation Alert Banner ──────────────────────── */}
            {alerts.length > 0 && (
                <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-2xl p-4 shadow-sm">
                    <button onClick={() => setAlertsExpanded(!alertsExpanded)}
                        className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5 text-red-600 animate-pulse" />
                            </div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-red-800">
                                    ⚠️ {alerts.length} Security {alerts.length === 1 ? 'Alert' : 'Alerts'}
                                </p>
                                <p className="text-xs text-red-600">
                                    Blacklisted/restricted persons detected with recent activity in the last 7 days
                                </p>
                            </div>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-red-400 transition-transform ${alertsExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {alertsExpanded && (
                        <div className="mt-3 space-y-2 pt-3 border-t border-red-200">
                            {alerts.map((alert, i) => {
                                const catCfg = getCatConfig(alert.category)
                                return (
                                    <div key={i} className="bg-white/80 rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:bg-white transition-colors cursor-pointer"
                                        onClick={() => {
                                            const fullEntry = entries.find(e => e._id === alert.entryId)
                                            if (fullEntry) { setShowDetailModal(fullEntry); fetchActivity(fullEntry._id) }
                                        }}>
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${catCfg.bg}`}>
                                                <catCfg.icon className={`w-4 h-4 ${catCfg.text}`} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900">{alert.name}</p>
                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                    <span className={`px-1.5 py-0.5 rounded-full font-semibold ${catCfg.bg} ${catCfg.text}`}>{catCfg.label}</span>
                                                    <span>•</span>
                                                    <span>{alert.activityCount} recent {alert.activityCount === 1 ? 'activity' : 'activities'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-semibold text-red-700">Last seen</p>
                                            <p className="text-xs text-gray-500">{fmtDate(alert.lastSeen)}</p>
                                            <p className="text-[10px] text-gray-400 uppercase">{alert.lastSeenType}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Stats + Filters */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search by name, phone, email…" value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" />
                </div>
                <div className="flex gap-1.5">
                    {categories.map(cat => (
                        <button key={cat.id} onClick={() => setFilter(cat.id)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${filter === cat.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            <cat.icon className="w-3.5 h-3.5" />
                            {cat.label}
                            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${filter === cat.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
                                {cat.count}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 flex items-center justify-between">
                    <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>
                    <button onClick={fetchWatchlist} className="text-xs font-semibold underline">Retry</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50/80 border-b border-gray-100">
                            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Person</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Severity</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reason</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {loading ? (
                            <tr><td colSpan={8} className="px-5 py-16 text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600 mx-auto" />
                                <p className="mt-3 text-sm text-gray-400">Loading watchlist…</p>
                            </td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={8} className="px-5 py-16 text-center">
                                <Shield className="w-10 h-10 text-gray-200 mx-auto" />
                                <p className="mt-3 text-sm text-gray-400">No entries found</p>
                                <p className="text-xs text-gray-300 mt-1">Add visitors or employees to the watchlist to track them</p>
                            </td></tr>
                        ) : filteredEntries.map(entry => {
                            const cat = getCatConfig(entry.category)
                            const sev = getSeverityConfig(entry.severity)
                            const isCleared = entry.status === 'cleared'
                            return (
                                <tr key={entry._id} className={`transition-colors group ${isCleared ? 'bg-gray-50/50 opacity-60' : 'hover:bg-blue-50/30'}`}>
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cat.bg}`}>
                                                <cat.icon className={`w-4 h-4 ${cat.text}`} />
                                            </div>
                                            <div>
                                                <p className={`text-sm font-semibold ${isCleared ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{entry.name}</p>
                                                {entry.entityType && <p className="text-[10px] text-gray-400 uppercase tracking-wide">{entry.entityType}</p>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-sm text-gray-700">{entry.phone || '—'}</div>
                                        {entry.email && <div className="text-xs text-gray-400 truncate max-w-[160px]">{entry.email}</div>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full border ${cat.bg} ${cat.text} ${cat.border}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${cat.dot}`} />
                                            {cat.label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${sev.bg} ${sev.text}`}>{sev.label}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {isCleared ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-200">
                                                <CheckCircle className="w-3 h-3" /> Cleared
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Active
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="text-sm text-gray-600 truncate max-w-[180px]">{entry.reason || '—'}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => { setShowDetailModal(entry); fetchActivity(entry._id) }} title="View"
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => openEdit(entry)} title="Edit"
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                                <Edit3 className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleToggleStatus(entry._id, entry.status)}
                                                title={isCleared ? 'Reactivate' : 'Mark as Cleared'}
                                                className={`p-1.5 rounded-lg transition-colors ${isCleared ? 'text-gray-400 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}>
                                                {isCleared ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                                            </button>
                                            <button onClick={() => handleRemove(entry._id)} title="Permanently Delete"
                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {/* ─── Add Modal ────────────────────────────────────────── */}
            <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add to Watchlist" wide>
                <form onSubmit={handleAdd}>
                    <FormFields isEdit={false} />
                    <div className="flex justify-end gap-2 pt-5 mt-5 border-t border-gray-100">
                        <button type="button" onClick={() => setShowAddModal(false)}
                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-semibold shadow-sm transition-all">
                            {saving ? 'Adding…' : 'Add to Watchlist'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ─── Edit Modal ───────────────────────────────────────── */}
            <Modal isOpen={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Watchlist Entry" wide>
                <form onSubmit={handleUpdate}>
                    <FormFields isEdit={true} />
                    <div className="flex justify-end gap-2 pt-5 mt-5 border-t border-gray-100">
                        <button type="button" onClick={() => setEditEntry(null)}
                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-semibold shadow-sm transition-all">
                            {saving ? 'Saving…' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ─── Detail Modal ──────────────────────────────────────── */}
            <Modal isOpen={!!showDetailModal} onClose={() => { setShowDetailModal(null); setActivityData([]) }} title="Watchlist Entry Details" wide>
                {showDetailModal && (() => {
                    const e = showDetailModal
                    const cat = getCatConfig(e.category)
                    const sev = getSeverityConfig(e.severity)
                    const isCleared = e.status === 'cleared'
                    return (
                        <div className="space-y-4">
                            {/* Status banner */}
                            {isCleared && (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-sm text-green-700 font-medium">
                                    <CheckCircle className="w-4 h-4" /> This person has been cleared
                                </div>
                            )}

                            {/* Header card — full width */}
                            <div className={`${isCleared ? 'bg-gray-50' : cat.bg} rounded-xl p-4 flex items-center gap-3`}>
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-white/60`}>
                                    <cat.icon className={`w-6 h-6 ${isCleared ? 'text-gray-400' : cat.text}`} />
                                </div>
                                <div>
                                    <h4 className={`font-bold text-lg ${isCleared ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{e.name}</h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${cat.bg} ${cat.text} ${cat.border}`}>{cat.label}</span>
                                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${sev.bg} ${sev.text}`}>Severity: {sev.label}</span>
                                        {isCleared ? (
                                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-200">✓  Cleared</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Active
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ─── Two-Column Layout ─── */}
                            <div className="grid grid-cols-2 gap-6">

                                {/* ═══ LEFT: Person Details ═══ */}
                                <div className="space-y-3">
                                    <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <User className="w-3.5 h-3.5" /> Person Details
                                    </h5>

                                    {/* Info grid */}
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { icon: Phone, label: 'Phone', value: e.phone },
                                            { icon: Mail, label: 'Email', value: e.email },
                                            { icon: User, label: 'Linked To', value: e.entityType ? `${e.entityType.charAt(0).toUpperCase() + e.entityType.slice(1)} (ID: ${e.entityId?.slice(-6) || '—'})` : 'Manual Entry' },
                                            { icon: Calendar, label: 'Added', value: fmtDate(e.createdAt) },
                                            { icon: Clock, label: 'Expires', value: e.expiresAt ? fmtDate(e.expiresAt) : 'Never' },
                                            { icon: User, label: 'Added By', value: e.addedBy || 'System' },
                                        ].map((item, i) => (
                                            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                                                    <item.icon className="w-3 h-3" /> {item.label}
                                                </div>
                                                <p className="text-sm font-medium text-gray-800 truncate">{item.value || '—'}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Reason & Notes */}
                                    {e.reason && (
                                        <div className="bg-gray-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><FileText className="w-3 h-3" /> Reason</div>
                                            <p className="text-sm text-gray-800">{e.reason}</p>
                                        </div>
                                    )}
                                    {e.notes && (
                                        <div className="bg-gray-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><FileText className="w-3 h-3" /> Notes</div>
                                            <p className="text-sm text-gray-800">{e.notes}</p>
                                        </div>
                                    )}

                                    {/* Status History */}
                                    {e.statusHistory && e.statusHistory.length > 0 && (
                                        <div className="bg-gray-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2"><Clock className="w-3 h-3" /> Status History</div>
                                            <div className="space-y-1.5">
                                                {e.statusHistory.slice(-5).reverse().map((sh, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-xs">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${sh.status === 'active' ? 'bg-blue-500' : 'bg-green-500'}`} />
                                                        <span className="font-medium capitalize">{sh.status}</span>
                                                        {sh.reason && <span className="text-gray-400">— {sh.reason}</span>}
                                                        <span className="ml-auto text-gray-300 text-[10px]">{fmtDate(sh.changedAt)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* ═══ RIGHT: Insights & Activity ═══ */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                            <Activity className="w-3.5 h-3.5" /> Activity & Insights
                                        </h5>
                                        {!activityLoading && activityData.length === 0 && (
                                            <button onClick={() => fetchActivity(e._id)} className="text-xs text-blue-600 font-semibold hover:underline">
                                                Load Activity
                                            </button>
                                        )}
                                    </div>

                                    {/* Quick Stats */}
                                    {activityData.length > 0 && (
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
                                                <p className="text-lg font-bold text-blue-700">{activityData.length}</p>
                                                <p className="text-[10px] text-blue-500 uppercase font-semibold">Records</p>
                                            </div>
                                            <div className="bg-purple-50 rounded-lg px-3 py-2 text-center">
                                                <p className="text-lg font-bold text-purple-700">{activityData.filter(a => a.type === 'visit').length}</p>
                                                <p className="text-[10px] text-purple-500 uppercase font-semibold">Visits</p>
                                            </div>
                                            <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
                                                <p className="text-lg font-bold text-green-700">{activityData.filter(a => a.type === 'attendance').length}</p>
                                                <p className="text-[10px] text-green-500 uppercase font-semibold">Attendance</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Activity Timeline */}
                                    <div className="bg-gray-50 rounded-xl p-3 min-h-[200px]">
                                        {activityLoading ? (
                                            <div className="flex items-center gap-2 py-8 justify-center">
                                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-blue-600" />
                                                <span className="text-xs text-gray-400">Loading activity…</span>
                                            </div>
                                        ) : activityData.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-8">
                                                <Activity className="w-8 h-8 text-gray-200" />
                                                <p className="text-xs text-gray-400 mt-2">No recent activity found</p>
                                                <p className="text-[10px] text-gray-300 mt-0.5">Visit or attendance records will appear here</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-0 max-h-[340px] overflow-y-auto pr-1">
                                                {activityData.map((act, idx) => {
                                                    const isVisit = act.type === 'visit'
                                                    const isLast = idx === activityData.length - 1
                                                    return (
                                                        <div key={act._id || idx} className="flex gap-3">
                                                            {/* Timeline dot + line */}
                                                            <div className="flex flex-col items-center">
                                                                <div className={`w-3 h-3 rounded-full border-2 mt-1.5 ${isVisit ? 'border-purple-400 bg-purple-100' : 'border-blue-400 bg-blue-100'}`} />
                                                                {!isLast && <div className="w-0.5 flex-1 bg-gray-200 my-0.5" />}
                                                            </div>
                                                            {/* Content */}
                                                            <div className="flex-1 pb-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${isVisit ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                                                            {isVisit ? '👤 Visit' : '🕐 Attendance'}
                                                                        </span>
                                                                        <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${act.status === 'checked-in' ? 'bg-green-50 text-green-700' :
                                                                            act.status === 'checked-out' ? 'bg-gray-100 text-gray-600' :
                                                                                act.status === 'completed' ? 'bg-green-50 text-green-700' :
                                                                                    act.status === 'scheduled' ? 'bg-yellow-50 text-yellow-700' :
                                                                                        'bg-gray-50 text-gray-500'
                                                                            }`}>{act.status}</span>
                                                                    </div>
                                                                    <span className="text-[10px] text-gray-400">{fmtDate(act.date)}</span>
                                                                </div>
                                                                {isVisit ? (
                                                                    <div className="mt-1 text-xs text-gray-600">
                                                                        {act.purpose && <span>Purpose: <strong>{act.purpose}</strong></span>}
                                                                        {act.host && <span className="ml-2">Host: <strong>{act.host}</strong></span>}
                                                                        {act.location && <span className="flex items-center gap-0.5 mt-0.5 text-gray-400"><MapPin className="w-3 h-3" />{act.location}</span>}
                                                                    </div>
                                                                ) : (
                                                                    <div className="mt-1 text-xs text-gray-600">
                                                                        {act.checkIn && <span>In: <strong>{new Date(act.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>}
                                                                        {act.checkOut && <span className="ml-2">Out: <strong>{new Date(act.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>}
                                                                        {act.hoursWorked && <span className="ml-2 text-gray-400">({act.hoursWorked.toFixed(1)}h)</span>}
                                                                        {act.source && <span className="flex items-center gap-0.5 mt-0.5 text-gray-400">Source: {act.source}</span>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Footer actions — full width */}
                            <div className="flex items-center justify-between gap-2 pt-4 border-t border-gray-100">
                                <button onClick={() => handleRemove(e._id)}
                                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium">
                                    <Trash2 className="w-4 h-4" /> Delete
                                </button>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleToggleStatus(e._id, e.status)}
                                        className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors font-medium ${isCleared
                                            ? 'text-orange-600 hover:bg-orange-50 border border-orange-200'
                                            : 'text-green-700 hover:bg-green-50 border border-green-200'
                                            }`}>
                                        {isCleared ? <><AlertTriangle className="w-4 h-4" /> Reactivate</> : <><CheckCircle className="w-4 h-4" /> Mark as Cleared</>}
                                    </button>
                                    <button onClick={() => { setShowDetailModal(null); openEdit(e) }}
                                        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold transition-all">
                                        <Edit3 className="w-4 h-4" /> Edit
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                })()}
            </Modal>
        </div>
    )
}
