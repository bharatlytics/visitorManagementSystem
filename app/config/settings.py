"""
VMS Configuration Settings

NOTE: Mode (standalone vs connected) is NOT configured here.
It's determined per-session based on how the user accessed the app:
- Direct access → local login → own DB
- From Platform → SSO token → platform API
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Flask session secret
    SECRET_KEY = os.getenv('JWT_SECRET', 'vms-secret-key-change-in-production')
    
    # MongoDB - VMS's own database (always used for visitors/visits)
    VMS_MONGODB_URI = os.getenv('VMS_MONGODB_URI', 'mongodb://localhost:27017/vms_db')
    
    # JWT for local auth
    JWT_SECRET = os.getenv('JWT_SECRET', 'vms-secret-key-change-in-production')
    JWT_ALGORITHM = 'HS256'
    JWT_EXPIRY_HOURS = 24
    
    # Platform JWT Secret (for validating SSO tokens from platform - must match platform's JWT_SECRET)
    PLATFORM_JWT_SECRET = os.getenv('PLATFORM_JWT_SECRET', 'supersecret')
    
    # VMS App ID - must match the Platform's registered app ID
    APP_ID = os.getenv('VMS_APP_ID', 'app_bharatlytics_vms_366865a4')
    
    # Platform API (used when user comes via platform SSO)
    PLATFORM_API_URL = os.getenv('PLATFORM_API_URL', 'http://localhost:5000')
    
    # Platform Web URL (for "Exit App" navigation back to platform)
    PLATFORM_WEB_URL = os.getenv('PLATFORM_WEB_URL', 'http://localhost:5000')
    
    # VMS App URL (this app's publicly accessible URL - used for manifest sync)
    APP_URL = os.getenv('VMS_URL', 'http://localhost:5001')
    
    # File uploads
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB
    
    # Allowed embedding models (includes both legacy and new Platform models)
    ALLOWED_MODELS = ['facenet', 'arcface', 'vggface', 'buffalo_l', 'mobile_facenet_v1']

    # SMTP Configuration (for Host Notifications)
    MAIL_SERVER = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'true').lower() == 'true'
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', 'noreply@vms.com')
