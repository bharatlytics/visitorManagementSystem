import os
from dotenv import load_dotenv

load_dotenv()

print("=== VMS Environment Check ===")
print(f"PLATFORM_API_URL: {os.getenv('PLATFORM_API_URL', 'NOT SET (will use default)')}")
print(f"PLATFORM_WEB_URL: {os.getenv('PLATFORM_WEB_URL', 'NOT SET (will use default)')}")
print(f"VMS_MONGODB_URI: {os.getenv('VMS_MONGODB_URI', 'NOT SET')[:50]}...")

from app.config import Config
print("\n=== Config Values ===")
print(f"Config.PLATFORM_API_URL: {Config.PLATFORM_API_URL}")
print(f"Config.PLATFORM_WEB_URL: {Config.PLATFORM_WEB_URL}")
