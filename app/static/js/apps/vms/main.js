// VMS Main Entry Point

const state = {
    companyId: null,
    company: null,       // Company details
    isConnected: false,  // Connected to Bharatlytics platform
    platformUrl: null,   // Platform return URL
    userRole: 'admin',   // 'admin' or 'employee'
    userId: null,        // Current user ID
    visitors: [],
    visits: [],
    employees: [],
    entities: [],
    filters: { entityId: null, hostId: null },
    currentView: 'dashboard',
    initialized: false
};

$(document).ready(function () {
    init();
});

async function init() {
    // Toggle sidebar
    $('#menu-toggle').click(function (e) {
        e.preventDefault();
        $('#wrapper').toggleClass('toggled');
    });

    setupNavigation();

    // Initialize modules
    Visitors.init();
    Visits.init();

    // Check connection mode and get company ID (wait for auth)
    await detectConnectionMode();

    // Apply permissions based on role
    applyRolePermissions();

    // Update UI after we have auth info
    updateModeIndicator();

    // Only load data if we have a valid company ID
    if (state.companyId) {
        loadCompanyDetails();
        loadData();
    } else {
        console.warn('No company ID available - skipping data load');
        showToast('Please login to view data', 'warning');
    }

    // If employee tries to access restricted view, redirect to dashboard
    if (state.userRole === 'employee' && ['settings', 'visitors'].includes(state.currentView)) {
        state.currentView = 'dashboard';
    }

    switchView(state.currentView);
    state.initialized = true;

    // Filter handlers
    $(document).on('change', '#filter-entity-visits, #filter-host-visits', function () {
        state.filters.entityId = $('#filter-entity-visits').val() || null;
        state.filters.hostId = $('#filter-host-visits').val() || null;
        if (state.currentView === 'visits') Visits.renderTable();
    });
}

async function detectConnectionMode() {
    const pathParts = window.location.pathname.split('/');
    const urlParams = new URLSearchParams(window.location.search);

    // 1. Check URL for /companies/{id} pattern
    if (pathParts.includes('companies') && pathParts.length >= 3) {
        state.companyId = pathParts[pathParts.indexOf('companies') + 1];
        state.isConnected = true;
        state.platformUrl = `/companies/${state.companyId}`;
    }

    // 2. Check query params
    if (urlParams.get('companyId')) {
        state.companyId = urlParams.get('companyId');
        state.isConnected = urlParams.get('connected') === 'true' || state.isConnected;
    }

    // 3. Check localStorage
    if (!state.companyId) {
        state.companyId = localStorage.getItem('companyId');
        if (localStorage.getItem('isConnected') === 'true') {
            state.isConnected = true;
            state.platformUrl = localStorage.getItem('platformUrl') || `/companies/${state.companyId}`;
        }
    }

    // 4. Check auth endpoint (most authoritative source)
    try {
        const response = await fetch('/auth/me');
        if (response.ok) {
            const data = await response.json();
            if (data.company_id) {
                state.companyId = data.company_id;
                state.userId = data.user_id;

                // Get user details from local storage if available to check role
                const userStr = localStorage.getItem('user');
                if (userStr) {
                    const user = JSON.parse(userStr);
                    state.userRole = user.role || 'admin'; // Default to admin for backward compatibility
                }

                localStorage.setItem('companyId', data.company_id);
            }
            if (data.connected !== undefined) {
                state.isConnected = data.connected;
                if (data.connected) {
                    localStorage.setItem('isConnected', 'true');
                }
                if (data.platform_url) {
                    state.platformUrl = data.platform_url;
                    localStorage.setItem('platformUrl', data.platform_url);
                }
                // Get company details from auth response (connected mode)
                if (data.company) {
                    state.company = data.company;
                    updateCompanyBranding();
                }
            }
        }
    } catch (e) {
        console.warn('Auth check failed:', e);
    }
}

function applyRolePermissions() {
    if (state.userRole === 'employee') {
        // Hide sidebar items
        $('#nav-settings, #nav-visitors').hide();

        // Hide quick actions that aren't allowed
        // (Assuming employees can schedule visits but not register visitors directly)
        $('button[onclick*="switchView(\'visitors\')"]').parent().hide();

        // Update dashboard title to reflect restricted view
        $('#page-title').append(' <small class="text-muted">(Employee View)</small>');
    } else {
        $('#nav-settings, #nav-visitors').show();
    }
}

function updateModeIndicator() {
    const indicator = $('#mode-indicator');
    const roleBadge = state.userRole === 'admin'
        ? '<span class="badge bg-primary ms-2">Admin</span>'
        : '<span class="badge bg-info ms-2">Employee</span>';

    if (state.isConnected) {
        indicator.html(`
            <span class="badge bg-success d-flex align-items-center">
                <i class="fas fa-link me-1"></i> Connected to Bharatlytics
            </span>
            ${roleBadge}
        `);
    } else {
        indicator.html(`
            <span class="badge bg-secondary d-flex align-items-center">
                <i class="fas fa-hdd me-1"></i> Standalone Mode
            </span>
            ${roleBadge}
        `);
    }
}

function loadCompanyDetails() {
    if (!state.companyId) return;

    const apiUrl = `/api/companies/${state.companyId}`;

    fetch(apiUrl)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (data && data.company) {
                state.company = data.company;
                updateCompanyBranding();
            }
        })
        .catch(err => console.warn('Could not load company details:', err));
}

function updateCompanyBranding() {
    if (!state.company) return;

    const $logo = $('#sidebar-logo');
    const $title = $('#sidebar-title');
    const companyName = state.company.name || 'VMS';

    // Update page title
    if (state.company.name) {
        document.title = `VMS - ${state.company.name}`;
    }

    // If logo is already loaded and visible, don't change anything
    if ($logo.attr('src') && !$logo.hasClass('d-none') && $logo.data('loaded')) {
        return;
    }

    // If logo URL exists, try to show it
    if (state.company.logo) {
        $logo
            .off('error load')  // Remove previous handlers
            .on('error', function () {
                // Logo failed to load - hide logo, show text
                $(this).addClass('d-none').data('loaded', false);
                $title.text(companyName).removeClass('d-none');
            })
            .on('load', function () {
                // Logo loaded successfully - hide text, mark as loaded
                $(this).data('loaded', true);
                $title.addClass('d-none');
            })
            .attr('src', state.company.logo)
            .removeClass('d-none');
    } else {
        // No logo URL - show company name text
        $logo.addClass('d-none').data('loaded', false);
        $title.text(companyName).removeClass('d-none');
    }
}

function setupNavigation() {
    $('.list-group-item').click(function (e) {
        e.preventDefault();
        const id = $(this).attr('id');

        if (id === 'nav-exit') {
            exitApp();
            return;
        }

        $('.list-group-item').removeClass('active');
        $(this).addClass('active');

        switchView(id.replace('nav-', ''));
    });

    window.switchView = switchView;
}

function exitApp() {
    if (state.isConnected && state.platformUrl) {
        // Return to platform company page
        window.location.href = state.platformUrl;
    } else if (state.isConnected && state.companyId) {
        window.location.href = `/companies/${state.companyId}`;
    } else {
        // Standalone: logout and go to login
        fetch('/auth/logout', { method: 'POST' })
            .finally(() => {
                localStorage.clear();
                window.location.href = '/';
            });
    }
}

function switchView(viewName) {
    // Permission check
    if (state.userRole === 'employee' && ['settings', 'visitors'].includes(viewName)) {
        showToast('Access Denied', 'danger');
        return;
    }

    state.currentView = viewName;

    $('.list-group-item').removeClass('active');
    $(`#nav-${viewName}`).addClass('active');

    $('#view-dashboard, #view-visitors, #view-visits, #view-settings').css('display', 'none');
    $(`#view-${viewName}`).css('display', 'block');

    $('#page-title').text(viewName.charAt(0).toUpperCase() + viewName.slice(1));

    // Re-apply role indicator to title
    if (state.userRole === 'employee') {
        $('#page-title').append(' <small class="text-muted">(Employee View)</small>');
    }

    if (viewName === 'dashboard') {
        Dashboard.loadStats();
        Dashboard.bindModalEvents();
    }
    if (viewName === 'visitors') refreshVisitors();
    if (viewName === 'visits') refreshVisits();
}

function loadData() {
    if (!state.companyId) {
        console.warn('Cannot load data: no companyId');
        return;
    }

    // Load employees
    VMS_API.getEmployees(state.companyId)
        .then(data => {
            state.employees = Array.isArray(data) ? data : [];
            populateHostSelect();
            populateFilterDropdowns();
        })
        .catch(err => console.warn('Failed to load employees:', err));

    // Load entities
    VMS_API.getEntities(state.companyId)
        .then(data => {
            state.entities = Array.isArray(data) ? data : [];
            populateFilterDropdowns();
        })
        .catch(err => console.warn('Failed to load entities:', err));

    refreshVisitors();
    refreshVisits();
}

function populateFilterDropdowns() {
    ['#filter-entity-visitors', '#filter-entity-visits'].forEach(sel => {
        const $select = $(sel);
        if ($select.length) {
            $select.empty().append('<option value="">All Entities</option>');
            state.entities.forEach(e => {
                $select.append(`<option value="${e._id}">${e.name || 'Unnamed'} (${e.type || 'entity'})</option>`);
            });
        }
    });

    const $hostSelect = $('#filter-host-visits');
    if ($hostSelect.length && state.employees.length) {
        $hostSelect.empty().append('<option value="">All Hosts</option>');
        state.employees.forEach(e => {
            $hostSelect.append(`<option value="${e._id}">${e.employeeName || e.name || 'Unknown'}</option>`);
        });
    }
}

function refreshVisitors() {
    if (!state.companyId) return;

    // Employees cannot view visitor directory
    if (state.userRole === 'employee') return;

    VMS_API.getVisitors(state.companyId)
        .then(data => {
            state.visitors = deduplicate(Array.isArray(data) ? data : (data.visitors || []));
            if (state.currentView === 'visitors') Visitors.renderTable();
            populateVisitorSelect();
        })
        .catch(err => console.error('Failed to load visitors:', err));
}

function refreshVisits() {
    if (!state.companyId) return;

    VMS_API.getVisits(state.companyId)
        .then(data => {
            let visits = deduplicate(data.visits || []);

            // Filter for employees: only show visits where they are the host
            // Note: This relies on matching names or IDs. Ideally backend should filter.
            // For now, we'll try to match by host name since that's what we have in the table often
            if (state.userRole === 'employee') {
                // We need the current user's name or ID to filter
                // state.userId is available from /auth/me
                // But visits usually have hostId. Let's check if we can match.
                if (state.userId) {
                    // Try to find employee record to get all details
                    const me = state.employees.find(e => e._id === state.userId || e.userId === state.userId);
                    const myName = me ? (me.employeeName || me.name) : null;

                    visits = visits.filter(v => {
                        return v.hostId === state.userId || (myName && v.hostEmployeeName === myName);
                    });
                }
            }

            state.visits = visits;
            if (state.currentView === 'visits') Visits.renderTable();
        })
        .catch(err => {
            console.error('Failed to load visits:', err);
            state.visits = [];
        });
}

function populateVisitorSelect() {
    const select = $('#visitVisitorId');
    select.empty().append('<option value="">Select Visitor</option>');
    state.visitors.forEach(v => {
        select.append(`<option value="${v._id || v.visitorId}">${v.visitorName}</option>`);
    });
}

function populateHostSelect() {
    const select = $('#visitHostId');
    select.empty().append('<option value="">Select Host</option>');
    state.employees.forEach(e => {
        select.append(`<option value="${e._id || e.employeeId}">${e.employeeName || e.name}</option>`);
    });
}
