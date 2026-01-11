"""
Test script to register an employee with face images via VMS API.
This tests the end-to-end flow: VMS -> Platform -> Embedding Worker
"""
import requests
import os
import jwt
from datetime import datetime, timedelta

# Configuration
VMS_BASE_URL = os.environ.get('VMS_URL', 'http://localhost:5001')
COMPANY_ID = '6827296ab6e06b08639107c4'  # From your previous test
JWT_SECRET = os.environ.get('JWT_SECRET', 'vms-secret-key-change-in-production')

# Image path
IMAGE_PATH = r'c:\Users\sahil\OneDrive\Documents\GitHub\visitorManagementSystem\Shah-Rukh-Khan.jpg'

def generate_token():
    """Generate a JWT token for VMS API access"""
    payload = {
        'user_id': 'test_user',
        'company_id': COMPANY_ID,
        'iss': 'vms',
        'exp': datetime.utcnow() + timedelta(hours=1),
        'role': 'admin'
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def register_employee():
    """Register an employee with face images"""
    
    # Generate unique employee ID
    emp_id = f"SRK_{datetime.now().strftime('%H%M%S')}"
    
    # Prepare form data
    form_data = {
        'companyId': COMPANY_ID,
        'employeeId': emp_id,
        'employeeName': 'Shah Rukh Khan',
        'employeeEmail': 'srk@test.com',
        'employeeMobile': '9999999999',
        'department': 'Acting',
        'designation': 'Superstar'
    }
    
    # Prepare files (same image for left, right, center as requested)
    with open(IMAGE_PATH, 'rb') as img_file:
        image_bytes = img_file.read()
    
    files = {
        'left': ('left.jpg', image_bytes, 'image/jpeg'),
        'right': ('right.jpg', image_bytes, 'image/jpeg'),
        'center': ('center.jpg', image_bytes, 'image/jpeg')
    }
    
    # Generate auth token
    token = generate_token()
    headers = {
        'Authorization': f'Bearer {token}'
    }
    
    # Make the registration request
    url = f'{VMS_BASE_URL}/api/employees/register'
    print(f"Registering employee at: {url}")
    print(f"Employee ID: {emp_id}")
    print(f"Employee Name: Shah Rukh Khan")
    print(f"Company ID: {COMPANY_ID}")
    print(f"Image size: {len(image_bytes)} bytes")
    print("-" * 50)
    
    try:
        response = requests.post(
            url,
            data=form_data,
            files=files,
            headers=headers,
            timeout=30
        )
        
        print(f"Response Status: {response.status_code}")
        print(f"Response Body: {response.json()}")
        
        if response.status_code in [200, 201]:
            result = response.json()
            print("\n✅ Employee registered successfully!")
            print(f"   - Employee ID: {result.get('employeeId') or result.get('_id')}")
            print(f"   - Residency Mode: {result.get('residencyMode')}")
            print(f"   - Has Photo: {result.get('hasPhoto')}")
            if result.get('platformSync'):
                print(f"   - Platform Sync: {result.get('platformSync')}")
            return True
        else:
            print(f"\n❌ Registration failed: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"\n❌ Connection error - is VMS running at {VMS_BASE_URL}?")
        return False
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    print("=" * 50)
    print("VMS Employee Registration Test")
    print("=" * 50)
    register_employee()
