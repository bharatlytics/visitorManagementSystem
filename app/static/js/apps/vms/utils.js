// VMS Utility functions

function formatDate(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function deduplicate(arr) {
    const unique = new Map();
    arr.forEach(item => {
        const id = item._id || item.visitorId || item.visitId;
        if (id) unique.set(id.toString(), item);
    });
    return Array.from(unique.values());
}

function getStatusBadge(status) {
    const map = {
        'scheduled': 'bg-primary',
        'checked_in': 'bg-success',
        'checked_out': 'bg-secondary',
        'cancelled': 'bg-danger'
    };
    const label = status ? status.replace('_', ' ').toUpperCase() : 'UNKNOWN';
    return `<span class="badge ${map[status] || 'bg-secondary'}">${label}</span>`;
}

function showToast(message, type = 'info') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        toastContainer.style.zIndex = '1100';
        document.body.appendChild(toastContainer);
    }

    const toastId = 'toast-' + Date.now();
    const html = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    toastContainer.insertAdjacentHTML('beforeend', html);
    
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 3000 });
    toast.show();

    toastElement.addEventListener('hidden.bs.toast', function () {
        this.remove();
    });
}

function calculateDuration(startTime, endTime = new Date()) {
    const diff = Math.abs(new Date(endTime) - new Date(startTime));
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTime(date) {
    const d = new Date(date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr}, ${timeStr}`;
}
