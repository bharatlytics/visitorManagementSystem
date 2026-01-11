"""Quick E2E Test for SRK Employee Registration"""
import requests
from datetime import datetime

PLATFORM_URL = 'http://localhost:5000'
VMS_URL = 'http://localhost:5001'
COMPANY_ID = '6827296ab6e06b08639107c4'
IMAGE_PATH = r'c:\Users\sahil\OneDrive\Documents\GitHub\visitorManagementSystem\Shah-Rukh-Khan.jpg'

# Step 1: Platform Login
print("Step 1: Platform Login...")
resp = requests.post(f'{PLATFORM_URL}/bharatlytics/v1/users/login', 
    json={'email': 'admin@bharatlytics.com', 'password': 'admin123'}, timeout=10)
platform_token = resp.json()['token']
print(f"  OK - Got platform token")

# Step 2: VMS SSO
print("Step 2: VMS SSO...")
resp = requests.post(f'{VMS_URL}/auth/platform-sso', 
    json={'token': platform_token, 'companyId': COMPANY_ID}, timeout=10)
vms_token = resp.json()['vmsToken']
print(f"  OK - Got VMS token")

# Step 3: Register with image
print("Step 3: Register Employee with Image...")
ts = datetime.now().strftime('%H%M%S')
employee_id = f'SRK-{ts}'
form_data = {
    'companyId': COMPANY_ID,
    'employeeId': employee_id,
    'employeeName': 'SRK Shah Rukh Khan',
    'employeeEmail': f'srk.{ts}@jbm.com',
    'department': 'Bollywood',
    'designation': 'Actor'
}

with open(IMAGE_PATH, 'rb') as img:
    files = {'center': ('srk.jpg', img, 'image/jpeg')}
    resp = requests.post(
        f'{VMS_URL}/api/employees/register',
        headers={'Authorization': f'Bearer {vms_token}'},
        data=form_data,
        files=files,
        timeout=30
    )

print(f"  Response Status: {resp.status_code}")
if resp.status_code in [200, 201]:
    data = resp.json()
    actor = data.get('employee', {}).get('actor', {})
    print(f"  SUCCESS!")
    print(f"  - Actor ID: {actor.get('_id')}")
    print(f"  - Employee ID: {employee_id}")
    print(f"  - Residency Mode: {data.get('residencyMode')}")
    print(f"  - Actor Images: {actor.get('actorImages')}")
    print(f"  - Actor Embeddings: {actor.get('actorEmbeddings')}")
else:
    print(f"  FAILED: {resp.text}")
