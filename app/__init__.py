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
    
    # Register residency API (Data Residency v3)
    from app.api.residency_api import residency_bp
    app.register_blueprint(residency_bp, url_prefix='/api')

    # Serve React build from frontend/dist for SPA
    # Path to React build directory (relative to project root)
    frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'dist')
    
    from flask import send_from_directory, send_file
    
    @app.route('/health')
    def health():
        return {'status': 'ok', 'app': 'VMS'}
    
    @app.route('/assets/<path:filename>')
    def serve_assets(filename):
        """Serve React build assets (JS, CSS, etc.)"""
        return send_from_directory(os.path.join(frontend_dist, 'assets'), filename)
    
    @app.route('/<path:path>')
    def serve_static(path):
        """Serve static files from React build"""
        # Check if file exists in frontend/dist
        file_path = os.path.join(frontend_dist, path)
        if os.path.isfile(file_path):
            return send_from_directory(frontend_dist, path)
        # For SPA routing, return index.html
        return send_file(os.path.join(frontend_dist, 'index.html'))
    
    @app.route('/')
    def index():
        """Serve React app root"""
        return send_file(os.path.join(frontend_dist, 'index.html'))
    
    # Sync manifest to Platform on startup
    sync_manifest_to_platform()
    
    return app


def sync_manifest_to_platform():
    """
    Push VMS manifest to Platform on startup.
    This ensures Platform knows our latest data agreements.
    """
    import json
    import requests
    import os
    from threading import Thread
    from app.config import Config
    
    def _sync():
        try:
            # Load manifest
            manifest_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'manifest.json')
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            
            # Use Config for consistent env var access
            platform_url = Config.PLATFORM_API_URL
            vms_url = Config.APP_URL
            
            response = requests.post(
                f"{platform_url}/bharatlytics/integration/v1/manifest/sync",
                json={
                    'appId': manifest.get('appId', 'vms_app_v1'),
                    'manifest': manifest,
                    'baseUrl': vms_url
                },
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                version = manifest.get('app', {}).get('version', 'unknown')
                print(f"[VMS] Manifest synced to Platform: v{version}")
            else:
                print(f"[VMS] Manifest sync failed: {response.status_code}")
                print(f"[VMS] Response: {response.text[:500]}")  # Show error details
                
        except Exception as e:
            print(f"[VMS] Manifest sync error (Platform may be down): {e}")
    
    # Run in background thread to not block startup
    thread = Thread(target=_sync, daemon=True)
    thread.start()
