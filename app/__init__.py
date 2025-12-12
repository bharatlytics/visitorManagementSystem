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
    
    # Register webhooks
    from app.api.webhooks import webhooks_bp
    app.register_blueprint(webhooks_bp, url_prefix='/api/webhooks')
    
    # Register residency API (Data Residency v3)
    from app.api.residency_api import residency_bp
    app.register_blueprint(residency_bp, url_prefix='/api')
    
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
    
    # Serve JS files from subdirectories
    @app.route('/js/<path:filename>')
    def serve_js(filename):
        return app.send_static_file(f'js/{filename}')
    
    # Serve CSS files from subdirectories
    @app.route('/css/<path:filename>')
    def serve_css(filename):
        return app.send_static_file(f'css/{filename}')

    # Serve Image files from subdirectories
    @app.route('/images/<path:filename>')
    def serve_images(filename):
        return app.send_static_file(f'images/{filename}')
    
    return app
