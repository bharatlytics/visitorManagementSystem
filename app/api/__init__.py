"""
VMS API Blueprints Registration
"""

def register_blueprints(app):
    """Register all API blueprints"""
    from app.api.visitors import visitors_bp
    from app.api.visits import visits_bp
    from app.api.dashboard import dashboard_bp
    from app.api.employees import employees_bp
    from app.api.entities import entities_bp
    
    # VMS core APIs
    app.register_blueprint(visitors_bp, url_prefix='/api/visitors')
    app.register_blueprint(visits_bp, url_prefix='/api/visits')
    app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')
    
    # Data APIs (use DataProvider for dual-mode)
    app.register_blueprint(employees_bp, url_prefix='/api/employees')
    app.register_blueprint(entities_bp, url_prefix='/api/entities')
