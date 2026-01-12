"""Complete E2E Test - Employee and Visitor with Embeddings"""
import requests
import time

COMPANY_ID = '6827296ab6e06b08639107c4'

# 1. Platform login  
print('1. Platform login...')
r = requests.post('http://localhost:5000/bharatlytics/v1/users/login', 
    json={'email': 'admin@bharatlytics.com', 'password': 'admin123'})
platform_token = r.json()['token']
print('   OK!')

# 2. VMS SSO
print('2. VMS SSO...')
r = requests.post('http://localhost:5001/auth/platform-sso', 
    json={'token': platform_token, 'companyId': COMPANY_ID})
vms_token = r.json()['vmsToken']
print('   OK!')

# 3. Register Employee with images
print('3. Registering Employee (SRK) with 3 pose images...')
with open('Shah-Rukh-Khan.jpg', 'rb') as f:
    img = f.read()
files = {
    'center': ('c.jpg', img, 'image/jpeg'), 
    'left': ('l.jpg', img, 'image/jpeg'), 
    'right': ('r.jpg', img, 'image/jpeg')
}
emp_id_str = f'EMP_{int(time.time())}'
data = {
    'companyId': COMPANY_ID, 
    'employeeId': emp_id_str, 
    'employeeName': 'Shah Rukh Khan E2E', 
    'department': 'Acting', 
    'designation': 'Superstar'
}
r = requests.post('http://localhost:5001/api/employees/register', 
    headers={'Authorization': f'Bearer {vms_token}'}, 
    data=data, files=files, timeout=60)
print(f'   Status: {r.status_code}')
result = r.json()
emp = result.get('employee', {}).get('actor', {})
emp_actor_id = emp.get('_id')
print(f'   Employee Actor ID: {emp_actor_id}')

# 4. Register Visitor with images  
print('4. Registering Visitor (Salman) with 3 pose images...')
with open('salman.jpg', 'rb') as f:
    img = f.read()
files = {
    'center': ('c.jpg', img, 'image/jpeg'), 
    'left': ('l.jpg', img, 'image/jpeg'), 
    'right': ('r.jpg', img, 'image/jpeg')
}
data = {
    'companyId': COMPANY_ID, 
    'visitorName': 'Salman Khan E2E', 
    'phone': f'+919{int(time.time()) % 100000000:08d}', 
    'hostEmployeeId': emp_actor_id, 
    'purpose': 'Meeting'
}
r = requests.post('http://localhost:5001/api/visitors/register', 
    headers={'Authorization': f'Bearer {vms_token}'}, 
    data=data, files=files, timeout=60)
print(f'   Status: {r.status_code}')
result = r.json()
vis_id = result.get('_id')
print(f'   Visitor ID: {vis_id}')
print(f'   Has Biometric: {result.get("hasBiometric")}')

print('')
print('='*50)
print('E2E TEST COMPLETE')
print('='*50)
print(f'Employee: {emp_actor_id} (Platform mode)')
print(f'Visitor: {vis_id} (VMS mode)')
print('')
print('Next steps:')
print('- Employee embedding: Check actor_embedding_worker on server')
print('- Visitor embedding: Run vms_embedding_worker')
