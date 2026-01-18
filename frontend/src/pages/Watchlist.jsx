import { useState, useEffect } from 'react'
import { AlertTriangle, Star, Ban, Shield, Plus, Search, X, User } from 'lucide-react'
import api from '../api/client'

// Modal Component
function Modal({ isOpen, onClose, title, children }) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    )
}

export default function Watchlist() {
    const [entries, setEntries] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [showAddModal, setShowAddModal] = useState(false)
    const [saving, setSaving] = useState(false)

    const [form, setForm] = useState({
        visitorName: '', phone: '', email: '', category: 'blacklist', reason: ''
    })

    useEffect(() => {
        fetchWatchlist()
    }, [filter])

    const fetchWatchlist = async () => {
        try {
            setLoading(true)
            const params = filter !== 'all' ? { category: filter } : {}
            const response = await api.get('/watchlist', { params })
            setEntries(response.data.entries || [])
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load watchlist')
        } finally {
            setLoading(false)
        }
    }

    const handleAdd = async (e) => {
        e.preventDefault()
        if (!form.visitorName) {
            alert('Name is required')
            return
        }

        setSaving(true)
        try {
            await api.post('/watchlist', form)
            setShowAddModal(false)
            setForm({ visitorName: '', phone: '', email: '', category: 'blacklist', reason: '' })
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to add to watchlist')
        } finally {
            setSaving(false)
        }
    }

    const handleRemove = async (entryId) => {
        if (!confirm('Remove from watchlist?')) return

        try {
            await api.delete(`/watchlist/${entryId}`)
            fetchWatchlist()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to remove')
        }
    }

    const categories = [
        { id: 'all', label: 'All', icon: AlertTriangle, color: 'gray' },
        { id: 'vip', label: 'VIP', icon: Star, color: 'yellow' },
        { id: 'blacklist', label: 'Blacklist', icon: Ban, color: 'red' },
        { id: 'restricted', label: 'Restricted', icon: Shield, color: 'orange' },
    ]

    const getCategoryStyle = (category) => {
        switch (category) {
            case 'vip': return 'bg-yellow-50 text-yellow-700 border-yellow-200'
            case 'blacklist': return 'bg-red-50 text-red-700 border-red-200'
            case 'restricted': return 'bg-orange-50 text-orange-700 border-orange-200'
            default: return 'bg-gray-50 text-gray-700 border-gray-200'
        }
    }

    const filteredEntries = entries.filter(e =>
        e.visitorName?.toLowerCase().includes(search.toLowerCase()) ||
        e.phone?.includes(search)
    )

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Watchlist</h1>
                    <p className="text-sm text-gray-500">Manage VIP, blacklisted, and restricted visitors</p>
                </div>
                <button onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                    <Plus className="w-4 h-4" /> Add Entry
                </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>

                <div className="flex gap-2">
                    {categories.map((cat) => (
                        <button key={cat.id} onClick={() => setFilter(cat.id)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === cat.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}>
                            <cat.icon className="w-4 h-4" /> {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                    {error} <button onClick={fetchWatchlist} className="underline ml-2">Retry</button>
                </div>
            )}

            {/* List */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Contact</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Reason</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan={5} className="px-4 py-12 text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600 mx-auto"></div>
                            </td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">No entries found</td></tr>
                        ) : (
                            filteredEntries.map((entry) => (
                                <tr key={entry._id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                                                <User className="w-4 h-4 text-gray-500" />
                                            </div>
                                            <span className="text-sm font-medium text-gray-900">{entry.visitorName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-sm text-gray-600">{entry.phone || '—'}</div>
                                        <div className="text-xs text-gray-400">{entry.email || ''}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getCategoryStyle(entry.category)}`}>
                                            {entry.category?.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{entry.reason || '—'}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => handleRemove(entry._id)}
                                            className="text-sm text-red-600 hover:underline">Remove</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Modal */}
            <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add to Watchlist">
                <form onSubmit={handleAdd} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                        <input type="text" value={form.visitorName} onChange={e => setForm({ ...form, visitorName: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                            <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                                <option value="vip">VIP</option>
                                <option value="blacklist">Blacklist</option>
                                <option value="restricted">Restricted</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                        <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            {saving ? 'Adding...' : 'Add to Watchlist'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}
