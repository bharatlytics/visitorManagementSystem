"""
SRK Employee Registration E2E Test via VMS API

Tests the COMPLETE employee registration flow:
1. Login to Platform → Get platform token
2. SSO to VMS → Get VMS token
3. Register employee via VMS API with face image
4. Verify image stored and embedding queued
"""
import requests
import os
from datetime import datetime

# Configuration
PLATFORM_URL = "http://localhost:5000"
VMS_URL = "http://localhost:5001"
COMPANY_ID = "6827296ab6e06b08639107c4"  # JBM Group
SRK_IMAGE_PATH = r"c:\Users\sahil\OneDrive\Documents\GitHub\visitorManagementSystem\Shah-Rukh-Khan.jpg"

# Platform credentials (you may need to update these)
PLATFORM_EMAIL = "admin@bharatlytics.com"  
PLATFORM_PASSWORD = "admin123"


def step_1_platform_login():
    """Step 1: Login to Platform"""
    print("\n--- Step 1: Login to Platform ---")
    
    try:
        resp = requests.post(
            f"{PLATFORM_URL}/bharatlytics/v1/users/login",
            json={
                "email": PLATFORM_EMAIL,
                "password": PLATFORM_PASSWORD
            },
            timeout=10
        )
        
        print(f"   Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            token = data.get('token')
            context = data.get('context', {})
            print(f"✅ Platform login successful")
            print(f"   User: {data.get('user', {}).get('email')}")
            print(f"   Company: {context.get('companyName')}")
            return token
        else:
            print(f"❌ Login failed: {resp.text[:300]}")
            return None
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def step_2_vms_sso(platform_token):
    """Step 2: Exchange platform token for VMS token"""
    print("\n--- Step 2: VMS SSO Authentication ---")
    
    try:
        resp = requests.post(
            f"{VMS_URL}/auth/platform-sso",
            json={
                "token": platform_token,
                "companyId": COMPANY_ID
            },
            timeout=10
        )
        
        print(f"   Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            vms_token = data.get('vmsToken')
            print(f"✅ VMS SSO successful")
            print(f"   Company: {data.get('company', {}).get('name')}")
            print(f"   Expires in: {data.get('expiresIn')} seconds")
            return vms_token
        else:
            print(f"❌ SSO failed: {resp.text[:300]}")
            return None
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def step_3_register_employee(vms_token):
    """Step 3: Register employee via VMS API with face image"""
    print("\n--- Step 3: Register Employee via VMS API ---")
    
    if not os.path.exists(SRK_IMAGE_PATH):
        print(f"❌ Image not found: {SRK_IMAGE_PATH}")
        return None
    
    # Read image file size
    image_size = os.path.getsize(SRK_IMAGE_PATH)
    print(f"   Image size: {image_size} bytes")
    
    # Prepare form data
    employee_id = f"SRK-{datetime.now().strftime('%H%M%S')}"
    
    form_data = {
        'companyId': COMPANY_ID,
        'employeeId': employee_id,
        'employeeName': 'SRK Sharma',
        'employeeEmail': 'srk.sharma@jbmgroup.com',
        'employeeMobile': '9876543210',
        'department': 'HR',
        'designation': 'Actor',
    }
    
    headers = {
        'Authorization': f'Bearer {vms_token}'
    }
    
    with open(SRK_IMAGE_PATH, 'rb') as img_file:
        files = {
            'center': ('srk.jpg', img_file, 'image/jpeg')
        }
        
        try:
            resp = requests.post(
                f"{VMS_URL}/api/employees/register",
                headers=headers,
                data=form_data,
                files=files,
                timeout=30
            )
            
            print(f"   Response status: {resp.status_code}")
            
            if resp.status_code in [200, 201]:
                data = resp.json()
                print(f"✅ Employee registered successfully!")
                print(f"   MongoDB _id: {data.get('_id')}")
                print(f"   Employee ID: {data.get('employeeId')}")
                print(f"   Has Biometric: {data.get('hasBiometric')}")
                print(f"   Embedding Status: {data.get('embeddingStatus')}")
                print(f"   Residency Mode: {data.get('residencyMode')}")
                return data
            else:
                print(f"❌ Registration failed: {resp.text[:500]}")
                return None
                
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return None


def step_4_verify_employee(vms_token):
    """Step 4: Verify employee appears in list"""
    print("\n--- Step 4: Verify Employee in List ---")
    
    headers = {
        'Authorization': f'Bearer {vms_token}'
    }
    
    try:
        resp = requests.get(
            f"{VMS_URL}/api/employees",
            headers=headers,
            params={'companyId': COMPANY_ID},
            timeout=10
        )
        
        if resp.status_code == 200:
            employees = resp.json()
            srk_employees = [e for e in employees if 'SRK' in e.get('employeeName', '').upper()]
            
            if srk_employees:
                print(f"✅ Found {len(srk_employees)} SRK employee(s)")
                for emp in srk_employees:
                    print(f"   - {emp.get('employeeName')} (ID: {emp.get('_id')})")
                    has_images = bool(emp.get('employeeImages'))
                    embeddings = list(emp.get('employeeEmbeddings', {}).keys())
                    print(f"     Has Images: {has_images}")
                    print(f"     Embeddings: {embeddings}")
                return srk_employees
            else:
                print(f"❌ No SRK employees found (Total: {len(employees)})")
                return []
        else:
            print(f"❌ Failed to fetch: {resp.status_code}")
            return []
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return []


def main():
    print("=" * 60)
    print("SRK Employee Registration E2E Test")
    print("=" * 60)
    print(f"Platform: {PLATFORM_URL}")
    print(f"VMS: {VMS_URL}")
    print(f"Company ID: {COMPANY_ID}")
    
    results = []
    
    # Step 1: Platform login
    platform_token = step_1_platform_login()
    results.append(("Platform Login", bool(platform_token)))
    
    if not platform_token:
        print("\n❌ Cannot proceed without platform token")
        print("\n💡 TIP: Update PLATFORM_EMAIL and PLATFORM_PASSWORD in the script")
        return False
    
    # Step 2: VMS SSO
    vms_token = step_2_vms_sso(platform_token)
    results.append(("VMS SSO", bool(vms_token)))
    
    if not vms_token:
        print("\n❌ Cannot proceed without VMS token")
        return False
    
    # Step 3: Register employee
    reg_result = step_3_register_employee(vms_token)
    results.append(("Register Employee", bool(reg_result)))
    
    # Step 4: Verify
    employees = step_4_verify_employee(vms_token)
    results.append(("Verify in List", len(employees) > 0))
    
    # Summary
    passed = sum(1 for _, r in results if r)
    print("\n" + "=" * 60)
    print(f"Results: {passed}/{len(results)} steps passed")
    print("=" * 60)
    
    for name, result in results:
        status = "✅" if result else "❌"
        print(f"  {status} {name}")
    
    if reg_result:
        print(f"\n📌 New Employee MongoDB _id: {reg_result.get('_id')}")
        print(f"📌 Employee Code: {reg_result.get('employeeId')}")
        print("\n🔄 Next: Run buffalo_l_worker to process embedding:")
        print("   cd faceRecognitionServer && python inferenceServer/buffalo_l_worker.py")
    
    return passed == len(results)


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
