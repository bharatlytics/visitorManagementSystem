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

            const current = state.visits.filter(v => v.status === 'checked_in');
            tbody.empty();

            if (current.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted">No visitors inside</td></tr>');
                return;
            }

            current.forEach(visit => {
                const checkInTime = visit.actualArrival ? new Date(visit.actualArrival) : new Date();
                tbody.append(`
                    <tr>
                        <td class="fw-bold">${visit.visitorName || 'Unknown'}</td>
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
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const expected = (state.visits || []).filter(v => {
                if (v.status !== 'scheduled' || !v.expectedArrival) return false;
                const t = new Date(v.expectedArrival);
                return t >= today && t < tomorrow;
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
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const checkedIn = (state.visits || []).filter(v => {
                if (!v.actualArrival) return false;
                return new Date(v.actualArrival) >= today;
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
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const checkedOut = (state.visits || []).filter(v => {
                if (!v.actualDeparture) return false;
                return new Date(v.actualDeparture) >= today;
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
    }
};
