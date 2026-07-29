import { useState, useEffect } from 'react'
import {
    ShieldAlert, Users, CheckCircle2, AlertOctagon, PhoneCall, Filter,
    Search, Download, RefreshCw, Radio, Flame, Shield, Check, X
} from 'lucide-react'
import api from '../api/client'

export default function Evacuation() {
    const [loading, setLoading] = useState(true)
    const [onSiteList, setOnSiteList] = useState([])
    const [entities, setEntities] = useState([])
    const [selectedLocation, setSelectedLocation] = useState('')
    const [searchTerm, setSearchTerm] = useState('')
    const [filterSafeStatus, setFilterSafeStatus] = useState('all') // all, safe, missing
    const [emergencyActive, setEmergencyActive] = useState(false)

    useEffect(() => {
        fetchEvacuationData()
    }, [])

    const fetchEvacuationData = async () => {
        try {
            setLoading(true)
            const [evacRes, entitiesRes] = await Promise.all([
                api.get('/evacuation/active-visitors'),
                api.get('/entities')
            ])

            const list = evacRes.data.visitors || evacRes.data.people || evacRes.data || []
            // Add client-side safe tracking state
            const mappedList = list.map(item => ({
                ...item,
                isSafe: item.isSafe || false,
                safeTimestamp: item.safeTimestamp || null
            }))

            setOnSiteList(mappedList)
            setEntities(entitiesRes.data.entities || entitiesRes.data || [])
        } catch (err) {
            console.error('Failed to load evacuation data:', err)
        } finally {
            setLoading(false)
        }
    }

    const toggleMarkSafe = (id) => {
        setOnSiteList(prev => prev.map(p => {
            if ((p._id || p.visitorId) === id) {
                const nextSafe = !p.isSafe
                return {
                    ...p,
                    isSafe: nextSafe,
                    safeTimestamp: nextSafe ? new Date().toLocaleTimeString('en-IN') : null
                }
            }
            return p
        }))
    }

    const markAllSafeInZone = () => {
        if (!selectedLocation) {
            if (!confirm('Mark ALL on-site people across all locations as SAFE?')) return
        }
        setOnSiteList(prev => prev.map(p => {
            const matches = !selectedLocation || p.locationId === selectedLocation || p.entityId === selectedLocation
            if (matches) {
                return { ...p, isSafe: true, safeTimestamp: new Date().toLocaleTimeString('en-IN') }
            }
            return p
        }))
    }

    // Filter people list
    const filteredPeople = onSiteList.filter(p => {
        const matchesLocation = !selectedLocation || p.locationId === selectedLocation || p.entityId === selectedLocation
        const matchesSearch = !searchTerm ||
            p.visitorName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.phone?.includes(searchTerm) ||
            p.hostEmployeeName?.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesStatus = filterSafeStatus === 'all' ||
            (filterSafeStatus === 'safe' && p.isSafe) ||
            (filterSafeStatus === 'missing' && !p.isSafe)

        return matchesLocation && matchesSearch && matchesStatus
    })

    const totalCount = onSiteList.length
    const safeCount = onSiteList.filter(p => p.isSafe).length
    const missingCount = totalCount - safeCount
    const safePercentage = totalCount > 0 ? Math.round((safeCount / totalCount) * 100) : 100

    return (
        <div className="space-y-6">
            {/* Emergency Mode Alert Header */}
            <div className={`rounded-2xl p-6 text-white border shadow-xl transition-all ${emergencyActive
                    ? 'bg-gradient-to-r from-red-600 via-red-700 to-red-800 border-red-500 animate-pulse'
                    : 'bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 border-slate-800'
                }`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-2xl ${emergencyActive ? 'bg-red-500/20 text-white' : 'bg-blue-600/20 text-blue-400'}`}>
                            <Flame className="w-8 h-8" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-black tracking-tight">Emergency Evacuation Console</h1>
                                {emergencyActive && (
                                    <span className="px-2.5 py-0.5 bg-red-500 text-white text-xs font-black uppercase rounded-full tracking-wider animate-bounce">
                                        ALARM ACTIVE
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-300 mt-1">
                                Real-time muster roll call for facility marshals and emergency responders.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setEmergencyActive(!emergencyActive)}
                            className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all ${emergencyActive
                                    ? 'bg-white text-red-700 hover:bg-slate-100'
                                    : 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30'
                                }`}
                        >
                            <AlertOctagon className="w-4 h-4" />
                            {emergencyActive ? 'Deactivate Alarm' : 'Trigger Evacuation Alarm'}
                        </button>
                        <button
                            onClick={() => window.print()}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 border border-slate-700"
                        >
                            <Download className="w-4 h-4" /> Export Muster List
                        </button>
                    </div>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total On-Site</p>
                    <p className="text-3xl font-black text-gray-900 mt-1">{totalCount}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Active checked-in personnel</p>
                </div>
                <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm bg-emerald-50/30">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Accounted Safe</p>
                    <p className="text-3xl font-black text-emerald-600 mt-1">{safeCount}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">{safePercentage}% muster completed</p>
                </div>
                <div className="bg-white rounded-xl border border-red-200 p-4 shadow-sm bg-red-50/30">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Unaccounted / Missing</p>
                    <p className="text-3xl font-black text-red-600 mt-1">{missingCount}</p>
                    <p className="text-xs text-red-500 mt-0.5">Require marshal verification</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Marshal Action</p>
                    <button
                        onClick={markAllSafeInZone}
                        className="mt-2 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                    >
                        <CheckCircle2 className="w-4 h-4" /> Mark All Zone Safe
                    </button>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search name, host, phone..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-800 outline-none focus:border-blue-500"
                        />
                    </div>
                    <select
                        value={selectedLocation}
                        onChange={e => setSelectedLocation(e.target.value)}
                        className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 outline-none"
                    >
                        <option value="">All Zones / Gates</option>
                        {entities.map(e => (
                            <option key={e._id} value={e._id}>{e.name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                    {[
                        { key: 'all', label: 'All People' },
                        { key: 'missing', label: `Missing (${missingCount})` },
                        { key: 'safe', label: `Safe (${safeCount})` }
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilterSafeStatus(f.key)}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${filterSafeStatus === f.key
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Muster Roll Call Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                    <h3 className="font-semibold text-gray-900 text-xs uppercase tracking-wider flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-600" /> On-Site Personnel Roll Call
                    </h3>
                    <span className="text-xs text-gray-500">Showing {filteredPeople.length} entries</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-gray-100/60 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                                <th className="px-4 py-3">Person Name</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3">Host Employee</th>
                                <th className="px-4 py-3">Contact</th>
                                <th className="px-4 py-3">Checked In Time</th>
                                <th className="px-4 py-3 text-center">Safety Status</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-blue-600 mx-auto mb-2" />
                                        Loading on-site muster list...
                                    </td>
                                </tr>
                            ) : filteredPeople.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                                        No personnel matched the selected muster filters.
                                    </td>
                                </tr>
                            ) : (
                                filteredPeople.map((person) => {
                                    const pid = person._id || person.visitorId
                                    return (
                                        <tr key={pid} className={`hover:bg-gray-50/80 transition-colors ${person.isSafe ? 'bg-emerald-50/20' : 'bg-red-50/20'}`}>
                                            <td className="px-4 py-3 font-semibold text-gray-900">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full ${person.isSafe ? 'bg-emerald-500' : 'bg-red-500 animate-ping'}`} />
                                                    {person.visitorName || person.name}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-[10px] font-bold rounded uppercase">
                                                    {person.visitorType || 'Visitor'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{person.hostEmployeeName || '—'}</td>
                                            <td className="px-4 py-3 text-gray-600">{person.phone || person.email || '—'}</td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {person.actualArrival ? new Date(person.actualArrival).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Today'}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {person.isSafe ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-full">
                                                        <Check className="w-3.5 h-3.5" /> Safe ({person.safeTimestamp || 'Verified'})
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-800 text-[11px] font-bold rounded-full">
                                                        <X className="w-3.5 h-3.5" /> Unaccounted
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => toggleMarkSafe(pid)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${person.isSafe
                                                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                                                        }`}
                                                >
                                                    {person.isSafe ? 'Mark Unsafe' : 'Mark Safe'}
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
