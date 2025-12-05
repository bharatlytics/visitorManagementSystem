// VMS Visitors Module

const Visitors = {
    init: function () {
        this.bindEvents();
    },

    bindEvents: function () {
        $('#btn-add-visitor').click(() => $('#addVisitorModal').modal('show'));
        $('#saveEditVisitorBtn').click(() => this.saveVisitor());
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
            const status = visitor.blacklisted
                ? '<span class="badge bg-danger">Blacklisted</span>'
                : '<span class="badge bg-success">Active</span>';

            tbody.append(`
                <tr>
                    <td><div class="visitor-avatar">${this.getImageHtml(visitor)}</div></td>
                    <td><div class="fw-bold">${visitor.visitorName}</div></td>
                    <td>
                        <div class="small">${visitor.email || '-'}</div>
                        <div class="small text-muted">${visitor.phone || '-'}</div>
                    </td>
                    <td>${visitor.organization || '-'}</td>
                    <td>${status}</td>
                    <td class="text-end">
                        ${visitor.blacklisted
                    ? `<button class="btn btn-sm btn-light text-success unblacklist-visitor" data-id="${id}"><i class="fas fa-check-circle"></i></button>`
                    : `<button class="btn btn-sm btn-light text-danger blacklist-visitor" data-id="${id}"><i class="fas fa-ban"></i></button>`
                }
                        <button class="btn btn-sm btn-light text-primary view-visitor" data-id="${id}"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-light text-dark edit-visitor" data-id="${id}"><i class="fas fa-edit"></i></button>
                    </td>
                </tr>
            `);
        });

        $('#visitors-table').DataTable({
            language: { search: "", searchPlaceholder: "Search visitors..." },
            dom: '<"row mb-3"<"col-sm-12 col-md-6"f>>t<"row mt-3"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
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
