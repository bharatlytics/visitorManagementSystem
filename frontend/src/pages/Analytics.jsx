import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Users, Clock, Calendar, Activity, Award, ShieldCheck, Building, User, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
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
                {trend !== undefined && trend !== null && (
                    <span className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {Math.abs(trend)}%
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

export default function Analytics() {
    const [data, setData] = useState({
        stats: null,
        trends: [],
        peakHours: [],
        visitorTypes: [],
        hostStats: [],
        compliance: null
    })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [period, setPeriod] = useState('7d')

    useEffect(() => {
        fetchAnalytics()
    }, [period])

    const fetchAnalytics = async () => {
        try {
            setLoading(true)
            setError(null)
            const days = period === '7d' ? 7 : period === '30d' ? 30 : 90

            const [dashRes, trendsRes, peakRes, typesRes, hostsRes, complianceRes] = await Promise.allSettled([
                api.get('/advanced-analytics/dashboard'),
                api.get('/advanced-analytics/trends', { params: { days } }),
                api.get('/advanced-analytics/peak-hours'),
                api.get('/advanced-analytics/visitor-types'),
                api.get('/advanced-analytics/host-stats'),
                api.get('/advanced-analytics/compliance')
            ])

            setData({
                stats: dashRes.status === 'fulfilled' ? dashRes.value.data : null,
                trends: trendsRes.status === 'fulfilled' ? (trendsRes.value.data.trends || []) : [],
                peakHours: peakRes.status === 'fulfilled' ? (peakRes.value.data.peakHours || peakRes.value.data.data || []) : [],
                visitorTypes: typesRes.status === 'fulfilled' ? (typesRes.value.data.types || typesRes.value.data.breakdown || []) : [],
                hostStats: hostsRes.status === 'fulfilled' ? (hostsRes.value.data.hosts || hostsRes.value.data.topHosts || []) : [],
                compliance: complianceRes.status === 'fulfilled' ? complianceRes.value.data : null
            })
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load analytics')
        } finally {
            setLoading(false)
        }
    }

    const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1']

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
                    <p className="text-sm text-gray-500">Visitor insights, trends, and performance metrics</p>
                </div>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                    {['7d', '30d', '90d'].map((p) => (
                        <button key={p} onClick={() => setPeriod(p)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}>
                            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 flex justify-between">
                    <span>{error}</span>
                    <button onClick={fetchAnalytics} className="underline font-medium">Retry</button>
                </div>
            )}

            {loading ? (
                <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-blue-600 mx-auto"></div>
                    <p className="mt-3 text-sm text-gray-500">Loading analytics...</p>
                </div>
            ) : (
                <>
                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <StatCard
                            title="Total Visitors"
                            value={data.stats?.totalVisitors ?? 0}
                            icon={Users}
                            color="blue"
                            trend={data.stats?.visitorTrend}
                        />
                        <StatCard
                            title="This Month"
                            value={data.stats?.thisMonth ?? 0}
                            icon={Calendar}
                            color="green"
                            trend={data.stats?.monthTrend}
                        />
                        <StatCard
                            title="Avg Duration"
                            value={`${Math.round(data.stats?.avgDuration ?? 0)}m`}
                            icon={Clock}
                            color="purple"
                        />
                        <StatCard
                            title="Approval Rate"
                            value={`${data.compliance?.approvalRate ?? 0}%`}
                            icon={ShieldCheck}
                            color="green"
                        />
                        <StatCard
                            title="Active Now"
                            value={data.stats?.activeNow ?? 0}
                            icon={Activity}
                            color="orange"
                        />
                    </div>

                    {/* Charts Row 1 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Trend Chart */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <h3 className="font-semibold text-gray-900 text-sm mb-4">Visit Trends</h3>
                            <div className="h-64">
                                {data.trends.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={data.trends}>
                                            <defs>
                                                <linearGradient id="colorVisits" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                                                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                                            <XAxis dataKey="date" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} />
                                            <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #E5E7EB' }} />
                                            <Area type="monotone" dataKey="total" stroke="#3B82F6" strokeWidth={2} fill="url(#colorVisits)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <div className="text-center">
                                            <TrendingUp className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400">No trend data available</p>
                                            <p className="text-xs text-gray-300">Visits will appear here once recorded</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Peak Hours */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <h3 className="font-semibold text-gray-900 text-sm mb-4">Peak Hours</h3>
                            <div className="h-64">
                                {data.peakHours.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={data.peakHours}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                                            <XAxis dataKey="hour" stroke="#9CA3AF" fontSize={10} tickLine={false} axisLine={false} />
                                            <YAxis stroke="#9CA3AF" fontSize={10} tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                                            <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <div className="text-center">
                                            <Clock className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400">No peak hour data</p>
                                            <p className="text-xs text-gray-300">Check-in times will be analyzed</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Charts Row 2 */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Visitor Types Pie */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <h3 className="font-semibold text-gray-900 text-sm mb-4">Visitor Types</h3>
                            {data.visitorTypes.length > 0 ? (
                                <div className="flex items-center gap-4">
                                    <div className="w-32 h-32">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={data.visitorTypes}
                                                    dataKey="count"
                                                    nameKey="type"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={30}
                                                    outerRadius={55}
                                                >
                                                    {data.visitorTypes.map((_, index) => (
                                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        {data.visitorTypes.slice(0, 5).map((type, i) => (
                                            <div key={type.type || i} className="flex items-center justify-between">
                                                <span className="flex items-center gap-2 text-sm text-gray-600">
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                                                    {type.type || type._id || 'Unknown'}
                                                </span>
                                                <span className="text-sm font-semibold text-gray-900">{type.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="h-32 flex items-center justify-center">
                                    <div className="text-center">
                                        <Users className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">No visitor type data</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Top Hosts */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
                                <Award className="w-4 h-4 text-amber-500" /> Top Hosts
                            </h3>
                            {data.hostStats.length > 0 ? (
                                <div className="space-y-3">
                                    {data.hostStats.slice(0, 5).map((host, i) => (
                                        <div key={host._id || i} className="flex items-center gap-3">
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' :
                                                    i === 1 ? 'bg-gray-100 text-gray-600' :
                                                        i === 2 ? 'bg-orange-100 text-orange-700' :
                                                            'bg-gray-50 text-gray-500'
                                                }`}>
                                                {i + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{host.hostName || host.name || 'Unknown'}</p>
                                                <p className="text-xs text-gray-500">{host.department || ''}</p>
                                            </div>
                                            <span className="text-sm font-semibold text-blue-600">{host.visitCount || host.count || 0}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-32 flex items-center justify-center">
                                    <div className="text-center">
                                        <Award className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">No host data available</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Compliance Stats */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-green-500" /> Compliance
                            </h3>
                            {data.compliance ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">Approval Rate</span>
                                            <span className="font-semibold text-gray-900">{data.compliance.approvalRate ?? 0}%</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${data.compliance.approvalRate ?? 0}%` }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">ID Verification</span>
                                            <span className="font-semibold text-gray-900">{data.compliance.idVerificationRate ?? 0}%</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${data.compliance.idVerificationRate ?? 0}%` }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">On-time Checkout</span>
                                            <span className="font-semibold text-gray-900">{data.compliance.onTimeCheckoutRate ?? 0}%</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${data.compliance.onTimeCheckoutRate ?? 0}%` }} />
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t border-gray-100">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">Watchlist Matches</span>
                                            <span className="px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 rounded-full">
                                                {data.compliance.blacklistMatches ?? 0}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-32 flex items-center justify-center">
                                    <div className="text-center">
                                        <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">No compliance data</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
