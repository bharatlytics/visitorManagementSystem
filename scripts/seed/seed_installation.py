"""Seed VMS installation data with platform app_id.
Run this once to set up the correct mapping between VMS and platform.
"""
import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv('VMS_MONGODB_URI')
if not MONGO_URI:
    raise ValueError("VMS_MONGODB_URI environment variable not set")

# Connect to VMS database
client = MongoClient(MONGO_URI)
vms_db = client['blGroup_visitorManagementSystem']

# Get appCredentials from platform to find the correct app_id
platform_db = client['factorylyticsDB']
company_id = '6827296ab6e06b08639107c4'  # JBM company

# Get the VMS app credentials for this company
cred = platform_db['appCredentials'].find_one({
    'appId': 'app_bharatlytics_vms_366865a4',
    'companyId': company_id
})

if cred:
    print(f"Found platform credentials: appId={cred.get('appId')}")
    
    # Create installation document in VMS database
    installation_doc = {
        'company_id': company_id,
        'app_id': cred.get('appId'),
        'client_id': cred.get('appKey')[:50] + '...' if cred.get('appKey') else None,  # Store partial for reference
        'status': 'active',
        'created_by': 'migration_script'
    }
    
    result = vms_db['installations'].update_one(
        {'company_id': company_id},
        {'$set': installation_doc},
        upsert=True
    )
    
    print(f"✅ Installation seeded: {installation_doc}")
    print(f"  Modified: {result.modified_count}, Upserted: {result.upserted_id is not None}")
else:
    print("❌ No credentials found for VMS in platform")

# Verify
print("\n=== Verification ===")
install = vms_db['installations'].find_one({'company_id': company_id})
if install:
    print(f"VMS installation: app_id={install.get('app_id')}, company_id={install.get('company_id')}")
else:
    print("No installation found")
