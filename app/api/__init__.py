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
    
    # VMS core APIs
    app.register_blueprint(visitor_bp, url_prefix='/api/visitors')
    app.register_blueprint(visits_bp, url_prefix='/api/visits')
    app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
    app.register_blueprint(vms_analytics_bp, url_prefix='/api/analytics')
    app.register_blueprint(badge_bp, url_prefix='/api/badge')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')
    app.register_blueprint(security_bp, url_prefix='/api/security')
    
    # Company API
    app.register_blueprint(company_bp, url_prefix='/api/company')
    app.register_blueprint(company_bp, url_prefix='/api/companies', name='companies')
    
    # Data APIs (use DataProvider for dual-mode)
    app.register_blueprint(employees_bp, url_prefix='/api/employees')
    app.register_blueprint(entities_bp, url_prefix='/api/entities')
    
    # Platform Integration APIs
    # NOTE: residency_bp is registered in app/__init__.py to avoid duplicate
    app.register_blueprint(federated_query_bp)  # Federated query endpoints

