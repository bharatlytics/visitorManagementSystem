// VMS Settings Module - Full Enterprise Configuration

const Settings = {
    currentSettings: null,
    devices: [],
    locations: [],

    init: function () {
        this.loadSettings();
        this.bindEvents();
        this.loadLocations();
    },

    bindEvents: function () {
        $('#saveSettingsBtn').off('click').on('click', () => this.saveSettings());
        $('#addDeviceBtn').off('click').on('click', () => this.showAddDeviceModal());
        $('#saveDeviceBtn').off('click').on('click', () => this.saveDevice());
        $('#addLocationBtn').off('click').on('click', () => this.showAddLocationModal());
        $('#saveLocationBtn').off('click').on('click', () => this.saveLocation());
    },

    loadSettings: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        if (!companyId) return;

        VMS_API.getSettings(companyId)
            .then(data => {
                this.currentSettings = data;
                this.devices = data.devices || [];
                this.updateUI(data);
            })
            .catch(err => {
                console.error('Failed to load settings:', err);
                showToast('Failed to load settings', 'danger');
            });
    },

    updateUI: function (settings) {
        // General Settings
        $('#setting-auto-checkout-hours').val(settings.autoCheckoutHours || 8);
        $('#setting-require-approval').prop('checked', settings.requireApproval || false);

        // Notifications
        const notif = settings.notifications || {};
        $('#notif-email').prop('checked', notif.email !== false);
        $('#notif-sms').prop('checked', notif.sms === true);
        $('#notif-whatsapp').prop('checked', notif.whatsapp === true);

        // Visitor Types
        const types = settings.visitorTypes || ['guest', 'vendor', 'contractor', 'interview', 'vip'];
        $('#setting-visitor-types').val(types.join(', '));

        // Devices Table
        this.renderDevicesTable();
    },

    renderDevicesTable: function () {
        const tbody = $('#devices-table tbody');
        tbody.empty();

        if (this.devices.length === 0) {
            tbody.html('<tr><td colspan="5" class="text-center text-muted py-4">No devices configured</td></tr>');
            return;
        }

        this.devices.forEach(device => {
            const statusClass = device.status === 'active' ? 'success' : 'secondary';
            tbody.append(`
                <tr>
                    <td><strong>${device.name}</strong></td>
                    <td><span class="badge bg-info">${device.type}</span></td>
                    <td>${device.entityName || '-'}</td>
                    <td><span class="badge bg-${statusClass}">${device.status}</span></td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="Settings.editDevice('${device._id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="Settings.deleteDevice('${device._id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `);
        });
    },

    saveSettings: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        if (!companyId) return;

        const autoCheckoutHours = parseInt($('#setting-auto-checkout-hours').val());

        if (isNaN(autoCheckoutHours) || autoCheckoutHours < 1 || autoCheckoutHours > 48) {
            showToast('Auto-checkout hours must be between 1 and 48', 'warning');
            return;
        }

        const settingsData = {
            autoCheckoutHours,
            requireApproval: $('#setting-require-approval').is(':checked'),
            notifications: {
                email: $('#notif-email').is(':checked'),
                sms: $('#notif-sms').is(':checked'),
                whatsapp: $('#notif-whatsapp').is(':checked')
            },
            visitorTypes: $('#setting-visitor-types').val().split(',').map(t => t.trim()).filter(t => t)
        };

        VMS_API.updateSettings(companyId, settingsData)
            .then(() => {
                showToast('Settings saved successfully', 'success');
                this.loadSettings();
            })
            .catch(err => {
                console.error('Failed to save settings:', err);
                showToast(err.error || 'Failed to save settings', 'danger');
            });
    },

    // Device Management
    showAddDeviceModal: function () {
        $('#deviceModalLabel').text('Add Device');
        $('#deviceForm')[0].reset();
        $('#deviceId').val('');

        // Populate entities dropdown
        const entitySelect = $('#deviceEntity');
        entitySelect.empty().append('<option value="">-- Select Location --</option>');
        (state.entities || []).forEach(e => {
            entitySelect.append(`<option value="${e._id}" data-name="${e.name}">${e.name}</option>`);
        });

        $('#deviceModal').modal('show');
    },

    editDevice: function (deviceId) {
        const device = this.devices.find(d => d._id === deviceId);
        if (!device) return;

        $('#deviceModalLabel').text('Edit Device');
        $('#deviceId').val(device._id);
        $('#deviceName').val(device.name);
        $('#deviceType').val(device.type);
        $('#deviceMode').val(device.mode);
        $('#deviceStatus').val(device.status);

        // Populate entities dropdown
        const entitySelect = $('#deviceEntity');
        entitySelect.empty().append('<option value="">-- Select Location --</option>');
        (state.entities || []).forEach(e => {
            entitySelect.append(`<option value="${e._id}" data-name="${e.name}" ${e._id === device.entityId ? 'selected' : ''}>${e.name}</option>`);
        });

        $('#deviceModal').modal('show');
    },

    saveDevice: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        const deviceId = $('#deviceId').val();
        const entitySelect = $('#deviceEntity');

        const deviceData = {
            companyId,
            name: $('#deviceName').val(),
            type: $('#deviceType').val(),
            mode: $('#deviceMode').val(),
            status: $('#deviceStatus').val(),
            entityId: entitySelect.val() || null,
            entityName: entitySelect.find(':selected').data('name') || ''
        };

        if (!deviceData.name) {
            showToast('Device name is required', 'warning');
            return;
        }

        const apiCall = deviceId
            ? VMS_API.call(`/settings/devices/${deviceId}`, 'PUT', deviceData)
            : VMS_API.call('/settings/devices', 'POST', deviceData);

        apiCall
            .then(() => {
                showToast(deviceId ? 'Device updated' : 'Device added', 'success');
                $('#deviceModal').modal('hide');
                this.loadSettings();
            })
            .catch(err => {
                showToast(err.error || 'Failed to save device', 'danger');
            });
    },

    deleteDevice: function (deviceId) {
        if (!confirm('Are you sure you want to delete this device?')) return;

        VMS_API.call(`/settings/devices/${deviceId}`, 'DELETE')
            .then(() => {
                showToast('Device deleted', 'success');
                this.loadSettings();
            })
            .catch(err => {
                showToast(err.error || 'Failed to delete device', 'danger');
            });
    },

    // =====================================
    // Location Management (VMS Domain)
    // =====================================

    loadLocations: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        if (!companyId) return;

        VMS_API.call(`/settings/locations?companyId=${companyId}`)
            .then(data => {
                this.locations = data || [];
                state.locations = this.locations;
                this.renderLocationsTable();
            })
            .catch(err => {
                console.error('Failed to load locations:', err);
            });
    },

    renderLocationsTable: function () {
        const tbody = $('#locations-table tbody');
        if (!tbody.length) return; // Element not in DOM yet

        tbody.empty();

        if (!this.locations || this.locations.length === 0) {
            tbody.html('<tr><td colspan="5" class="text-center text-muted py-3">No locations configured</td></tr>');
            return;
        }

        this.locations.forEach(loc => {
            const statusClass = loc.status === 'active' ? 'success' : 'secondary';
            tbody.append(`
                <tr>
                    <td><strong>${loc.name}</strong></td>
                    <td><span class="badge bg-info">${loc.type || 'gate'}</span></td>
                    <td>${loc.address || '-'}</td>
                    <td><span class="badge bg-${statusClass}">${loc.status || 'active'}</span></td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="Settings.editLocation('${loc._id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="Settings.deleteLocation('${loc._id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `);
        });
    },

    showAddLocationModal: function () {
        $('#locationModalLabel').text('Add Location');
        $('#locationForm')[0]?.reset();
        $('#locationId').val('');
        $('#locationModal').modal('show');
    },

    editLocation: function (locationId) {
        const loc = this.locations.find(l => l._id === locationId);
        if (!loc) return;

        $('#locationModalLabel').text('Edit Location');
        $('#locationId').val(loc._id);
        $('#locationName').val(loc.name);
        $('#locationType').val(loc.type || 'gate');
        $('#locationAddress').val(loc.address || '');
        $('#locationStatus').val(loc.status || 'active');

        $('#locationModal').modal('show');
    },

    saveLocation: function () {
        const companyId = state?.companyId || localStorage.getItem('companyId');
        const locationId = $('#locationId').val();

        const locationData = {
            companyId,
            name: $('#locationName').val(),
            type: $('#locationType').val(),
            address: $('#locationAddress').val(),
            status: $('#locationStatus').val()
        };

        if (!locationData.name) {
            showToast('Location name is required', 'warning');
            return;
        }

        const apiCall = locationId
            ? VMS_API.call(`/settings/locations/${locationId}`, 'PUT', locationData)
            : VMS_API.call('/settings/locations', 'POST', locationData);

        apiCall
            .then(() => {
                showToast(locationId ? 'Location updated' : 'Location added', 'success');
                $('#locationModal').modal('hide');
                this.loadLocations();
            })
            .catch(err => {
                showToast(err.error || 'Failed to save location', 'danger');
            });
    },

    deleteLocation: function (locationId) {
        if (!confirm('Are you sure you want to delete this location?')) return;

        VMS_API.call(`/settings/locations/${locationId}`, 'DELETE')
            .then(() => {
                showToast('Location deleted', 'success');
                this.loadLocations();
            })
            .catch(err => {
                showToast(err.error || 'Failed to delete location', 'danger');
            });
    }
};

