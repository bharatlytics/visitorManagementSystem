import { useState, useEffect } from 'react'
import { FileText, Download, Plus, Calendar, Clock, BarChart2, Users, TrendingUp, Filter } from 'lucide-react'
import api from '../api/client'

export default function Reports() {
    const [reports, setReports] = useState([])
    const [templates, setTemplates] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [generating, setGenerating] = useState(false)

    const [form, setForm] = useState({
        templateId: '', startDate: '', endDate: '', format: 'pdf'
    })


    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)

            const [reportsRes, templatesRes] = await Promise.allSettled([
                api.get('/reports'),
                api.get('/reports/templates')
            ])

            if (reportsRes.status === 'fulfilled') {
                setReports(reportsRes.value.data.reports || reportsRes.value.data || [])
            }

            // Backend returns templates as {id: {name, description}} - convert to array
            if (templatesRes.status === 'fulfilled') {
                const templatesData = templatesRes.value.data?.templates || {}
                if (typeof templatesData === 'object' && !Array.isArray(templatesData)) {
                    // Convert dict to array: {daily_summary: {name, desc}} -> [{_id, name, desc}]
                    const templatesArray = Object.entries(templatesData).map(([id, t]) => ({
                        _id: id,
                        name: t.name,
                        description: t.description
                    }))
                    setTemplates(templatesArray)
                } else if (Array.isArray(templatesData)) {
                    setTemplates(templatesData)
                }
            }
        } catch (err) {
            console.error('Reports fetch error:', err)
            setError(err.response?.data?.error || 'Failed to load reports')
        } finally {
            setLoading(false)
        }
    }


    const handleGenerate = async (e) => {
        e.preventDefault()
        if (!form.templateId) {
            alert('Please select a report template')
            return
        }

        setGenerating(true)
        try {
            await api.post('/reports/generate', {
                templateId: form.templateId,
                startDate: form.startDate,
                endDate: form.endDate,
                format: form.format
            })
            setForm({ templateId: '', startDate: '', endDate: '', format: 'pdf' })
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to generate report')
        } finally {
            setGenerating(false)
        }
    }

    const handleDownload = async (reportId) => {
        try {
            const response = await api.get(`/reports/${reportId}/download`, { responseType: 'blob' })
            const url = window.URL.createObjectURL(new Blob([response.data]))
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', `report-${reportId}.pdf`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
        } catch (err) {
            alert('Failed to download report')
        }
    }

    const handleQuickGenerate = (templateId) => {
        const today = new Date()
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
        const endDate = today.toISOString().split('T')[0]
        setForm({ templateId, startDate, endDate, format: 'pdf' })
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '—'
        return new Date(dateStr).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
    }

    const getTemplateIcon = (templateId) => {
        const icons = {
            daily: Calendar,
            weekly: BarChart2,
            monthly: TrendingUp,
            visitor_log: Users,
            visit_history: Clock,
            compliance: Filter
        }
        return icons[templateId] || FileText
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-xl font-bold text-gray-900">Report Builder</h1>
                <p className="text-sm text-gray-500">Generate, download, and schedule visitor management reports</p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={fetchData} className="underline font-medium">Retry</button>
                </div>
            )}

            {/* Generate Report Card */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-xl">
                <h3 className="text-lg font-semibold mb-4">Generate New Report</h3>
                <form onSubmit={handleGenerate} className="grid grid-cols-5 gap-4 items-end">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-blue-100 mb-2">Report Template</label>
                        <select
                            value={form.templateId}
                            onChange={e => setForm({ ...form, templateId: e.target.value })}
                            className="w-full px-4 py-3 border-0 bg-white/10 backdrop-blur-sm rounded-xl text-sm text-white placeholder-blue-200 focus:ring-2 focus:ring-white/50"
                        >
                            <option value="" className="text-gray-900">Select a template...</option>
                            {templates.map(t => (
                                <option key={t._id} value={t._id} className="text-gray-900">{t.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-blue-100 mb-2">Start Date</label>
                        <input
                            type="date"
                            value={form.startDate}
                            onChange={e => setForm({ ...form, startDate: e.target.value })}
                            className="w-full px-4 py-3 border-0 bg-white/10 backdrop-blur-sm rounded-xl text-sm text-white focus:ring-2 focus:ring-white/50"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-blue-100 mb-2">End Date</label>
                        <input
                            type="date"
                            value={form.endDate}
                            onChange={e => setForm({ ...form, endDate: e.target.value })}
                            className="w-full px-4 py-3 border-0 bg-white/10 backdrop-blur-sm rounded-xl text-sm text-white focus:ring-2 focus:ring-white/50"
                        />
                    </div>
                    <div>
                        <button
                            type="submit"
                            disabled={generating || !form.templateId}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-blue-600 rounded-xl text-sm font-semibold shadow-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {generating ? (
                                <><Clock className="w-4 h-4 animate-spin" /> Generating...</>
                            ) : (
                                <><Plus className="w-4 h-4" /> Generate Report</>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Template Cards */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Available Templates</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {templates.map(template => {
                        const Icon = getTemplateIcon(template._id)
                        return (
                            <div
                                key={template._id}
                                onClick={() => handleQuickGenerate(template._id)}
                                className={`p-5 bg-white border-2 rounded-xl cursor-pointer transition-all hover:shadow-lg ${form.templateId === template._id
                                    ? 'border-blue-500 bg-blue-50 shadow-md'
                                    : 'border-gray-200 hover:border-blue-300'
                                    }`}
                            >
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${form.templateId === template._id ? 'bg-blue-600' : 'bg-blue-100'
                                    }`}>
                                    <Icon className={`w-6 h-6 ${form.templateId === template._id ? 'text-white' : 'text-blue-600'}`} />
                                </div>
                                <h4 className="font-semibold text-gray-900">{template.name}</h4>
                                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{template.description}</p>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Recent Reports Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Generated Reports</h3>
                    <span className="text-sm text-gray-500">{reports.length} reports</span>
                </div>
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Report</th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Range</th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Generated On</th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Format</th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-16 text-center">
                                    <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-blue-600 mx-auto"></div>
                                    <p className="mt-4 text-sm text-gray-500">Loading reports...</p>
                                </td>
                            </tr>
                        ) : reports.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-16 text-center">
                                    <FileText className="w-12 h-12 text-gray-300 mx-auto" />
                                    <p className="mt-4 text-sm text-gray-500">No reports generated yet</p>
                                    <p className="text-xs text-gray-400 mt-1">Select a template above to generate your first report</p>
                                </td>
                            </tr>
                        ) : (
                            reports.map(report => (
                                <tr key={report._id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                                <FileText className="w-5 h-5 text-blue-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900">{report.name || templates.find(t => t._id === report.templateId)?.name || 'Report'}</p>
                                                <p className="text-xs text-gray-500">{report.templateId}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {formatDate(report.startDate)} — {formatDate(report.endDate)}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{formatDate(report.createdAt)}</td>
                                    <td className="px-6 py-4">
                                        <span className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full uppercase">
                                            {report.format || 'PDF'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${report.status === 'completed' ? 'bg-green-50 text-green-700' :
                                            report.status === 'processing' ? 'bg-yellow-50 text-yellow-700' :
                                                report.status === 'failed' ? 'bg-red-50 text-red-700' :
                                                    'bg-green-50 text-green-700'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${report.status === 'completed' ? 'bg-green-500' :
                                                report.status === 'processing' ? 'bg-yellow-500' :
                                                    report.status === 'failed' ? 'bg-red-500' :
                                                        'bg-green-500'
                                                }`}></span>
                                            {report.status?.charAt(0).toUpperCase() + report.status?.slice(1) || 'Ready'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => handleDownload(report._id)}
                                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                                        >
                                            <Download className="w-4 h-4" /> Download
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
