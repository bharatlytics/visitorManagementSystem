"""Quick test for employee registration with images"""
import requests
from datetime import datetime

# Step 1: Platform login
print("Step 1: Platform login...")
r = requests.post('http://localhost:5000/bharatlytics/v1/users/login', 
    json={'email': 'admin@bharatlytics.com', 'password': 'admin123'})
platform_token = r.json()['token']
print(f"  Platform login: OK")

# Step 2: VMS SSO
print("Step 2: VMS SSO...")
r = requests.post('http://localhost:5001/auth/platform-sso',
    json={'token': platform_token, 'companyId': '6827296ab6e06b08639107c4'})
vms_token = r.json()['vmsToken']
print(f"  VMS SSO: OK")

# Step 3: Register with images  
print("Step 3: Registering employee with images...")
with open(r'c:\Users\sahil\OneDrive\Documents\GitHub\visitorManagementSystem\Shah-Rukh-Khan.jpg', 'rb') as f:
    img = f.read()

files = {
    'left': ('left.jpg', img, 'image/jpeg'),
    'right': ('right.jpg', img, 'image/jpeg'),  
    'center': ('center.jpg', img, 'image/jpeg')
}
data = {
    'companyId': '6827296ab6e06b08639107c4',
    'employeeId': 'SRK_' + datetime.now().strftime('%H%M%S'),
    'employeeName': 'Shah Rukh Khan Test',
    'department': 'Acting',
    'designation': 'Superstar'
}

r = requests.post('http://localhost:5001/api/employees/register',
    headers={'Authorization': f'Bearer {vms_token}'},
    data=data,
    files=files,
    timeout=60)

print(f"  Status: {r.status_code}")
try:
    result = r.json()
    print(f"  Response: {result}")
    if r.status_code in [200, 201]:
        print(f"\n  SUCCESS!")
        print(f"  Employee ID: {result.get('_id') or result.get('employeeId')}")
        print(f"  Residency Mode: {result.get('residencyMode')}")
        print(f"  Has Biometric: {result.get('hasBiometric')}")
except:
    print(f"  Response text: {r.text[:500]}")
