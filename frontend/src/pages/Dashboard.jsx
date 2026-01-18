import { useEffect, useState } from 'react'
import { Users, Calendar, Clock, AlertTriangle, TrendingUp, Building, UserCheck, Plus, LogIn, Eye, CheckCircle, XCircle, ShieldCheck, ShieldX, Star, Zap, ArrowRight, X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client'

function StatCard({ title, value, subtitle, icon: Icon, color = 'blue', trend }) {
    const colors = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        orange: 'bg-orange-50 text-orange-600',
        purple: 'bg-purple-50 text-purple-600',
        red: 'bg-red-50 text-red-600',
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div className={`p-2.5 rounded-xl ${colors[color]}`}>
                    <Icon className="w-5 h-5" />
                </div>
                {trend && (
                    <span className={`text-xs font-medium ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {trend > 0 ? '+' : ''}{trend}%
                    </span>
                )}
            </div>
            <div className="mt-3">
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-sm text-gray-500 mt-0.5">{title}</p>
                {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
        </div>
    )
}

// Small Modal for quick actions
function QuickModal({ isOpen, onClose, title, children }) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
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

export default function Dashboard() {
    const navigate = useNavigate()
    const [stats, setStats] = useState(null)
    const [trends, setTrends] = useState([])
    const [recentVisits, setRecentVisits] = useState([])
    const [pendingApprovals, setPendingApprovals] = useState([])
    const [watchlistAlerts, setWatchlistAlerts] = useState([])
    const [entities, setEntities] = useState([])
    const [employees, setEmployees] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // Filters
    const [selectedEntity, setSelectedEntity] = useState('')
    const [selectedHost, setSelectedHost] = useState('')

    // Quick action modal
    const [showQuickCheckin, setShowQuickCheckin] = useState(false)
    const [quickPhone, setQuickPhone] = useState('')

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)

            const [statsRes, trendsRes, visitsRes, entitiesRes, employeesRes, approvalsRes, watchlistRes] = await Promise.allSettled([
                api.get('/dashboard/stats'),
                api.get('/dashboard/trends'),
                api.get('/visitors/visits'),
                api.get('/entities'),
                api.get('/employees'),
                api.get('/approvals', { params: { status: 'pending' } }),
                api.get('/watchlist', { params: { limit: 5 } })
            ])

            if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
            if (trendsRes.status === 'fulfilled') setTrends(trendsRes.value.data.trends || trendsRes.value.data || [])
            if (visitsRes.status === 'fulfilled') {
                const visits = visitsRes.value.data.visits || visitsRes.value.data || []
                setRecentVisits(visits.slice(0, 8))
            }
            if (entitiesRes.status === 'fulfilled') setEntities(entitiesRes.value.data.entities || entitiesRes.value.data || [])
            if (employeesRes.status === 'fulfilled') setEmployees(employeesRes.value.data.employees || employeesRes.value.data || [])
            if (approvalsRes.status === 'fulfilled') {
                const approvals = approvalsRes.value.data.approvals || approvalsRes.value.data || []
                setPendingApprovals(approvals.slice(0, 3))
            }
            if (watchlistRes.status === 'fulfilled') {
                setWatchlistAlerts(watchlistRes.value.data.entries?.slice(0, 3) || [])
            }

        } catch (err) {
            console.error('Dashboard error:', err)
            setError(err.response?.data?.error || 'Failed to load dashboard')
        } finally {
            setLoading(false)
        }
    }

    const handleQuickApprove = async (approvalId) => {
        try {
            await api.post(`/approvals/${approvalId}/approve`)
            fetchData()
        } catch (err) {
            alert('Failed to approve')
        }
    }

    const handleQuickReject = async (approvalId) => {
        const reason = prompt('Rejection reason:')
        if (reason === null) return
        try {
            await api.post(`/approvals/${approvalId}/reject`, { reason })
            fetchData()
        } catch (err) {
            alert('Failed to reject')
        }
    }

    const handleQuickCheckin = async () => {
        if (!quickPhone) {
            alert('Please enter phone number')
            return
        }
        try {
            // Find visitor by phone and check them in
            const response = await api.get('/visitors', { params: { phone: quickPhone } })
            const visitors = response.data.visitors || []
            if (visitors.length === 0) {
                alert('Visitor not found. Please register first.')
                return
            }
            // Navigate to visits page with pre-filled data
            setShowQuickCheckin(false)
            navigate('/visits')
        } catch (err) {
            alert('Error looking up visitor')
        }
    }

    // Filter visits
    const filteredVisits = recentVisits.filter(visit => {
        const matchesEntity = !selectedEntity || visit.locationId === selectedEntity || visit.entityId === selectedEntity
        const matchesHost = !selectedHost || visit.hostEmployeeId === selectedHost
        return matchesEntity && matchesHost
    })

    const todayStats = stats?.today || {}
    const currentlyOnSite = stats?.currentlyOnSite || stats?.currently_on_site || 0
    const capacity = stats?.capacity || 100
    const occupancyPercent = Math.min(100, Math.round((currentlyOnSite / capacity) * 100))

    // Visitor type breakdown for mini chart
    const typeBreakdown = [
        { name: 'Guest', value: todayStats.guests || 30, color: '#3B82F6' },
        { name: 'Contractor', value: todayStats.contractors || 15, color: '#8B5CF6' },
        { name: 'Interview', value: todayStats.interviews || 10, color: '#10B981' },
        { name: 'Delivery', value: todayStats.deliveries || 5, color: '#F59E0B' },
    ]

    return (
        <div className="space-y-5">
            {/* Header with Quick Actions */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-sm text-gray-500">Welcome back! Here's your overview.</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Quick Actions */}
                    <button
                        onClick={() => navigate('/visitors')}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg shadow-sm"
                    >
                        <Plus className="w-4 h-4" /> Register
                    </button>
                    <button
                        onClick={() => navigate('/visits')}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                    >
                        <Calendar className="w-4 h-4" /> Schedule
                    </button>
                    <button
                        onClick={() => setShowQuickCheckin(true)}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg"
                    >
                        <LogIn className="w-4 h-4" /> Check-In
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                    {error}
                    <button onClick={fetchData} className="ml-2 underline">Retry</button>
                </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard
                    title="Currently On-Site"
                    value={loading ? '—' : currentlyOnSite}
                    subtitle={`${occupancyPercent}% capacity`}
                    icon={Users}
                    color="blue"
                />
                <StatCard
                    title="Today's Visits"
                    value={loading ? '—' : todayStats.total || 0}
                    subtitle={`${todayStats.scheduled || 0} scheduled`}
                    icon={Calendar}
                    color="green"
                />
                <StatCard
                    title="Avg. Duration"
                    value={loading ? '—' : `${Math.round(todayStats.avgDurationMinutes || stats?.avgDuration || 0)}m`}
                    icon={Clock}
                    color="purple"
                />
                <StatCard
                    title="Pending Approvals"
                    value={loading ? '—' : pendingApprovals.length || stats?.pendingApprovals || 0}
                    icon={AlertTriangle}
                    color="orange"
                />
                <StatCard
                    title="Watchlist Alerts"
                    value={loading ? '—' : watchlistAlerts.length || 0}
                    icon={ShieldCheck}
                    color="red"
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Trend Chart - 2 cols */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900 text-sm">Visit Trends</h3>
                        <span className="text-xs text-gray-400">Last 7 days</span>
                    </div>
                    <div className="h-52">
                        {trends.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trends}>
                                    <defs>
                                        <linearGradient id="colorVisits" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#9CA3AF"
                                        fontSize={11}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(val) => val?.slice(8) || val}
                                    />
                                    <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} width={30} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#fff',
                                            border: '1px solid #E5E7EB',
                                            borderRadius: '8px',
                                            fontSize: '12px'
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="total"
                                        stroke="#3B82F6"
                                        strokeWidth={2}
                                        fill="url(#colorVisits)"
                                        name="Visits"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm text-gray-400">
                                {loading ? 'Loading trends...' : 'No trend data available'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Today Summary + Occupancy */}
                <div className="space-y-4">
                    {/* Occupancy Gauge */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <h3 className="font-semibold text-gray-900 text-sm mb-3">Site Occupancy</h3>
                        <div className="relative pt-1">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-gray-600">{currentlyOnSite} / {capacity}</span>
                                <span className={`text-xs font-semibold ${occupancyPercent > 80 ? 'text-red-600' : occupancyPercent > 50 ? 'text-amber-600' : 'text-green-600'}`}>
                                    {occupancyPercent}%
                                </span>
                            </div>
                            <div className="overflow-hidden h-3 text-xs flex rounded-full bg-gray-200">
                                <div
                                    style={{ width: `${occupancyPercent}%` }}
                                    className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-500 ${occupancyPercent > 80 ? 'bg-red-500' : occupancyPercent > 50 ? 'bg-amber-500' : 'bg-green-500'
                                        }`}
                                ></div>
                            </div>
                        </div>
                    </div>

                    {/* Today Stats */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <h3 className="font-semibold text-gray-900 text-sm mb-3">Today's Activity</h3>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between p-2.5 bg-green-50 rounded-lg">
                                <span className="text-sm text-green-800 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div> Checked In
                                </span>
                                <span className="text-lg font-bold text-green-700">{todayStats.checkedIn || 0}</span>
                            </div>
                            <div className="flex items-center justify-between p-2.5 bg-blue-50 rounded-lg">
                                <span className="text-sm text-blue-800 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div> Checked Out
                                </span>
                                <span className="text-lg font-bold text-blue-700">{todayStats.checkedOut || 0}</span>
                            </div>
                            <div className="flex items-center justify-between p-2.5 bg-amber-50 rounded-lg">
                                <span className="text-sm text-amber-800 flex items-center gap-2">
                                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div> Scheduled
                                </span>
                                <span className="text-lg font-bold text-amber-700">{todayStats.scheduled || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Pending Approvals Widget */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-amber-50">
                        <h3 className="font-semibold text-amber-900 text-sm flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Pending Approvals
                        </h3>
                        <Link to="/approvals" className="text-xs text-amber-700 hover:underline flex items-center gap-1">
                            View All <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="p-4">
                        {pendingApprovals.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-4">No pending approvals</p>
                        ) : (
                            <div className="space-y-3">
                                {pendingApprovals.map((approval, idx) => (
                                    <div key={approval._id || idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                                                <span className="text-sm font-medium text-amber-700">{approval.visitorName?.charAt(0)}</span>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">{approval.visitorName}</p>
                                                <p className="text-xs text-gray-500">{approval.purpose || 'No purpose'}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleQuickReject(approval._id)}
                                                className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                            >
                                                <XCircle className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleQuickApprove(approval._id)}
                                                className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                            >
                                                <CheckCircle className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Visits - 2 cols */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 text-sm">Recent Visits</h3>
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedEntity}
                                onChange={(e) => setSelectedEntity(e.target.value)}
                                className="px-2 py-1 border border-gray-200 rounded text-xs bg-white"
                            >
                                <option value="">All Locations</option>
                                {entities.map(e => (
                                    <option key={e._id} value={e._id}>{e.name}</option>
                                ))}
                            </select>
                            <Link to="/visits" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                View All <ArrowRight className="w-3 h-3" />
                            </Link>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Visitor</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Host</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Time</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr><td colSpan={4} className="px-4 py-6 text-center">
                                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-blue-600 mx-auto"></div>
                                    </td></tr>
                                ) : filteredVisits.length === 0 ? (
                                    <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">No visits found</td></tr>
                                ) : (
                                    filteredVisits.map((visit, i) => (
                                        <tr key={visit._id || i} className="hover:bg-gray-50">
                                            <td className="px-4 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-medium text-blue-700">
                                                        {visit.visitorName?.charAt(0) || '?'}
                                                    </div>
                                                    <span className="text-sm text-gray-900">{visit.visitorName}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-600">{visit.hostEmployeeName || '—'}</td>
                                            <td className="px-4 py-2 text-sm text-gray-600">
                                                {visit.actualArrival ? new Date(visit.actualArrival).toLocaleString('en-IN', {
                                                    hour: '2-digit', minute: '2-digit'
                                                }) : '—'}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${visit.status === 'checked_in' ? 'bg-green-50 text-green-700' :
                                                    visit.status === 'checked_out' ? 'bg-gray-100 text-gray-600' :
                                                        visit.status === 'scheduled' ? 'bg-amber-50 text-amber-700' :
                                                            'bg-red-50 text-red-700'
                                                    }`}>
                                                    {visit.status?.replace('_', ' ')}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Quick Check-In Modal */}
            <QuickModal isOpen={showQuickCheckin} onClose={() => setShowQuickCheckin(false)} title="Quick Check-In">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">Enter visitor's phone number to quickly check them in.</p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                        <input
                            type="tel"
                            value={quickPhone}
                            onChange={e => setQuickPhone(e.target.value)}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm"
                            placeholder="+91 9876543210"
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            onClick={() => setShowQuickCheckin(false)}
                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleQuickCheckin}
                            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                            Check In
                        </button>
                    </div>
                </div>
            </QuickModal>
        </div>
    )
}
