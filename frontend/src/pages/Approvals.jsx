import { useState, useEffect } from 'react'
import { ShieldCheck, ShieldX, Clock, CheckCircle, XCircle, User, Calendar, AlertTriangle, Eye, Send, History, Settings, BarChart2, X, Phone, Mail, Building, MapPin, Hash, Briefcase, FileText, Users } from 'lucide-react'
import api from '../api/client'

// Enterprise Modal Component - 80% viewport
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

export default function Approvals() {
    const [approvals, setApprovals] = useState([])
    const [history, setHistory] = useState([])
    const [employees, setEmployees] = useState([])
    const [stats, setStats] = useState({ pending: 0, approvedToday: 0, rejectedToday: 0 })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [filter, setFilter] = useState('pending')

    // Modal states
    const [showDetailsModal, setShowDetailsModal] = useState(false)
    const [showDelegateModal, setShowDelegateModal] = useState(false)
    const [showHistoryModal, setShowHistoryModal] = useState(false)
    const [showRulesModal, setShowRulesModal] = useState(false)
    const [selectedApproval, setSelectedApproval] = useState(null)
    const [processing, setProcessing] = useState(false)

    // Form states
    const [approveComment, setApproveComment] = useState('')
    const [rejectReason, setRejectReason] = useState('')
    const [delegateTo, setDelegateTo] = useState('')
    const [delegateReason, setDelegateReason] = useState('')

    useEffect(() => {
        fetchData()
    }, [filter])

    const fetchData = async () => {
        try {
            setLoading(true)
            setError(null)

            const [approvalsRes, employeesRes] = await Promise.allSettled([
                api.get('/approvals', { params: { status: filter } }),
                api.get('/employees')
            ])

            if (approvalsRes.status === 'fulfilled') {
                const data = approvalsRes.value.data.approvals || approvalsRes.value.data || []
                setApprovals(Array.isArray(data) ? data : [])

                // Calculate stats
                const pending = filter === 'pending' ? data.length : 0
                setStats({
                    pending,
                    approvedToday: 0,
                    rejectedToday: 0
                })
            }

            if (employeesRes.status === 'fulfilled') {
                const empData = employeesRes.value.data
                setEmployees(Array.isArray(empData) ? empData : (empData.employees || []))
            }
        } catch (err) {
            console.error('Error:', err)
            setError(err.response?.data?.error || 'Failed to load approvals')
        } finally {
            setLoading(false)
        }
    }

    const fetchHistory = async () => {
        try {
            const response = await api.get('/approvals/history', { params: { limit: 50 } })
            setHistory(response.data.approvals || response.data || [])
            setShowHistoryModal(true)
        } catch (err) {
            alert('Failed to load history')
        }
    }

    const handleApprove = async (approvalId, comment = '') => {
        setProcessing(true)
        try {
            await api.post(`/approvals/${approvalId}/approve`, { comment })
            setShowDetailsModal(false)
            setApproveComment('')
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to approve')
        } finally {
            setProcessing(false)
        }
    }

    const handleReject = async (approvalId, reason) => {
        if (!reason) {
            alert('Rejection reason is required')
            return
        }

        setProcessing(true)
        try {
            await api.post(`/approvals/${approvalId}/reject`, { reason })
            setShowDetailsModal(false)
            setRejectReason('')
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to reject')
        } finally {
            setProcessing(false)
        }
    }

    const handleDelegate = async () => {
        if (!delegateTo) {
            alert('Please select who to delegate to')
            return
        }

        setProcessing(true)
        try {
            await api.post(`/approvals/${selectedApproval._id}/delegate`, {
                toApproverId: delegateTo,
                reason: delegateReason
            })
            setShowDelegateModal(false)
            setDelegateTo('')
            setDelegateReason('')
            fetchData()
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delegate')
        } finally {
            setProcessing(false)
        }
    }

    const openDetailsModal = (approval) => {
        setSelectedApproval(approval)
        setShowDetailsModal(true)
        setApproveComment('')
        setRejectReason('')
    }

    const openDelegateModal = (approval) => {
        setSelectedApproval(approval)
        setShowDelegateModal(true)
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return '—'
        return new Date(dateStr).toLocaleString('en-IN', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
    }

    const getEmployeeName = (id) => {
        const emp = employees.find(e => e._id === id)
        return emp?.employeeName || emp?.name || 'Unknown'
    }

    const filters = [
        { id: 'pending', label: 'Pending', icon: Clock, color: 'amber' },
        { id: 'approved', label: 'Approved', icon: CheckCircle, color: 'green' },
        { id: 'rejected', label: 'Rejected', icon: XCircle, color: 'red' },
    ]

    const statusConfig = {
        pending: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock },
        approved: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle },
        rejected: { bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Approval Workflow</h1>
                    <p className="text-sm text-gray-500">Manage visitor approval requests and delegation</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchHistory}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                    >
                        <History className="w-4 h-4" /> History
                    </button>
                    <button
                        onClick={() => setShowRulesModal(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                    >
                        <Settings className="w-4 h-4" /> Rules
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-amber-100 rounded-xl">
                            <Clock className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{approvals.filter(a => !a.status || a.status === 'pending').length}</p>
                            <p className="text-sm text-gray-500">Pending</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-green-100 rounded-xl">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.approvedToday}</p>
                            <p className="text-sm text-gray-500">Approved Today</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-red-100 rounded-xl">
                            <XCircle className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.rejectedToday}</p>
                            <p className="text-sm text-gray-500">Rejected Today</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
                {filters.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${filter === f.id
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        <f.icon className="w-4 h-4" /> {f.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 flex items-center justify-between">
                    <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</span>
                    <button onClick={fetchData} className="underline font-medium">Retry</button>
                </div>
            )}

            {/* Approvals List */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Visitor</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Host</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Visit Details</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Requested</th>
                            <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan={6} className="px-5 py-16 text-center">
                                <div className="animate-spin rounded-full h-10 w-10 border-3 border-gray-200 border-t-blue-600 mx-auto"></div>
                                <p className="mt-3 text-sm text-gray-500">Loading approvals...</p>
                            </td></tr>
                        ) : approvals.length === 0 ? (
                            <tr><td colSpan={6} className="px-5 py-16 text-center">
                                <ShieldCheck className="w-12 h-12 text-gray-300 mx-auto" />
                                <p className="mt-3 text-sm text-gray-400">No {filter} approvals</p>
                            </td></tr>
                        ) : (
                            approvals.map((approval) => {
                                const status = statusConfig[approval.status || 'pending'] || statusConfig.pending
                                return (
                                    <tr key={approval._id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-full flex items-center justify-center shadow-md">
                                                    <span className="text-white font-medium">{approval.visitorName?.charAt(0)?.toUpperCase()}</span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-gray-900">{approval.visitorName}</p>
                                                    <p className="text-xs text-gray-500">{approval.visitorPhone || approval.organization || ''}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm font-medium text-gray-900">{approval.hostEmployeeName || '—'}</p>
                                            <p className="text-xs text-gray-500">{approval.hostDepartment || ''}</p>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm text-gray-900">{approval.purpose || 'No purpose'}</p>
                                            <p className="text-xs text-gray-500">{approval.visitType || 'guest'}</p>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-gray-600">{formatDate(approval.createdAt || approval.expectedArrival)}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${status.bg} ${status.text}`}>
                                                <status.icon className="w-3 h-3" />
                                                {(approval.status || 'pending').charAt(0).toUpperCase() + (approval.status || 'pending').slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => openDetailsModal(approval)}
                                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="View Details"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                                {filter === 'pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => openDelegateModal(approval)}
                                                            className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                                            title="Delegate"
                                                        >
                                                            <Send className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleReject(approval._id, prompt('Rejection reason:'))}
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Reject"
                                                        >
                                                            <XCircle className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleApprove(approval._id)}
                                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Approve"
                                                        >
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Details Modal - Enterprise Grade */}
            <Modal isOpen={showDetailsModal} onClose={() => setShowDetailsModal(false)} title="Approval Request Details">
                {selectedApproval && (
                    <div className="h-full flex flex-col">
                        {/* Header */}
                        <div className="flex items-start justify-between pb-6 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg">
                                    <span className="text-2xl font-bold text-white">{selectedApproval.visitorName?.charAt(0)}</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">{selectedApproval.visitorName}</h2>
                                    <p className="text-sm text-gray-500">{selectedApproval.organization || 'Individual Visitor'}</p>
                                    <p className="text-sm text-gray-500">{selectedApproval.visitorPhone} • {selectedApproval.visitorEmail || 'No email'}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full ${statusConfig[selectedApproval.status || 'pending']?.bg} ${statusConfig[selectedApproval.status || 'pending']?.text}`}>
                                    {(selectedApproval.status || 'pending').toUpperCase()}
                                </span>
                                <p className="text-xs text-gray-400 mt-2">Request ID: {selectedApproval._id?.slice(-8)}</p>
                            </div>
                        </div>

                        {/* Content Grid */}
                        <div className="flex-1 grid grid-cols-3 gap-6 py-6">
                            {/* Column 1 - Visit Info */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Visit Information</h4>
                                <InfoField icon={User} label="Host Employee" value={selectedApproval.hostEmployeeName} />
                                <InfoField icon={Briefcase} label="Department" value={selectedApproval.hostDepartment} />
                                <InfoField icon={FileText} label="Purpose" value={selectedApproval.purpose} />
                                <InfoField icon={Hash} label="Visit Type" value={selectedApproval.visitType?.toUpperCase()} />
                                <InfoField icon={MapPin} label="Location" value={selectedApproval.locationName} />
                            </div>

                            {/* Column 2 - Timing */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Schedule</h4>
                                <InfoField icon={Calendar} label="Expected Arrival" value={formatDate(selectedApproval.expectedArrival)} />
                                <InfoField icon={Calendar} label="Expected Departure" value={formatDate(selectedApproval.expectedDeparture)} />
                                <InfoField icon={Clock} label="Request Created" value={formatDate(selectedApproval.createdAt)} />

                                {selectedApproval.approvalChain && (
                                    <div className="p-4 bg-blue-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-blue-800 uppercase mb-2">Approval Chain</h5>
                                        {selectedApproval.approvalChain.map((step, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-sm text-blue-700">
                                                <span className="w-5 h-5 bg-blue-200 rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                                                <span>{step.approverName}</span>
                                                {step.status === 'approved' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Column 3 - Actions */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Decision</h4>

                                {(selectedApproval.status || 'pending') === 'pending' && (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Approval Comment (optional)</label>
                                            <textarea
                                                value={approveComment}
                                                onChange={e => setApproveComment(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none"
                                                rows={2}
                                                placeholder="Add a comment..."
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Rejection Reason (if rejecting)</label>
                                            <textarea
                                                value={rejectReason}
                                                onChange={e => setRejectReason(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none"
                                                rows={2}
                                                placeholder="Reason for rejection..."
                                            />
                                        </div>
                                    </>
                                )}

                                {selectedApproval.comment && (
                                    <div className="p-4 bg-gray-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-gray-600 uppercase mb-1">Approver Comment</h5>
                                        <p className="text-sm text-gray-700">{selectedApproval.comment}</p>
                                    </div>
                                )}

                                {selectedApproval.rejectionReason && (
                                    <div className="p-4 bg-red-50 rounded-xl">
                                        <h5 className="text-xs font-semibold text-red-800 uppercase mb-1">Rejection Reason</h5>
                                        <p className="text-sm text-red-700">{selectedApproval.rejectionReason}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions Footer */}
                        {(selectedApproval.status || 'pending') === 'pending' && (
                            <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                                <button
                                    onClick={() => { setShowDetailsModal(false); openDelegateModal(selectedApproval) }}
                                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-purple-600 bg-purple-50 rounded-xl hover:bg-purple-100"
                                >
                                    <Send className="w-4 h-4" /> Delegate
                                </button>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleReject(selectedApproval._id, rejectReason)}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-red-600 text-white rounded-xl shadow-lg hover:bg-red-700 disabled:opacity-50"
                                    >
                                        <XCircle className="w-4 h-4" /> {processing ? 'Processing...' : 'Reject'}
                                    </button>
                                    <button
                                        onClick={() => handleApprove(selectedApproval._id, approveComment)}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-green-600 text-white rounded-xl shadow-lg hover:bg-green-700 disabled:opacity-50"
                                    >
                                        <CheckCircle className="w-4 h-4" /> {processing ? 'Processing...' : 'Approve'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Delegate Modal */}
            <Modal isOpen={showDelegateModal} onClose={() => setShowDelegateModal(false)} title="Delegate Approval" size="medium">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Delegate approval for <strong>{selectedApproval?.visitorName}</strong> to another employee.
                    </p>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Delegate To *</label>
                        <select
                            value={delegateTo}
                            onChange={e => setDelegateTo(e.target.value)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm"
                        >
                            <option value="">Select employee...</option>
                            {employees.map(emp => (
                                <option key={emp._id} value={emp._id}>
                                    {emp.employeeName || emp.name} • {emp.department || 'N/A'}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Reason for Delegation</label>
                        <textarea
                            value={delegateReason}
                            onChange={e => setDelegateReason(e.target.value)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none"
                            rows={3}
                            placeholder="e.g., Out of office, higher authority needed..."
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <button
                            onClick={() => setShowDelegateModal(false)}
                            className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelegate}
                            disabled={processing || !delegateTo}
                            className="px-6 py-2.5 text-sm font-medium bg-purple-600 text-white rounded-xl shadow-lg hover:bg-purple-700 disabled:opacity-50"
                        >
                            {processing ? 'Delegating...' : 'Delegate'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* History Modal */}
            <Modal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} title="Approval History">
                <div className="space-y-4">
                    {history.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">No approval history found</p>
                    ) : (
                        <div className="space-y-3">
                            {history.map((item, idx) => (
                                <div key={idx} className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                                    <div className={`p-2 rounded-lg ${item.status === 'approved' ? 'bg-green-100' : item.status === 'rejected' ? 'bg-red-100' : 'bg-gray-100'}`}>
                                        {item.status === 'approved' ? <CheckCircle className="w-5 h-5 text-green-600" /> :
                                            item.status === 'rejected' ? <XCircle className="w-5 h-5 text-red-600" /> :
                                                <Clock className="w-5 h-5 text-gray-600" />}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-900">{item.visitorName}</p>
                                        <p className="text-xs text-gray-500">{item.status?.toUpperCase()} • {formatDate(item.updatedAt || item.createdAt)}</p>
                                        {item.comment && <p className="text-xs text-gray-600 mt-1">"{item.comment}"</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>

            {/* Rules Modal */}
            <Modal isOpen={showRulesModal} onClose={() => setShowRulesModal(false)} title="Approval Rules Configuration" size="medium">
                <div className="space-y-4">
                    <div className="p-4 bg-blue-50 rounded-xl">
                        <h5 className="text-sm font-semibold text-blue-800">Visit Types Requiring Approval</h5>
                        <ul className="mt-2 text-sm text-blue-700 space-y-1">
                            <li>• VIP Visits - Requires Manager approval</li>
                            <li>• Contractor Visits - Requires Safety Officer approval</li>
                            <li>• After-hours Visits - Requires Security approval</li>
                        </ul>
                    </div>

                    <div className="p-4 bg-amber-50 rounded-xl">
                        <h5 className="text-sm font-semibold text-amber-800">Approval Timeout</h5>
                        <p className="text-sm text-amber-700 mt-1">Requests automatically escalate after 24 hours</p>
                    </div>

                    <div className="p-4 bg-gray-50 rounded-xl">
                        <h5 className="text-sm font-semibold text-gray-800">Multi-Level Approvals</h5>
                        <p className="text-sm text-gray-700 mt-1">VIP visits require 2-level approval (Host → Manager)</p>
                    </div>

                    <p className="text-xs text-gray-500 text-center pt-4">
                        Contact your administrator to modify approval rules
                    </p>
                </div>
            </Modal>
        </div>
    )
}
