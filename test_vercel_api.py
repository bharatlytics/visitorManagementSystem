"""Test Vercel visitor registration API"""
import requests

# 1. Login to Platform
print("1. Platform login...")
r = requests.post('https://bharatlytics.com/bharatlytics/v1/users/login', 
    json={'email': 'admin@bharatlytics.com', 'password': 'admin123'})
print(f"   Status: {r.status_code}")
if r.status_code != 200:
    print(f"   Error: {r.text}")
    exit(1)
platform_token = r.json().get('token')
print(f"   Token: {platform_token[:30]}...")

# 2. VMS SSO
print("\n2. VMS SSO...")
r = requests.post('https://visitor-management-system-pearl.vercel.app/auth/platform-sso',
    json={'token': platform_token, 'companyId': '6827296ab6e06b08639107c4'})
print(f"   Status: {r.status_code}")
print(f"   Response: {r.text[:300]}")
if r.status_code != 200:
    exit(1)
vms_token = r.json().get('vmsToken')

# 3. Test visitor registration (basic without images)
print("\n3. Testing visitor registration...")
import time
data = {
    'companyId': '6827296ab6e06b08639107c4',
    'visitorName': 'Test Visitor API',
    'phone': f'+919{int(time.time()) % 100000000:08d}',
    'hostEmployeeId': '69327d5a244b30cb1d27b46c',  # Shashwat
    'purpose': 'API Test'
}
r = requests.post('https://visitor-management-system-pearl.vercel.app/api/visitors/register',
    headers={'Authorization': f'Bearer {vms_token}'},
    json=data)
print(f"   Status: {r.status_code}")
print(f"   Response: {r.text[:500]}")
