// VMS Dashboard Module

const Dashboard = {
    currentData: null,
    refreshInterval: null,

    init: function () {
        this.loadStats();
        this.bindModalEvents();
        this.refreshInterval = setInterval(() => this.loadStats(), 30000);
    },

    destroy: function () {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    },

    bindModalEvents: function () {
        $('#currentVisitorsModal').off('show.bs.modal').on('show.bs.modal', () => this.loadCurrentVisitorsDetail());
        $('#expectedTodayModal').off('show.bs.modal').on('show.bs.modal', () => this.loadExpectedTodayDetail());
        $('#checkedInModal').off('show.bs.modal').on('show.bs.modal', () => this.loadCheckedInDetail());
        $('#checkedOutModal').off('show.bs.modal').on('show.bs.modal', () => this.loadCheckedOutDetail());

        // Search functionality
        $('#search-current-visitors').off('keyup').on('keyup', function () {
            const value = $(this).val().toLowerCase();
            $('#current-visitors-table tbody tr').filter(function () {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });
    },

    loadStats: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        if (!companyId) return;

        VMS_API.getDashboardStats(companyId)
            .then(data => {
                this.currentData = data;
                this.updateUI(data);
            })
            .catch(err => console.error('Dashboard stats error:', err));
    },

    updateUI: function (data) {
        $('#stat-current-visitors').text(data.currentVisitors || 0);
        $('#stat-expected-today').text(data.expectedToday || 0);
        $('#stat-checked-in').text(data.checkedInToday || 0);
        $('#stat-checked-out').text(data.checkedOutToday || 0);

        // Update activity table
        const tbody = $('#activity-table tbody');
        tbody.empty();

        if (data.recentActivity && data.recentActivity.length > 0) {
            data.recentActivity.forEach(activity => {
                tbody.append(`
                    <tr>
                        <td class="fw-bold">${activity.visitorName}</td>
                        <td>${this.getActionBadge(activity.action)}</td>
                        <td class="text-muted small">${activity.time}</td>
                        <td>${activity.hostName}</td>
                    </tr>
                `);
            });
        } else {
            tbody.html('<tr><td colspan="4" class="text-center py-4 text-muted">No recent activity</td></tr>');
        }
    },

    getActionBadge: function (action) {
        let color = 'secondary';
        const a = action.toLowerCase();
        if (a.includes('check in') || a.includes('checked in')) color = 'success';
        else if (a.includes('check out') || a.includes('checked out')) color = 'warning';
        else if (a.includes('scheduled')) color = 'info';
        return `<span class="badge bg-${color}">${action}</span>`;
    },

    loadCurrentVisitorsDetail: function () {
        const tbody = $('#current-visitors-list');
        tbody.html('<tr><td colspan="6" class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></td></tr>');

        setTimeout(() => {
            if (!state.visits) {
                tbody.html('<tr><td colspan="6" class="text-center text-danger">No visit data</td></tr>');
                return;
            }

            const current = state.visits.filter(v => {
                // Filter out invalid visits: must have visitorName and actualArrival
                return v.status === 'checked_in' && v.visitorName && v.actualArrival;
            });
            tbody.empty();

            if (current.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted">No visitors inside</td></tr>');
                return;
            }

            current.forEach(visit => {
                const checkInTime = visit.actualArrival ? new Date(visit.actualArrival) : new Date();
                tbody.append(`
                    <tr>
                        <td class="fw-bold">${visit.visitorName}</td>
                        <td>${visit.hostEmployeeName || '-'}</td>
                        <td class="small">${formatTime(checkInTime)}</td>
                        <td class="small">${calculateDuration(checkInTime)}</td>
                        <td class="small">${visit.phone || '-'}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-danger" onclick="Dashboard.checkoutVisitor('${visit._id}')">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </td>
                    </tr>
                `);
            });
        }, 100);
    },

    checkoutVisitor: function (visitId) {
        if (!confirm('Check out this visitor?')) return;

        VMS_API.checkOut(visitId)
            .then(() => {
                showToast('Visitor checked out', 'success');
                refreshVisits();
                this.loadStats();
                $('#currentVisitorsModal').modal('hide');
            })
            .catch(err => showToast(err.error || 'Failed to check out', 'danger'));
    },

    loadExpectedTodayDetail: function () {
        const tbody = $('#expected-visitors-list');
        tbody.html('<tr><td colspan="4" class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></td></tr>');

        setTimeout(() => {
            // Use UTC date to match backend
            const now = new Date();
            const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            const tomorrowUTC = new Date(todayUTC);
            tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

            const expected = (state.visits || []).filter(v => {
                if (v.status !== 'scheduled' || !v.expectedArrival) return false;
                const t = new Date(v.expectedArrival);
                return t >= todayUTC && t < tomorrowUTC;
            });

            tbody.empty();
            if (expected.length === 0) {
                tbody.html('<tr><td colspan="4" class="text-center text-muted">No expected visitors</td></tr>');
                return;
            }

            expected.forEach(v => {
                tbody.append(`
                    <tr>
                        <td>${v.visitorName || 'Unknown'}</td>
                        <td>${v.hostEmployeeName || '-'}</td>
                        <td class="small">${formatTime(new Date(v.expectedArrival))}</td>
                        <td class="small">${v.purpose || '-'}</td>
                    </tr>
                `);
            });
        }, 100);
    },

    loadCheckedInDetail: function () {
        const tbody = $('#checked-in-list');
        tbody.html('<tr><td colspan="4"><div class="spinner-border spinner-border-sm"></div></td></tr>');

        setTimeout(() => {
            // Use UTC date to match backend
            const now = new Date();
            const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

            const checkedIn = (state.visits || []).filter(v => {
                if (!v.actualArrival) return false;
                return new Date(v.actualArrival) >= todayUTC;
            });

            tbody.empty();
            if (checkedIn.length === 0) {
                tbody.html('<tr><td colspan="4" class="text-center text-muted">No check-ins today</td></tr>');
                return;
            }

            checkedIn.forEach(v => {
                const status = v.status === 'checked_in'
                    ? '<span class="badge bg-success">Inside</span>'
                    : '<span class="badge bg-secondary">Left</span>';
                tbody.append(`
                    <tr>
                        <td>${v.visitorName || 'Unknown'}</td>
                        <td>${v.hostEmployeeName || '-'}</td>
                        <td class="small">${formatTime(new Date(v.actualArrival))}</td>
                        <td>${status}</td>
                    </tr>
                `);
            });
        }, 100);
    },

    loadCheckedOutDetail: function () {
        const tbody = $('#checked-out-list');
        tbody.html('<tr><td colspan="4"><div class="spinner-border spinner-border-sm"></div></td></tr>');

        setTimeout(() => {
            // Use UTC date to match backend (which uses get_current_utc())
            const now = new Date();
            const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

            const checkedOut = (state.visits || []).filter(v => {
                if (!v.actualDeparture) return false;
                const departure = new Date(v.actualDeparture);
                return departure >= todayUTC;
            });

            tbody.empty();
            if (checkedOut.length === 0) {
                tbody.html('<tr><td colspan="4" class="text-center text-muted">No check-outs today</td></tr>');
                return;
            }

            checkedOut.forEach(v => {
                const duration = v.actualArrival ? calculateDuration(v.actualArrival, v.actualDeparture) : '-';
                tbody.append(`
                    <tr>
                        <td>${v.visitorName || 'Unknown'}</td>
                        <td>${v.hostEmployeeName || '-'}</td>
                        <td class="small">${formatTime(new Date(v.actualDeparture))}</td>
                        <td class="small">${duration}</td>
                    </tr>
                `);
            });
        }, 100);
    },

    printBadge: async function (visitId) {
        // Find visit in state
        const visit = state.visits.find(v => v._id === visitId);
        if (!visit) {
            showToast('Visit details not found', 'danger');
            return;
        }

        // Fetch visitor to get photo
        let photoUrl = '/static/img/default-avatar.png';
        try {
            // Try to get visitor from state first
            let visitor = state.visitors?.find(v => v._id === visit.visitorId);

            // If visitor has images, construct URL
            if (visitor && visitor.visitorImages && visitor.visitorImages.center) {
                photoUrl = VMS_API.getVisitorImage(visitor.visitorImages.center);
            }
        } catch (e) {
            console.warn('Could not fetch visitor photo:', e);
        }

        // Open a new window for printing
        const printWindow = window.open('', '_blank', 'width=400,height=600');

        const badgeHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Visitor Badge</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f5f5f5;
        }
        .badge-card {
            width: 300px;
            background: white;
            border: 2px solid #333;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .badge-header {
            border-bottom: 2px solid #333;
            padding-bottom: 12px;
            margin-bottom: 15px;
        }
        .badge-header h2 {
            font-size: 18px;
            color: #333;
            margin-bottom: 8px;
        }
        .badge-type {
            display: inline-block;
            background: #007bff;
            color: white;
            padding: 4px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .visitor-photo {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #ddd;
            margin: 15px auto;
            display: block;
            background: #eee;
        }
        .visitor-name {
            font-size: 22px;
            font-weight: bold;
            color: #333;
            margin: 10px 0;
        }
        .details {
            text-align: left;
            margin: 20px 10px;
            font-size: 13px;
        }
        .details .row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid #eee;
        }
        .details .label { color: #666; font-weight: bold; }
        .details .value { color: #333; }
        .qr-code {
            margin: 15px auto;
        }
        .qr-code img {
            width: 100px;
            height: 100px;
        }
        .footer {
            font-size: 10px;
            color: #888;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px dashed #ddd;
        }
        @media print {
            body { background: white; }
            .badge-card { box-shadow: none; border: 2px solid #000; }
        }
    </style>
</head>
<body>
    <div class="badge-card">
        <div class="badge-header">
            <h2>VISITOR PASS</h2>
            <span class="badge-type">${visit.visitorType || 'GUEST'}</span>
        </div>
        <img class="visitor-photo" src="${photoUrl}" alt="Photo" onerror="this.style.display='none'">
        <div class="visitor-name">${visit.visitorName || 'Visitor'}</div>
        <div class="details">
            <div class="row">
                <span class="label">HOST:</span>
                <span class="value">${visit.hostEmployeeName || '-'}</span>
            </div>
            <div class="row">
                <span class="label">DATE:</span>
                <span class="value">${new Date().toLocaleDateString()}</span>
            </div>
            <div class="row">
                <span class="label">PURPOSE:</span>
                <span class="value">${visit.purpose || 'Visit'}</span>
            </div>
        </div>
        <div class="qr-code">
            <img src="/api/visitors/visits/qr/${visitId}" alt="QR Code">
        </div>
        <div class="footer">
            Please wear this badge visibly at all times.<br>
            Return badge upon exit.
        </div>
    </div>
    <script>
        window.onload = function() {
            setTimeout(function() { window.print(); }, 500);
        };
    </script>
</body>
</html>`;

        printWindow.document.write(badgeHtml);
        printWindow.document.close();
    },

    // =====================================
    // Security Dashboard
    // =====================================

    loadSecurityDashboard: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        if (!companyId) return;

        // Try API first, then fallback to local state
        VMS_API.call(`/dashboard/security?companyId=${companyId}`)
            .then(data => {
                this.renderSecurityDashboard(data);
            })
            .catch(err => {
                console.warn('Security API unavailable, using local state:', err);
                this.renderSecurityFromState();
            });
    },

    renderSecurityFromState: function () {
        // Calculate from local state
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const liveVisitors = (state.visits || []).filter(v => v.status === 'checked_in');
        const overstayed = liveVisitors.filter(v => {
            if (!v.expectedDeparture) return false;
            return new Date(v.expectedDeparture) < now;
        });
        const pending = (state.visits || []).filter(v => v.status === 'scheduled' && !v.approvedByHost);

        // Update stats
        $('#security-live-count').text(liveVisitors.length);
        $('#security-overstay-count').text(overstayed.length);
        $('#security-pending-count').text(pending.length);
        $('#live-visitor-badge').text(liveVisitors.length + ' on site');

        // Render live visitors table
        const liveTable = $('#live-visitors-tbody');
        liveTable.empty();

        if (liveVisitors.length === 0) {
            liveTable.html(`
                <tr>
                    <td colspan="5">
                        <div class="empty-state py-4">
                            <i class="fas fa-user-clock"></i>
                            <p>No visitors currently on site</p>
                        </div>
                    </td>
                </tr>
            `);
        } else {
            liveVisitors.forEach(v => {
                const checkInTime = v.actualArrival ? new Date(v.actualArrival) : new Date();
                const hoursInside = Math.round((now - checkInTime) / (1000 * 60 * 60) * 10) / 10;
                const isOverstayed = v.expectedDeparture && new Date(v.expectedDeparture) < now;
                const rowClass = isOverstayed ? 'style="background: var(--warning-light);"' : '';

                liveTable.append(`
                    <tr ${rowClass}>
                        <td>
                            <div class="d-flex align-items-center">
                                <div class="visitor-avatar-small me-3">${(v.visitorName || 'V').charAt(0).toUpperCase()}</div>
                                <div>
                                    <div class="fw-semibold">${v.visitorName || 'Unknown'}</div>
                                    <small class="text-muted">${v.visitorCompany || ''}</small>
                                </div>
                            </div>
                        </td>
                        <td>${v.hostEmployeeName || '-'}</td>
                        <td>
                            <span class="${isOverstayed ? 'text-warning fw-bold' : ''}">${hoursInside} hrs</span>
                            ${isOverstayed ? '<br><small class="text-warning">Overstayed</small>' : ''}
                        </td>
                        <td>${v.locationName || '-'}</td>
                        <td class="text-end">
                            <button class="btn btn-icon btn-outline-danger" onclick="Dashboard.forceCheckout('${v._id}')" title="Checkout">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </td>
                    </tr>
                `);
            });
        }

        // Render pending approvals
        this.renderPendingApprovals(pending);

        // Load alerts
        this.loadSecurityAlerts();
    },

    renderSecurityDashboard: function (data) {
        // Update security stats
        $('#security-live-count').text(data.liveCount || 0);
        $('#security-overstay-count').text(data.overstayedCount || 0);
        $('#security-pending-count').text(data.pendingCount || 0);
        $('#live-visitor-badge').text((data.liveCount || 0) + ' on site');

        // Render live visitors table
        const liveTable = $('#live-visitors-tbody');
        liveTable.empty();

        if (!data.liveVisitors || data.liveVisitors.length === 0) {
            liveTable.html(`
                <tr>
                    <td colspan="5">
                        <div class="empty-state py-4">
                            <i class="fas fa-user-clock"></i>
                            <p>No visitors currently on site</p>
                        </div>
                    </td>
                </tr>
            `);
        } else {
            data.liveVisitors.forEach(v => {
                const isOverstayed = v.hoursInside > 8;
                const rowClass = isOverstayed ? 'style="background: var(--warning-light);"' : '';

                liveTable.append(`
                    <tr ${rowClass}>
                        <td>
                            <div class="d-flex align-items-center">
                                <div class="visitor-avatar-small me-3">${(v.visitorName || 'V').charAt(0).toUpperCase()}</div>
                                <div>
                                    <div class="fw-semibold">${v.visitorName || 'Unknown'}</div>
                                </div>
                            </div>
                        </td>
                        <td>${v.hostEmployeeName || '-'}</td>
                        <td>${v.hoursInside || 0} hrs</td>
                        <td>${v.locationName || '-'}</td>
                        <td class="text-end">
                            <button class="btn btn-icon btn-outline-danger" onclick="Dashboard.forceCheckout('${v._id}')" title="Checkout">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </td>
                    </tr>
                `);
            });
        }

        // Render pending approvals
        this.renderPendingApprovals(data.pendingApprovals || []);

        // Render alerts
        this.loadSecurityAlerts();
    },

    loadSecurityAlerts: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');

        VMS_API.call(`/security/alerts?companyId=${companyId}`)
            .then(data => {
                const container = $('#security-alerts-container');
                container.empty();

                if (!data.alerts || data.alerts.length === 0) {
                    container.html(`
                        <div class="empty-state py-4">
                            <i class="fas fa-shield-alt"></i>
                            <p>No active alerts</p>
                        </div>
                    `);
                    return;
                }

                data.alerts.forEach(alert => {
                    container.append(`
                        <div class="alert-card alert-${alert.severity === 'critical' ? 'danger' : 'warning'}">
                            <div class="d-flex align-items-start">
                                <i class="fas fa-exclamation-circle text-${alert.severity === 'critical' ? 'danger' : 'warning'} me-2 mt-1"></i>
                                <div>
                                    <div class="fw-semibold">${alert.type}</div>
                                    <small class="text-muted">${alert.reason}</small>
                                    ${alert.visitorName ? `<br><small>${alert.visitorName}</small>` : ''}
                                </div>
                            </div>
                        </div>
                    `);
                });
            })
            .catch(err => {
                // Show no alerts on error
                $('#security-alerts-container').html(`
                    <div class="empty-state py-4">
                        <i class="fas fa-shield-alt"></i>
                        <p>No active alerts</p>
                    </div>
                `);
            });
    },

    forceCheckout: function (visitId) {
        if (!confirm('Force checkout this visitor?')) return;

        VMS_API.checkOut(visitId)
            .then(() => {
                showToast('Visitor checked out', 'success');
                this.loadSecurityDashboard();
                this.loadStats();
                refreshVisits();
            })
            .catch(err => showToast(err.error || 'Checkout failed', 'danger'));
    },

    // =====================================
    // Reports & Export
    // =====================================

    loadReportsSummary: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');

        VMS_API.call(`/dashboard/reports/summary?companyId=${companyId}`)
            .then(data => {
                this.renderReportsSummary(data);
            })
            .catch(err => {
                console.warn('Reports API unavailable, using local state:', err);
                this.renderReportsFromState();
            });
    },

    renderReportsFromState: function () {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const monthlyVisits = (state.visits || []).filter(v => {
            const created = new Date(v.createdAt || v.expectedArrival);
            return created >= startOfMonth;
        });

        // Calculate avg duration from completed visits
        const completedVisits = monthlyVisits.filter(v => v.actualArrival && v.actualDeparture);
        let avgDuration = '-';
        if (completedVisits.length > 0) {
            const totalMinutes = completedVisits.reduce((sum, v) => {
                const dur = (new Date(v.actualDeparture) - new Date(v.actualArrival)) / (1000 * 60);
                return sum + dur;
            }, 0);
            const avgMin = totalMinutes / completedVisits.length;
            avgDuration = avgMin >= 60 ? Math.round(avgMin / 60) + ' hrs' : Math.round(avgMin) + ' min';
        }

        // Count face check-ins
        const faceCount = monthlyVisits.filter(v => v.checkInMethod === 'face').length;

        $('#report-monthly-visits').text(monthlyVisits.length);
        $('#report-avg-duration').text(avgDuration);
        $('#report-face-count').text(faceCount);

        // By visitor type
        const byType = {};
        monthlyVisits.forEach(v => {
            const type = v.visitType || 'guest';
            byType[type] = (byType[type] || 0) + 1;
        });
        this.renderTypeBreakdown(byType);

        // By check-in method
        const byMethod = {};
        monthlyVisits.filter(v => v.checkInMethod).forEach(v => {
            const method = v.checkInMethod || 'manual';
            byMethod[method] = (byMethod[method] || 0) + 1;
        });
        this.renderMethodBreakdown(byMethod);

        // Peak hours
        const byHour = {};
        monthlyVisits.filter(v => v.actualArrival).forEach(v => {
            const hour = new Date(v.actualArrival).getHours();
            byHour[hour] = (byHour[hour] || 0) + 1;
        });
        this.renderPeakHours(byHour);
    },

    renderReportsSummary: function (data) {
        $('#report-monthly-visits').text(data.monthlyVisits || 0);
        $('#report-avg-duration').text(data.avgDurationMinutes ? (data.avgDurationMinutes >= 60 ? Math.round(data.avgDurationMinutes / 60) + ' hrs' : data.avgDurationMinutes + ' min') : '-');
        $('#report-face-count').text(data.faceCheckIns || 0);

        // Build lookup objects for rendering
        const byType = {};
        (data.byVisitorType || []).forEach(t => { byType[t.type] = t.count; });
        this.renderTypeBreakdown(byType);

        const byMethod = {};
        (data.byCheckInMethod || []).forEach(m => { byMethod[m.method] = m.count; });
        this.renderMethodBreakdown(byMethod);

        const byHour = {};
        (data.peakHours || []).forEach(h => { byHour[h.hour] = h.count; });
        this.renderPeakHours(byHour);
    },

    renderTypeBreakdown: function (byType) {
        const container = $('#report-by-type');
        container.empty();

        const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            container.html('<div class="empty-state py-4"><i class="fas fa-chart-pie"></i><p>No data available</p></div>');
            return;
        }

        const total = entries.reduce((sum, [_, count]) => sum + count, 0);
        entries.forEach(([type, count]) => {
            const pct = Math.round((count / total) * 100);
            const color = {
                'guest': 'primary', 'vendor': 'success', 'contractor': 'warning',
                'interview': 'info', 'delivery': 'secondary'
            }[type] || 'secondary';

            container.append(`
                <div class="mb-3">
                    <div class="d-flex justify-content-between mb-1">
                        <span class="text-capitalize fw-semibold">${type}</span>
                        <span class="text-muted">${count} (${pct}%)</span>
                    </div>
                    <div class="progress">
                        <div class="progress-bar bg-${color}" style="width: ${pct}%"></div>
                    </div>
                </div>
            `);
        });
    },

    renderMethodBreakdown: function (byMethod) {
        const container = $('#report-by-method');
        container.empty();

        const entries = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            container.html('<div class="empty-state py-4"><i class="fas fa-chart-bar"></i><p>No data available</p></div>');
            return;
        }

        entries.forEach(([method, count]) => {
            const icon = method === 'face' ? 'fa-smile text-success' : method === 'qr' ? 'fa-qrcode text-primary' : 'fa-user text-secondary';
            container.append(`
                <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
                    <div class="d-flex align-items-center">
                        <i class="fas ${icon} me-3 fs-5"></i>
                        <span class="text-capitalize fw-semibold">${method}</span>
                    </div>
                    <span class="badge badge-secondary">${count}</span>
                </div>
            `);
        });
    },

    renderPeakHours: function (byHour) {
        const container = $('#report-peak-hours');
        container.empty();

        const entries = Object.entries(byHour).map(([h, c]) => [parseInt(h), c]).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (entries.length === 0) {
            container.html('<div class="empty-state py-4"><i class="fas fa-clock"></i><p>No data available</p></div>');
            return;
        }

        const maxCount = Math.max(...entries.map(([_, c]) => c));
        entries.forEach(([hour, count]) => {
            const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
            const pct = Math.round((count / maxCount) * 100);
            container.append(`
                <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
                    <span class="fw-semibold">${label}</span>
                    <div class="d-flex align-items-center gap-2" style="width: 60%;">
                        <div class="progress flex-grow-1">
                            <div class="progress-bar bg-info" style="width: ${pct}%"></div>
                        </div>
                        <span class="text-muted small">${count}</span>
                    </div>
                </div>
            `);
        });
    },

    exportVisitsCSV: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        window.open(`/api/dashboard/reports/visits?companyId=${companyId}&format=csv`, '_blank');
    },

    // =====================================
    // Approval Workflow
    // =====================================

    loadPendingApprovals: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');

        VMS_API.call(`/dashboard/security?companyId=${companyId}`)
            .then(data => {
                this.renderPendingApprovals(data.pendingApprovals || []);
            })
            .catch(err => console.error('Approvals error:', err));
    },

    renderPendingApprovals: function (approvals) {
        const tbody = $('#pending-approvals-table tbody');
        tbody.empty();

        if (approvals.length === 0) {
            tbody.html('<tr><td colspan="5" class="text-center text-muted">No pending approvals</td></tr>');
            return;
        }

        approvals.forEach(v => {
            tbody.append(`
                <tr>
                    <td>${v.visitorName || 'Unknown'}</td>
                    <td>${v.hostEmployeeName || '-'}</td>
                    <td>${v.visitType || 'guest'}</td>
                    <td>${v.purpose || '-'}</td>
                    <td>
                        <button class="btn btn-sm btn-success me-1" onclick="Dashboard.approveVisit('${v._id}')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="Dashboard.denyVisit('${v._id}')">
                            <i class="fas fa-times"></i> Deny
                        </button>
                    </td>
                </tr>
            `);
        });
    },

    approveVisit: function (visitId) {
        VMS_API.call(`/dashboard/approvals/${visitId}/approve`, 'POST')
            .then(() => {
                showToast('Visit approved', 'success');
                this.loadPendingApprovals();
                this.loadStats();
            })
            .catch(err => showToast(err.error || 'Approval failed', 'danger'));
    },

    denyVisit: function (visitId) {
        const reason = prompt('Reason for denial (optional):');

        VMS_API.call(`/dashboard/approvals/${visitId}/deny`, 'POST', { reason })
            .then(() => {
                showToast('Visit denied', 'warning');
                this.loadPendingApprovals();
            })
            .catch(err => showToast(err.error || 'Denial failed', 'danger'));
    }
};
