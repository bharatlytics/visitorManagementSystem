// Component Loader Utility
// Dynamically loads HTML components from /static/components/

const ComponentLoader = {
    loaded: {},

    /**
     * Load a component and inject it into a target element
     * @param {string} componentName - Name of component file (without .html)
     * @param {string} targetSelector - CSS selector for target container
     * @returns {Promise} - Resolves when component is loaded
     */
    load: function (componentName, targetSelector) {
        const url = `/static/components/${componentName}.html`;
        const target = document.querySelector(targetSelector);

        if (!target) {
            console.error(`Component target not found: ${targetSelector}`);
            return Promise.reject(new Error('Target not found'));
        }

        if (this.loaded[componentName]) {
            return Promise.resolve();
        }

        return fetch(url)
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load ${componentName}`);
                return response.text();
            })
            .then(html => {
                target.insertAdjacentHTML('beforeend', html);
                this.loaded[componentName] = true;
                console.log(`[ComponentLoader] Loaded: ${componentName}`);
            })
            .catch(err => {
                console.error(`[ComponentLoader] Error loading ${componentName}:`, err);
            });
    },

    /**
     * Load multiple components
     * @param {Array} components - Array of {name, target} objects
     * @returns {Promise} - Resolves when all components are loaded
     */
    loadAll: function (components) {
        return Promise.all(components.map(c => this.load(c.name, c.target)));
    },

    /**
     * Load all VMS modals into #modals-container
     */
    loadVMSModals: function () {
        const modals = [
            'device-modal',
            'visitor-modal',
            'schedule-visit-modal',
            'location-modal',
            'pre-register-visitor-modal'
        ];

        return Promise.all(modals.map(m => this.load(m, '#modals-container')));
    },

    /**
     * Load enterprise view components into main content
     */
    loadVMSViews: function () {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return Promise.resolve();

        // Create view containers if they don't exist
        const views = [
            { id: 'view-security', component: 'view-security' },
            { id: 'view-reports', component: 'view-reports' }
        ];

        return Promise.all(views.map(v => {
            if (!document.getElementById(v.id)) {
                const div = document.createElement('div');
                div.id = v.id;
                div.style.display = 'none';
                mainContent.appendChild(div);
            }
            return this.loadIntoView(v.component, v.id);
        }));
    },

    /**
     * Load component directly into a view div
     */
    loadIntoView: function (componentName, viewId) {
        const url = `/static/components/${componentName}.html`;
        const target = document.getElementById(viewId);

        if (!target) return Promise.reject();

        return fetch(url)
            .then(response => response.text())
            .then(html => {
                target.innerHTML = html;
                console.log(`[ComponentLoader] Loaded view: ${componentName} -> ${viewId}`);
            })
            .catch(err => console.error(`Error loading ${componentName}:`, err));
    },

    /**
     * Replace a view section with component content
     * @param {string} componentName - Component file name
     * @param {string} viewId - ID of view element to replace content
     */
    replaceView: function (componentName, viewId) {
        const url = `/static/components/${componentName}.html`;
        const target = document.getElementById(viewId);

        if (!target) {
            console.error(`View not found: ${viewId}`);
            return Promise.reject(new Error('View not found'));
        }

        return fetch(url)
            .then(response => response.text())
            .then(html => {
                // Extract inner content from component
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const component = temp.firstElementChild;

                if (component) {
                    target.innerHTML = component.innerHTML;
                }
            });
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    // Create modals container if it doesn't exist
    if (!document.getElementById('modals-container')) {
        const container = document.createElement('div');
        container.id = 'modals-container';
        document.body.appendChild(container);
    }
});
