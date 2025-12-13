// VMS Visitors Module

const Visitors = {
    init: function () {
        this.bindEvents();
    },

    bindEvents: function () {
        $('#btn-add-visitor').click(() => {
            this.openPreRegisterModal();
        });
        $('#saveEditVisitorBtn').click(() => this.saveVisitor());
    },

    openPreRegisterModal: function () {
        // Reset form
        const form = document.getElementById('preRegisterVisitorForm');
        if (form) form.reset();

        // Populate host dropdown
        const hostSelect = $('#preRegHostEmployeeId');
        hostSelect.empty().append('<option value="">-- Select Host --</option>');
        (state.employees || []).forEach(e => {
            hostSelect.append(`<option value="${e._id}">${e.employeeName || e.name} (${e.department || 'N/A'})</option>`);
        });

        // Bind save button
        $('#btnPreRegisterVisitor').off('click').on('click', () => this.preRegisterVisitor());

        $('#preRegisterVisitorModal').modal('show');
    },

    preRegisterVisitor: function () {
        const name = $('#preRegVisitorName').val().trim();
        const phone = $('#preRegVisitorPhone').val().trim();
        const hostId = $('#preRegHostEmployeeId').val();

        if (!name || !phone || !hostId) {
            showToast('Please fill required fields: Name, Phone, Host', 'warning');
            return;
        }

        // Build FormData for the API
        const formData = new FormData();
        formData.append('companyId', state.companyId);
        formData.append('visitorName', name);
        formData.append('phone', phone.startsWith('+91') ? phone : '+91' + phone);
        formData.append('hostEmployeeId', hostId);
        formData.append('email', $('#preRegVisitorEmail').val().trim());
        formData.append('organization', $('#preRegVisitorOrganization').val().trim());
        formData.append('visitorType', $('#preRegVisitorType').val());
        formData.append('idType', $('#preRegIdType').val());
        formData.append('idNumber', $('#preRegIdNumber').val().trim());
        formData.append('purpose', $('#preRegPurpose').val().trim());

        // Show loading
        const btn = $('#btnPreRegisterVisitor');
        const originalText = btn.html();
        btn.html('<i class="fas fa-spinner fa-spin me-2"></i>Registering...').prop('disabled', true);

        VMS_API.registerVisitor(formData)
            .then(response => {
                if (response.error) {
                    throw response;
                }

                $('#preRegisterVisitorModal').modal('hide');
                showToast('Visitor registered successfully!', 'success');

                // If "also schedule visit" is checked, open schedule modal
                if ($('#preRegScheduleVisit').is(':checked') && response._id) {
                    setTimeout(() => {
                        // Pre-select the new visitor in schedule modal
                        $('#visitVisitorId').val(response._id);
                        $('#scheduleVisitModal').modal('show');
                    }, 300);
                }

                refreshVisitors();
            })
            .catch(err => {
                console.error('Registration error:', err);
                showToast(err.error || 'Failed to register visitor', 'danger');
            })
            .finally(() => {
                btn.html(originalText).prop('disabled', false);
            });
    },


    renderTable: function () {
        if ($.fn.DataTable.isDataTable('#visitors-table')) {
            $('#visitors-table').DataTable().clear().destroy();
        }

        const tbody = $('#visitors-table tbody');
        tbody.empty();

        if (!state.visitors || state.visitors.length === 0) {
            tbody.append('<tr><td colspan="6" class="text-center py-4 text-muted">No visitors found</td></tr>');
            return;
        }

        state.visitors.forEach(visitor => {
            const id = visitor._id || visitor.visitorId;
            const statusClass = visitor.blacklisted ? 'blacklisted' : 'active';
            const statusText = visitor.blacklisted ? 'Blacklisted' : 'Active';

            tbody.append(`
                <tr>
                    <td class="visitor-avatar-cell">
                        <div class="visitor-avatar-small">${this.getImageHtml(visitor)}</div>
                    </td>
                    <td>
                        <div class="fw-bold text-dark">${visitor.visitorName}</div>
                    </td>
                    <td>
                        <div class="small text-dark">${visitor.email || '-'}</div>
                        <div class="small text-muted">${visitor.phone || '-'}</div>
                    </td>
                    <td>${visitor.organization || '-'}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td class="text-end">
                        <div class="btn-action-group">
                            ${visitor.blacklisted
                    ? `<button class="btn btn-light text-success unblacklist-visitor" title="Unblacklist" data-id="${id}"><i class="fas fa-check-circle"></i></button>`
                    : `<button class="btn btn-light text-danger blacklist-visitor" title="Blacklist" data-id="${id}"><i class="fas fa-ban"></i></button>`
                }
                            <button class="btn btn-light text-primary view-visitor" title="View Details" data-id="${id}"><i class="fas fa-eye"></i></button>
                            <button class="btn btn-light text-dark edit-visitor" title="Edit" data-id="${id}"><i class="fas fa-edit"></i></button>
                        </div>
                    </td>
                </tr>
            `);
        });

        $('#visitors-table').DataTable({
            language: {
                search: "",
                searchPlaceholder: "Search visitors...",
                lengthMenu: "Show _MENU_ entries"
            },
            dom: '<"row mb-3"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>t<"row mt-3"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
            pageLength: 10,
            drawCallback: () => this.bindRowActions()
        });

        this.bindRowActions();
    },

    bindRowActions: function () {
        $('.view-visitor').off('click').on('click', function () { Visitors.viewVisitor($(this).data('id')); });
        $('.edit-visitor').off('click').on('click', function () { Visitors.editVisitor($(this).data('id')); });
        $('.blacklist-visitor').off('click').on('click', function () { Visitors.blacklistVisitor($(this).data('id')); });
        $('.unblacklist-visitor').off('click').on('click', function () { Visitors.unblacklistVisitor($(this).data('id')); });
    },

    getImageHtml: function (visitor) {
        const images = visitor.visitorImages || visitor.faceImages || visitor.images || {};
        const imgId = images.center;

        if (imgId) {
            return `<img src="${VMS_API.getVisitorImage(imgId)}" alt="${visitor.visitorName}" 
                onerror="this.style.display='none'; this.parentElement.innerHTML='${(visitor.visitorName || '?').charAt(0).toUpperCase()}';">`;
        }
        return (visitor.visitorName || '?').charAt(0).toUpperCase();
    },

    viewVisitor: function (id) {
        const visitor = state.visitors.find(v => (v._id || v.visitorId) === id);
        if (!visitor) return;

        $('#viewVisitorName').text(visitor.visitorName || '-');
        $('#viewVisitorEmail').text(visitor.email || '-');
        $('#viewVisitorPhone').text(visitor.phone || '-');
        $('#viewVisitorOrganization').text(visitor.organization || '-');

        this.loadVisitorImages(visitor);
        this.renderHistoryTable(id);
        this.calculateAnalytics(id);

        $('#viewVisitorModal').modal('show');
    },

    editVisitor: function (id) {
        const visitor = state.visitors.find(v => (v._id || v.visitorId) === id);
        if (!visitor) return;

        $('#editVisitorId').val(id);
        $('#editVisitorName').val(visitor.visitorName || '');
        $('#editVisitorEmail').val(visitor.email || '');
        $('#editVisitorPhone').val(visitor.phone || '');
        $('#editVisitorOrganization').val(visitor.organization || '');

        $('#editVisitorModal').modal('show');
    },

    loadVisitorImages: function (visitor) {
        ['left', 'center', 'right'].forEach(pos => {
            const containerId = `viewVisitorImage${pos.charAt(0).toUpperCase() + pos.slice(1)}`;
            const container = $(`#${containerId}`);
            if (!container.length) return;

            container.html('<i class="fas fa-spinner fa-spin text-muted fa-3x"></i>');

            const images = visitor.visitorImages || visitor.faceImages || {};
            const imgId = images[pos];

            if (imgId) {
                const img = new Image();
                img.onload = () => container.html('').append(img);
                img.onerror = () => container.html('<i class="fas fa-user text-muted fa-3x"></i>');
                img.style.maxWidth = '100%';
                img.style.maxHeight = '100%';
                img.style.objectFit = 'contain';
                img.src = VMS_API.getVisitorImage(imgId);
            } else {
                container.html('<i class="fas fa-user text-muted fa-3x"></i>');
            }
        });
    },

    renderHistoryTable: function (visitorId) {
        const tbody = $('#view-visitor-history-table tbody');
        tbody.empty();

        const history = (state.visits || [])
            .filter(v => (Array.isArray(v.visitorId) ? v.visitorId[0] : v.visitorId) === visitorId)
            .sort((a, b) => new Date(b.expectedArrival) - new Date(a.expectedArrival));

        if (history.length === 0) {
            tbody.append('<tr><td colspan="7" class="text-center text-muted">No visit history</td></tr>');
            return;
        }

        history.forEach(v => {
            const visitId = v._id || v.visitId;
            const shortId = visitId ? visitId.slice(-6) : 'N/A';
            const checkin = v.actualArrival ? formatDate(v.actualArrival) : (v.status === 'scheduled' ? 'Pending' : '-');
            const checkout = v.actualDeparture ? formatDate(v.actualDeparture) : (v.status === 'checked_in' ? 'In Progress' : '-');

            let methodBadge = '-';
            if (v.checkInMethod) {
                const m = v.checkInMethod.toUpperCase();
                methodBadge = `<span class="badge ${m === 'FR' ? 'bg-info' : 'bg-success'}">${m}</span>`;
            }

            tbody.append(`
                <tr>
                    <td><code class="small">${shortId}</code></td>
                    <td class="small">${v.hostEmployeeName || '-'}</td>
                    <td class="small">${v.purpose || '-'}</td>
                    <td class="small">${checkin}</td>
                    <td class="small">${checkout}</td>
                    <td>${methodBadge}</td>
                    <td>${getStatusBadge(v.status)}</td>
                </tr>
            `);
        });
    },

    calculateAnalytics: function (visitorId) {
        const visits = (state.visits || []).filter(v =>
            (Array.isArray(v.visitorId) ? v.visitorId[0] : v.visitorId) === visitorId
        );

        $('#viewTotalVisits').text(visits.length);
        $('#viewCompletedVisits').text(visits.filter(v => v.status === 'checked_out').length);
        $('#viewScheduledVisits').text(visits.filter(v => v.status === 'scheduled').length);
        $('#viewCancelledVisits').text(visits.filter(v => v.status === 'cancelled').length);

        const recent = visits.sort((a, b) => new Date(b.expectedArrival) - new Date(a.expectedArrival)).slice(0, 3);
        const container = $('#viewRecentActivity');

        if (recent.length === 0) {
            container.html('<p class="text-muted small">No recent activity</p>');
        } else {
            container.html(recent.map(v => `
                <div class="mb-2 pb-2 border-bottom">
                    <div class="small fw-bold">${v.purpose || 'Visit'}</div>
                    <div class="small text-muted">${formatDate(v.expectedArrival)} - ${(v.status || '').replace('_', ' ').toUpperCase()}</div>
                </div>
            `).join(''));
        }
    },

    saveVisitor: function () {
        const id = $('#editVisitorId').val();
        if (!id) return;

        VMS_API.updateVisitor({
            visitorId: id,
            visitorName: $('#editVisitorName').val(),
            phone: $('#editVisitorPhone').val(),
            email: $('#editVisitorEmail').val(),
            organization: $('#editVisitorOrganization').val()
        })
            .then(() => {
                $('#editVisitorModal').modal('hide');
                showToast('Visitor updated', 'success');
                refreshVisitors();
            })
            .catch(err => showToast(err.error || 'Failed to update', 'danger'));
    },

    blacklistVisitor: function (id) {
        const reason = prompt("Enter reason for blacklisting:");
        if (reason === null) return;

        VMS_API.blacklistVisitor(id, reason)
            .then(() => { showToast('Visitor blacklisted', 'success'); refreshVisitors(); })
            .catch(err => showToast(err.error || 'Failed', 'danger'));
    },

    unblacklistVisitor: function (id) {
        if (!confirm('Unblacklist this visitor?')) return;

        VMS_API.unblacklistVisitor(id)
            .then(() => { showToast('Visitor unblacklisted', 'success'); refreshVisitors(); })
            .catch(err => showToast(err.error || 'Failed', 'danger'));
    }
};
