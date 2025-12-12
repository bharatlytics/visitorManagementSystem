// VMS Visits Module

// Utility function to format date
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

const Visits = {
    init: function () {
        this.bindEvents();
    },

    bindEvents: function () {
        $('#btn-schedule-visit').click(() => {
            $('#scheduleVisitForm')[0].reset();
            $('#scheduleVisitModal').modal('show');
            // Populate dropdowns if needed (visitors, hosts) - handled by main.js or specific loader
            this.loadDropdowns();
        });

        $('#saveVisitBtn').click(() => this.scheduleVisit());
    },

    renderTable: function () {
        if ($.fn.DataTable.isDataTable('#visits-table')) {
            $('#visits-table').DataTable().clear().destroy();
        }

        const tbody = $('#visits-table tbody');
        tbody.empty();

        let visits = state.visits || [];

        // Apply filters
        if (state.filters.entityId) {
            visits = visits.filter(v => v.locationId === state.filters.entityId || v.entityId === state.filters.entityId);
        }
        if (state.filters.hostId) {
            // Find the selected employee's name from state.employees
            const selectedEmployee = state.employees.find(e => e._id === state.filters.hostId);
            const selectedName = selectedEmployee ? (selectedEmployee.employeeName || selectedEmployee.name) : null;

            visits = visits.filter(v => {
                // Match by ID or by name (in case IDs differ between platform and local)
                return v.hostEmployeeId === state.filters.hostId ||
                    (selectedName && v.hostEmployeeName &&
                        v.hostEmployeeName.toLowerCase() === selectedName.toLowerCase());
            });
        }

        if (visits.length === 0) {
            tbody.append('<tr><td colspan="8" class="text-center py-4 text-muted">No visits found</td></tr>');
            return;
        }

        visits.forEach(visit => {
            const id = visit._id || visit.visitId;
            const shortId = id ? id.slice(-6) : 'N/A';
            const checkin = visit.actualArrival ? formatDate(visit.actualArrival) : '-';
            const checkout = visit.actualDeparture ? formatDate(visit.actualDeparture) : '-';

            let methodBadge = '-';
            if (visit.checkInMethod) {
                const m = visit.checkInMethod.toUpperCase();
                methodBadge = `<span class="badge ${m === 'FR' ? 'bg-info' : 'bg-success'}">${m}</span>`;
            }

            tbody.append(`
                <tr>
                    <td><code>${shortId}</code></td>
                    <td>
                        <div class="fw-bold">${visit.visitorName || 'Unknown'}</div>
                        <div class="small text-muted">${visit.visitorCompany || ''}</div>
                    </td>
                    <td>
                        <div class="fw-bold">${visit.hostEmployeeName || '-'}</div>
                    </td>
                    <td>${checkin}</td>
                    <td>${checkout}</td>
                    <td>${methodBadge}</td>
                    <td>${getStatusBadge(visit.status)}</td>
                    <td class="text-end">
                        <div class="btn-group btn-group-sm">
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
            pageLength: 10,
            order: [[3, 'desc']], // Sort by Check-in time by default
            drawCallback: () => this.bindRowActions()
        });

        this.bindRowActions();
    },

    getActions: function (visit) {
        let actions = '';
        actions += `<button class="btn btn-light text-primary btn-view-details" title="View Details" data-id="${visit._id}"><i class="fas fa-eye"></i></button>`;

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
        $('.btn-view-details').off('click').on('click', function () {
            Visits.viewDetails($(this).data('id'));
        });
    },

    loadDropdowns: function () {
        // Load Visitors
        VMS_API.getVisitors(state.companyId).then(data => {
            const visitors = data.visitors || [];
            const select = $('#visitVisitorId');
            select.empty().append('<option value="">-- Select Visitor --</option>');
            visitors.forEach(v => {
                select.append(`<option value="${v._id}">${v.visitorName} (${v.phone})</option>`);
            });
        });

        // Load Hosts
        VMS_API.getEmployees(state.companyId).then(data => {
            const employees = data.employees || [];
            const select = $('#visitHostId');
            select.empty().append('<option value="">-- Select Host --</option>');
            employees.forEach(e => {
                select.append(`<option value="${e._id}">${e.employeeName} (${e.department || 'N/A'})</option>`);
            });
        });
    },

    viewDetails: function (id) {
        const visit = state.visits.find(v => v._id === id || v.visitId === id);
        if (!visit) return;

        // Populate modal in read-only mode
        $('#scheduleVisitForm')[0].reset();

        // Basic Info
        $('#visitVisitorId').val(visit.visitorId).prop('disabled', true);
        $('#visitHostId').val(visit.hostEmployeeId).prop('disabled', true);
        $('#visitType').val(visit.visitType || 'guest').prop('disabled', true);
        $('#visitPurpose').val(visit.purpose).prop('disabled', true);

        // Schedule
        if (visit.expectedArrival) $('#visitExpectedArrival').val(visit.expectedArrival.slice(0, 16)).prop('disabled', true);
        if (visit.expectedDeparture) $('#visitExpectedDeparture').val(visit.expectedDeparture.slice(0, 16)).prop('disabled', true);

        // Assets
        const assets = visit.assets || {};
        $('#assetLaptop').prop('checked', assets.laptop).prop('disabled', true);
        $('#assetCamera').prop('checked', assets.camera).prop('disabled', true);
        $('#assetBag').prop('checked', assets.bag).prop('disabled', true);
        $('#visitAssetDetails').val(assets.details || '').prop('disabled', true);

        // Vehicle
        const vehicle = visit.vehicle || {};
        $('#visitVehicleNumber').val(vehicle.number || '').prop('disabled', true);

        $('#saveVisitBtn').hide();
        $('#scheduleVisitModal .modal-title').text('Visit Details');
        $('#scheduleVisitModal').modal('show');

        // Reset on close
        $('#scheduleVisitModal').on('hidden.bs.modal', function () {
            $('#scheduleVisitForm input, #scheduleVisitForm select, #scheduleVisitForm textarea').prop('disabled', false);
            $('#saveVisitBtn').show();
            $('#scheduleVisitModal .modal-title').html('<i class="fas fa-calendar-plus me-2"></i>Schedule Visit');
        });
    },

    scheduleVisit: function () {
        const visitorId = $('#visitVisitorId').val();
        const hostId = $('#visitHostId').val();
        const arrival = $('#visitExpectedArrival').val();

        if (!visitorId || !hostId || !arrival) {
            showToast('Please fill required fields (Visitor, Host, Arrival)', 'warning');
            return;
        }

        const assets = {
            laptop: $('#assetLaptop').is(':checked'),
            camera: $('#assetCamera').is(':checked'),
            pendrive: $('#assetPendrive').is(':checked'),
            mobile: $('#assetMobile').is(':checked'),
            bag: $('#assetBag').is(':checked'),
            tools: $('#assetTools').is(':checked'),
            details: $('#visitAssetDetails').val()
        };

        const facilities = {
            lunchIncluded: $('#visitLunchIncluded').is(':checked'),
            parkingRequired: $('#visitParkingRequired').is(':checked'),
            wifiAccess: $('#visitWifiAccess').is(':checked'),
            mealPreference: $('#visitMealPreference').val()
        };

        const vehicle = {
            number: $('#visitVehicleNumber').val(),
            type: $('#visitVehicleType').val(),
            driverName: $('#visitDriverName').val()
        };

        const compliance = {
            ndaRequired: $('#visitNdaRequired').is(':checked'),
            safetyBriefingRequired: $('#visitSafetyBriefing').is(':checked'),
            escortRequired: $('#visitEscortRequired').is(':checked'),
            idVerified: $('#visitIdVerified').is(':checked')
        };

        const data = {
            companyId: state.companyId,
            hostEmployeeId: hostId,
            expectedArrival: new Date(arrival).toISOString(),
            expectedDeparture: $('#visitExpectedDeparture').val() ? new Date($('#visitExpectedDeparture').val()).toISOString() : null,
            purpose: $('#visitPurpose').val(),
            visitType: $('#visitType').val(),
            locationId: $('#visitLocationId').val(),
            deviceId: $('#visitDeviceId').val(),
            durationHours: $('#visitDurationHours').val(),
            recurring: $('#visitRecurring').is(':checked'),
            requiresApproval: $('#visitRequiresApproval').is(':checked'),
            accessAreas: $('#visitAccessAreas').val() || [],
            assets: assets,
            facilities: facilities,
            vehicle: vehicle,
            compliance: compliance,
            notes: $('#visitNotes').val()
        };

        VMS_API.scheduleVisit(visitorId, data)
            .then(() => {
                $('#scheduleVisitModal').modal('hide');
                showToast('Visit scheduled successfully', 'success');
                refreshVisits();
            })
            .catch(err => showToast(err.error || 'Failed to schedule visit', 'danger'));
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
