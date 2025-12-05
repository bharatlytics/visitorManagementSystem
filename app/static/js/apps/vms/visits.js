// VMS Visits Module

const Visits = {
    init: function () {
        this.bindEvents();
    },

    bindEvents: function () {
        $('#btn-schedule-visit').click(() => {
            $('#visitForm')[0].reset();
            $('#visitModal').modal('show');
        });

        $('#saveVisitBtn').click(() => this.scheduleVisit());
    },

    renderTable: function () {
        const tbody = $('#visits-table tbody');
        tbody.empty();

        if ($.fn.DataTable.isDataTable('#visits-table')) {
            $('#visits-table').DataTable().destroy();
        }

        // Apply host filter if active
        let filtered = state.visits || [];
        if (state.filters?.hostId) {
            filtered = filtered.filter(v => (v.hostEmployeeId || v.hostId) === state.filters.hostId);
        }

        if (filtered.length === 0) {
            tbody.append('<tr><td colspan="8" class="text-center py-4 text-muted">No visits found</td></tr>');
            return;
        }

        filtered.forEach(visit => {
            const visitId = visit._id || visit.visitId;
            const shortId = visitId ? visitId.slice(-6) : 'N/A';
            const checkin = visit.actualArrival ? formatDate(visit.actualArrival) : (visit.status === 'scheduled' ? 'Pending' : '-');
            const checkout = visit.actualDeparture ? formatDate(visit.actualDeparture) : (visit.status === 'checked_in' ? 'In Progress' : '-');

            let methodBadge = '-';
            if (visit.checkInMethod) {
                const m = visit.checkInMethod.toUpperCase();
                methodBadge = `<span class="badge ${m === 'FR' ? 'bg-info' : 'bg-success'}">${m}</span>`;
            }

            const statusClass = (visit.status || '').toLowerCase();
            const statusText = (visit.status || '').replace('_', ' ').toUpperCase();

            tbody.append(`
                <tr>
                    <td><code class="small text-muted">${shortId}</code></td>
                    <td>
                        <div class="fw-bold text-dark">${visit.visitorName || 'Unknown'}</div>
                        <div class="small text-muted">${visit.visitorMobile || ''}</div>
                    </td>
                    <td>${visit.hostEmployeeName || 'Unknown'}</td>
                    <td class="small">${checkin}</td>
                    <td class="small">${checkout}</td>
                    <td>${methodBadge}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td class="text-end">
                        <div class="btn-action-group">
                            ${this.getActions(visit)}
                        </div>
                    </td>
                </tr>
            `);
        });

        $('#visits-table').DataTable({
            language: {
                search: "",
                searchPlaceholder: "Search visits...",
                lengthMenu: "Show _MENU_ entries"
            },
            dom: '<"row mb-3"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>t<"row mt-3"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
            order: [[3, 'desc']]
        });

        this.bindRowActions();
    },

    getActions: function (visit) {
        let actions = '';
        if (visit.status === 'scheduled') {
            actions += `<button class="btn btn-light text-success btn-checkin" title="Check In" data-id="${visit._id}"><i class="fas fa-sign-in-alt"></i></button>`;
        }
        if (visit.status === 'checked_in') {
            actions += `<button class="btn btn-light text-warning btn-checkout" title="Check Out" data-id="${visit._id}"><i class="fas fa-sign-out-alt"></i></button>`;
        }
        actions += `<button class="btn btn-light text-info btn-pass" title="View Pass" data-id="${visit._id}"><i class="fas fa-id-badge"></i></button>`;
        return actions;
    },

    bindRowActions: function () {
        $('.btn-checkin').off('click').on('click', function () {
            Visits.updateStatus($(this).data('id'), 'check-in');
        });
        $('.btn-checkout').off('click').on('click', function () {
            Visits.updateStatus($(this).data('id'), 'check-out');
        });
        $('.btn-pass').off('click').on('click', function () {
            Visits.showPass($(this).data('id'));
        });
    },

    scheduleVisit: function () {
        const visitorId = $('#visitVisitorId').val();
        const hostId = $('#visitHostId').val();
        const arrival = $('#visitArrival').val();

        if (!visitorId || !hostId || !arrival) {
            alert('Please fill required fields');
            return;
        }

        const data = {
            companyId: state.companyId,
            hostEmployeeId: hostId,
            expectedArrival: new Date(arrival).toISOString(),
            expectedDeparture: $('#visitDeparture').val() ? new Date($('#visitDeparture').val()).toISOString() : null,
            purpose: $('#visitPurpose').val()
        };

        VMS_API.scheduleVisit(visitorId, data)
            .then(() => {
                $('#visitModal').modal('hide');
                showToast('Visit scheduled', 'success');
                refreshVisits();
            })
            .catch(err => showToast(err.error || 'Failed to schedule', 'danger'));
    },

    updateStatus: function (id, action) {
        const apiCall = action === 'check-in' ? VMS_API.checkIn(id) : VMS_API.checkOut(id);

        apiCall
            .then(() => {
                showToast(`Visit ${action.replace('-', ' ')}`, 'success');
                refreshVisits();
            })
            .catch(err => showToast(err.error || 'Failed', 'danger'));
    },

    showPass: function (id) {
        $('#passModal').modal('show');
        const container = $('#passContainer');
        container.html('<div class="spinner-border text-primary"></div>');

        const img = new Image();
        img.onload = () => container.html('').append(img);
        img.onerror = () => container.html('<p class="text-danger">Failed to load badge</p>');
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.border = '1px solid #ddd';
        img.src = VMS_API.getVisitBadge(id);

        $('#btnPrintPass').off('click').on('click', function () {
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                    <head><title>Visitor Badge</title></head>
                    <body style="text-align:center; padding: 0; margin: 0;">
                        <img src="${img.src}" style="max-width: 100%;">
                        <script>window.onload = function() { window.print(); window.close(); }<\/script>
                    </body>
                </html>
            `);
            printWindow.document.close();
        });
    }
};
