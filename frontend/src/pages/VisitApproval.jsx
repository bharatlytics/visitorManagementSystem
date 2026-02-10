import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../utils/api';

export default function VisitApproval() {
    const { token } = useParams();
    const [loading, setLoading] = useState(true);
    const [visit, setVisit] = useState(null);
    const [tokenInfo, setTokenInfo] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [processing, setProcessing] = useState(false);
    const [notes, setNotes] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');

    useEffect(() => {
        fetchVisitDetails();
    }, [token]);

    const fetchVisitDetails = async () => {
        try {
            setLoading(true);
            const response = await api.get(`/approval-tokens/${token}`);
            setVisit(response.data.visit);
            setTokenInfo(response.data.token);
            setError('');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load approval details');
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async () => {
        try {
            setProcessing(true);
            await api.post(`/approval-tokens/${token}/approve`, { notes });
            setSuccess('Visit approved successfully! The visitor will be notified.');
            setVisit({ ...visit, status: 'scheduled' });
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to approve visit');
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = async () => {
        if (!rejectionReason.trim()) {
            setError('Please provide a reason for rejection');
            return;
        }

        try {
            setProcessing(true);
            await api.post(`/approval-tokens/${token}/reject`, { reason: rejectionReason });
            setSuccess('Visit rejected. The requester will be notified.');
            setVisit({ ...visit, status: 'rejected' });
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reject visit');
        } finally {
            setProcessing(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Not specified';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading approval details...</p>
                </div>
            </div>
        );
    }

    if (error && !visit) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
                >
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Invalid Link</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <p className="text-sm text-gray-500">
                        This approval link may have expired, been used already, or is invalid. Please contact the visitor or your security team for assistance.
                    </p>
                </motion.div>
            </div>
        );
    }

    if (success || visit?.status === 'scheduled' || visit?.status === 'rejected') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
                >
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${visit?.status === 'scheduled' ? 'bg-green-100' : 'bg-red-100'
                        }`}>
                        {visit?.status === 'scheduled' ? (
                            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        )}
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        {visit?.status === 'scheduled' ? 'Visit Approved!' : 'Visit Rejected'}
                    </h2>
                    <p className="text-gray-600 mb-6">{success}</p>
                    <div className="bg-gray-50 rounded-lg p-4 text-left">
                        <p className="text-sm text-gray-500 mb-1">Visitor</p>
                        <p className="font-medium text-gray-900">{visit?.visitorName}</p>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 py-12 px-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl mx-auto"
            >
                {/* Header */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-6">
                    <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-white">
                        <h1 className="text-2xl font-bold mb-2">🔔 Visit Approval Required</h1>
                        <p className="text-purple-100">Please review and approve or reject this visit request</p>
                    </div>

                    {/* Visit Details */}
                    <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Visitor Name</p>
                                <p className="font-semibold text-gray-900">{visit?.visitorName}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Contact</p>
                                <p className="font-medium text-gray-700">{visit?.visitorMobile || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Purpose</p>
                                <p className="font-medium text-gray-700">{visit?.purpose || 'Not specified'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Visit Type</p>
                                <p className="font-medium text-gray-700 capitalize">{visit?.visitType || 'General'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Expected Arrival</p>
                                <p className="font-medium text-gray-700">{formatDate(visit?.expectedArrival)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Expected Departure</p>
                                <p className="font-medium text-gray-700">{formatDate(visit?.expectedDeparture)}</p>
                            </div>
                        </div>

                        {visit?.notes && (
                            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1">Additional Notes</p>
                                <p className="text-gray-700">{visit.notes}</p>
                            </div>
                        )}

                        {/* Token Expiration Warning */}
                        {tokenInfo?.expiresAt && (
                            <div className="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                                <p className="text-sm text-yellow-800">
                                    <strong>⚠️ Note:</strong> This approval link expires on{' '}
                                    <strong>{formatDate(tokenInfo.expiresAt)}</strong>
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="mt-4 p-3 bg-red-50 border-l-4 border-red-400 rounded">
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="bg-white rounded-2xl shadow-xl p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Decision</h2>

                    {/* Approve Section */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Approval Notes (Optional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add any notes or conditions for approval..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            rows={2}
                        />
                        <button
                            onClick={handleApprove}
                            disabled={processing}
                            className="mt-3 w-full bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {processing ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Approve Visit
                                </>
                            )}
                        </button>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Rejection Reason (Required if rejecting)
                        </label>
                        <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Please provide a reason for rejection..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            rows={2}
                        />
                        <button
                            onClick={handleReject}
                            disabled={processing}
                            className="mt-3 w-full bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {processing ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Reject Visit
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-6 text-center text-sm text-gray-500">
                    <p>Visitor Management System • Automated Approval Request</p>
                    <p className="mt-1">If you did not expect this request, please contact your security team</p>
                </div>
            </motion.div>
        </div>
    );
}
