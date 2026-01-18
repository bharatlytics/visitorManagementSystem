"""
VMS API Blueprints Registration
"""

def register_blueprints(app):
    """Register all API blueprints"""
    from app.api.visitors import visitor_bp
    from app.api.visits import visits_bp
    from app.api.dashboard import dashboard_bp
    from app.api.analytics import vms_analytics_bp
    from app.api.badge import badge_bp
    from app.api.employees import employees_bp
    from app.api.entities import entities_bp
    from app.api.company import company_bp
    from app.api.settings import settings_bp
    from app.api.security import security_bp
    from app.api.federated_query import federated_query_bp
    from app.api.actor_registration import actor_registration_bp
    from app.api.sync_pull import sync_pull_bp
    from app.api.attendance import attendance_bp
    # Phase 1: Foundation
    from app.api.evacuation import evacuation_bp
    from app.api.preregistration import preregistration_bp
    # Phase 2: Security & Workflows
    from app.api.approvals import approvals_bp
    from app.api.audit import audit_bp
    from app.api.watchlist import watchlist_bp
    from app.api.gdpr import gdpr_bp
    # Phase 3: Mobile & Integrations
    from app.api.mobile_api import mobile_bp
    from app.api.access_control import access_control_bp
    # Phase 4: Analytics & Scale
    from app.api.advanced_analytics import advanced_analytics_bp
    from app.api.reports import reports_bp
    from app.api.webhooks import webhooks_bp
    from app.api.api_keys import api_keys_bp
    
    # VMS core APIs
    app.register_blueprint(visitor_bp, url_prefix='/api/visitors')
    app.register_blueprint(visits_bp, url_prefix='/api/visits')
    app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
    app.register_blueprint(vms_analytics_bp, url_prefix='/api/analytics')
    app.register_blueprint(badge_bp, url_prefix='/api/badge')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')
    app.register_blueprint(security_bp, url_prefix='/api/security')
    
    # Phase 1: Foundation & Quick Wins
    app.register_blueprint(evacuation_bp, url_prefix='/api/emergency')
    app.register_blueprint(preregistration_bp, url_prefix='/api/preregistration')
    
    # Phase 2: Security & Approval Workflows
    app.register_blueprint(approvals_bp, url_prefix='/api/approvals')
    app.register_blueprint(audit_bp, url_prefix='/api/audit')
    app.register_blueprint(watchlist_bp, url_prefix='/api/watchlist')
    app.register_blueprint(gdpr_bp, url_prefix='/api/gdpr')
    
    # Phase 3: Mobile & Integrations
    app.register_blueprint(mobile_bp, url_prefix='/api/mobile')
    app.register_blueprint(access_control_bp, url_prefix='/api/access')
    
    # Phase 4: Analytics & Scale
    app.register_blueprint(advanced_analytics_bp, url_prefix='/api/advanced-analytics')
    app.register_blueprint(reports_bp, url_prefix='/api/reports')
    app.register_blueprint(webhooks_bp, url_prefix='/api/webhooks')
    app.register_blueprint(api_keys_bp, url_prefix='/api/keys')
    
    # Company API
    app.register_blueprint(company_bp, url_prefix='/api/company')
    app.register_blueprint(company_bp, url_prefix='/api/companies', name='companies')
    
    # Data APIs (use DataProvider for dual-mode)
    app.register_blueprint(employees_bp, url_prefix='/api/employees')
    app.register_blueprint(entities_bp, url_prefix='/api/entities')
    app.register_blueprint(attendance_bp, url_prefix='/api/attendance')
    
    # Platform Integration APIs
    app.register_blueprint(federated_query_bp)  # Federated query endpoints
    app.register_blueprint(actor_registration_bp, url_prefix='/api')  # Direct platform CRUD
    app.register_blueprint(sync_pull_bp)  # Platform pulls data for sync
