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

    
    # Main routes - Redirect to React frontend in development
    from flask import redirect
    
    @app.route('/')
    def index():
        # In development, redirect to React dev server
        return redirect('http://localhost:5173')
    
    @app.route('/dashboard.html')
    def dashboard():
        return redirect('http://localhost:5173')
    
    @app.route('/visitors.html')
    def visitors():
        return redirect('http://localhost:5173/visitors')
    
    @app.route('/visits.html')
    def visits():
        return redirect('http://localhost:5173/visits')
    
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
    
    def _sync():
        try:
            # Load manifest
            manifest_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'manifest.json')
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            
            platform_url = os.getenv('PLATFORM_URL', 'http://localhost:5000')
            vms_url = os.getenv('VMS_URL', 'http://localhost:5001')
            
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
