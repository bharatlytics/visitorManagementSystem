"""
VMS Flask Application Factory
"""
from flask import Flask
from flask_cors import CORS
import os

def create_app():
    app = Flask(__name__, 
                template_folder='templates',
                static_folder='static')
    
    # Load config
    app.config.from_object('app.config.settings.Config')
    
    # Ensure session works - explicit secret key
    app.secret_key = app.config.get('SECRET_KEY', 'vms-secret-key-change-in-production')
    
    # Enable CORS with credentials (needed for cookies/sessions across domains)
    CORS(app, supports_credentials=True)
    
    # Register blueprints
    from app.api import register_blueprints
    register_blueprints(app)
    
    # Register auth routes
    from app.auth import auth_bp
    app.register_blueprint(auth_bp)
    
    # Main routes
    @app.route('/')
    def index():
        return app.send_static_file('index.html')
    
    @app.route('/dashboard.html')
    def dashboard():
        return app.send_static_file('dashboard.html')
    
    @app.route('/visitors.html')
    def visitors():
        return app.send_static_file('visitors.html')
    
    @app.route('/visits.html')
    def visits():
        return app.send_static_file('visits.html')
    
    @app.route('/health')
    def health():
        return {'status': 'ok', 'app': 'VMS'}
    
    return app
