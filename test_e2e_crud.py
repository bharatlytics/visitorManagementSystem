"""
Comprehensive E2E Test Script
=============================
Tests both Employee and Visitor CRUD operations with biometric embeddings.

- Employee (SRK): Uses Platform mode → Platform stores in GridFS → actor_embedding_worker generates embedding
- Visitor (Salman): Uses App mode → VMS stores locally → vms_embedding_worker generates embedding

Run this after both VMS and Platform servers are running.
"""
import requests
import jwt
import json
import time
import os
from datetime import datetime, timedelta

# ========== CONFIGURATION ==========
VMS_URL = "http://localhost:5001"
PLATFORM_URL = "http://localhost:5000"
COMPANY_ID = "6827296ab6e06b08639107c4"

# VMS auth
VMS_JWT_SECRET = 'vms-secret-key-change-in-production'

# Platform auth  
PLATFORM_EMAIL = "admin@bharatlytics.com"
PLATFORM_PASSWORD = "admin123"

# Test images
SRK_IMAGE = os.path.join(os.path.dirname(__file__), "Shah-Rukh-Khan.jpg")
SALMAN_IMAGE = os.path.join(os.path.dirname(__file__), "salman.jpg")

# Test data
EMPLOYEE_DATA = {
    "employeeId": f"EMP_{int(time.time())}",
    "employeeName": "Shah Rukh Khan",
    "email": f"srk_{int(time.time())}@test.com",
    "designation": "Actor",
    "department": "Entertainment",
    "phone": f"+91{int(time.time()) % 10000000000:010d}"
}

VISITOR_DATA = {
    "name": "Salman Khan",
    "email": f"salman_{int(time.time())}@test.com",
    "phone": f"+91{int(time.time()) % 10000000000:010d}",
    "company": "SK Films",
    "purpose": "Meeting"
}


def get_vms_token():
    """Generate VMS access token"""
    payload = {
        'user_id': 'test_user',
        'company_id': COMPANY_ID,
        'companyId': COMPANY_ID,
        'exp': datetime.utcnow() + timedelta(hours=2)
    }
    return jwt.encode(payload, VMS_JWT_SECRET, algorithm='HS256')


def get_platform_token():
    """Login to Platform and get token"""
    print("\n[1] Logging into Platform...")
    
    response = requests.post(f"{PLATFORM_URL}/bharatlytics/v1/users/login", json={
        "email": PLATFORM_EMAIL,
        "password": PLATFORM_PASSWORD
    })
    
    if response.status_code != 200:
        print(f"  ❌ Platform login failed: {response.text[:200]}")
        return None
    
    data = response.json()
    print(f"  ✅ Platform login successful")
    return data.get('token')


def get_vms_sso_token(platform_token):
    """Get VMS session via SSO"""
    print("\n[2] VMS SSO...")
    
    response = requests.post(f"{VMS_URL}/auth/platform-sso", json={
        "token": platform_token,
        "companyId": COMPANY_ID
    })
    
    if response.status_code != 200:
        print(f"  ❌ VMS SSO failed: {response.text[:200]}")
        return None
    
    data = response.json()
    vms_token = data.get('vmsToken')
    print(f"  ✅ VMS SSO successful")
    return vms_token, {}


def test_employee_crud(session_token, cookies):
    """Test Employee CRUD with embedding generation"""
    print("\n" + "="*60)
    print("EMPLOYEE CRUD TEST (Platform Mode)")
    print("="*60)
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # 1. CREATE Employee
    print("\n[E1] Creating Employee (SRK)...")
    
    files = {
        'center': ('center.jpg', open(SRK_IMAGE, 'rb'), 'image/jpeg'),
        'left': ('left.jpg', open(SRK_IMAGE, 'rb'), 'image/jpeg'),
        'right': ('right.jpg', open(SRK_IMAGE, 'rb'), 'image/jpeg')
    }
    
    form_data = {**EMPLOYEE_DATA, 'companyId': COMPANY_ID}
    
    response = requests.post(
        f"{VMS_URL}/api/employees/register",
        data=form_data,
        files=files,
        headers=headers,
        cookies=cookies
    )
    
    # Close files
    for f in files.values():
        f[1].close()
    
    if response.status_code not in [200, 201]:
        print(f"  ❌ Create failed: {response.status_code} - {response.text[:300]}")
        return None
    
    result = response.json()
    employee = result.get('employee', result)
    emp_id = employee.get('_id') or employee.get('actor', {}).get('_id')
    print(f"  ✅ Employee created: {emp_id}")
    
    # Wait for embedding
    print("\n[E2] Waiting for embedding generation (5s)...")
    time.sleep(5)
    
    # 2. READ Employee
    print("\n[E3] Fetching Employee...")
    response = requests.get(
        f"{VMS_URL}/api/employees/{emp_id}?companyId={COMPANY_ID}",
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code != 200:
        print(f"  ❌ Fetch failed: {response.text[:200]}")
        return None
    
    employee = response.json()
    print(f"  ✅ Employee fetched")
    
    # Check embeddings
    embeddings = employee.get('actorEmbeddings') or employee.get('employeeEmbeddings')
    if embeddings:
        buffalo = embeddings.get('buffalo_l', {})
        status = buffalo.get('status')
        print(f"  📊 Embedding Status: {status}")
        if status == 'done':
            print(f"  📊 Poses Used: {buffalo.get('posesUsed', [])}")
            print(f"  📊 Download URL: {buffalo.get('downloadUrl', 'N/A')[:80]}...")
    else:
        print(f"  ⚠️ No embeddings yet (check worker)")
    
    # 3. LIST Employees
    print("\n[E4] Listing Employees...")
    response = requests.get(
        f"{VMS_URL}/api/employees?companyId={COMPANY_ID}",
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code == 200:
        employees = response.json()
        print(f"  ✅ Found {len(employees)} employees")
    
    # 4. UPDATE Employee (if supported)
    print("\n[E5] Updating Employee...")
    update_data = {"designation": "Superstar Actor"}
    response = requests.put(
        f"{VMS_URL}/api/employees/{emp_id}",
        json={**update_data, 'companyId': COMPANY_ID},
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code == 200:
        print(f"  ✅ Employee updated")
    else:
        print(f"  ⚠️ Update: {response.status_code}")
    
    return emp_id


def test_visitor_crud(session_token, cookies):
    """Test Visitor CRUD with embedding generation"""
    print("\n" + "="*60)
    print("VISITOR CRUD TEST (App Mode)")
    print("="*60)
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # 1. CREATE Visitor
    print("\n[V1] Creating Visitor (Salman)...")
    
    files = {
        'center': ('center.jpg', open(SALMAN_IMAGE, 'rb'), 'image/jpeg'),
        'left': ('left.jpg', open(SALMAN_IMAGE, 'rb'), 'image/jpeg'),
        'right': ('right.jpg', open(SALMAN_IMAGE, 'rb'), 'image/jpeg')
    }
    
    form_data = {**VISITOR_DATA, 'companyId': COMPANY_ID}
    
    response = requests.post(
        f"{VMS_URL}/api/visitors/register",
        data=form_data,
        files=files,
        headers=headers,
        cookies=cookies
    )
    
    # Close files
    for f in files.values():
        f[1].close()
    
    if response.status_code not in [200, 201]:
        print(f"  ❌ Create failed: {response.status_code} - {response.text[:300]}")
        return None
    
    result = response.json()
    visitor = result.get('visitor', result)
    visitor_id = visitor.get('_id')
    print(f"  ✅ Visitor created: {visitor_id}")
    
    # Wait for embedding
    print("\n[V2] Waiting for embedding generation (5s)...")
    time.sleep(5)
    
    # 2. READ Visitor
    print("\n[V3] Fetching Visitor...")
    response = requests.get(
        f"{VMS_URL}/api/visitors/{visitor_id}?companyId={COMPANY_ID}",
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code != 200:
        print(f"  ❌ Fetch failed: {response.text[:200]}")
        return None
    
    visitor = response.json()
    print(f"  ✅ Visitor fetched")
    
    # Check embeddings
    embeddings = visitor.get('visitorEmbeddings')
    if embeddings:
        buffalo = embeddings.get('buffalo_l', {})
        status = buffalo.get('status')
        print(f"  📊 Embedding Status: {status}")
        if status == 'done':
            print(f"  📊 Poses Used: {buffalo.get('posesUsed', [])}")
            print(f"  📊 Download URL: {buffalo.get('downloadUrl', 'N/A')[:80]}...")
    else:
        print(f"  ⚠️ No embeddings yet (run vms_embedding_worker)")
    
    # 3. LIST Visitors
    print("\n[V4] Listing Visitors...")
    response = requests.get(
        f"{VMS_URL}/api/visitors?companyId={COMPANY_ID}",
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code == 200:
        visitors = response.json()
        print(f"  ✅ Found {len(visitors)} visitors")
    
    # 4. UPDATE Visitor
    print("\n[V5] Updating Visitor...")
    update_data = {"company": "SK Productions"}
    response = requests.put(
        f"{VMS_URL}/api/visitors/{visitor_id}",
        json={**update_data, 'companyId': COMPANY_ID},
        headers=headers,
        cookies=cookies
    )
    
    if response.status_code == 200:
        print(f"  ✅ Visitor updated")
    else:
        print(f"  ⚠️ Update: {response.status_code}")
    
    return visitor_id


def test_embedding_download(session_token, cookies, emp_id, visitor_id):
    """Test downloading embeddings via proxy URLs"""
    print("\n" + "="*60)
    print("EMBEDDING DOWNLOAD TEST")
    print("="*60)
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # Employee embedding
    if emp_id:
        print("\n[D1] Testing Employee Embedding Download...")
        response = requests.get(
            f"{VMS_URL}/api/employees/{emp_id}?companyId={COMPANY_ID}",
            headers=headers,
            cookies=cookies
        )
        if response.status_code == 200:
            emp = response.json()
            embeddings = emp.get('actorEmbeddings') or emp.get('employeeEmbeddings')
            if embeddings and embeddings.get('buffalo_l', {}).get('downloadUrl'):
                download_url = embeddings['buffalo_l']['downloadUrl']
                print(f"  Download URL: {download_url}")
                
                # Try to download
                dl_response = requests.get(download_url, headers=headers, cookies=cookies)
                if dl_response.status_code == 200:
                    print(f"  ✅ Downloaded {len(dl_response.content)} bytes")
                else:
                    print(f"  ⚠️ Download failed: {dl_response.status_code}")
    
    # Visitor embedding
    if visitor_id:
        print("\n[D2] Testing Visitor Embedding Download...")
        response = requests.get(
            f"{VMS_URL}/api/visitors/{visitor_id}?companyId={COMPANY_ID}",
            headers=headers,
            cookies=cookies
        )
        if response.status_code == 200:
            vis = response.json()
            embeddings = vis.get('visitorEmbeddings')
            if embeddings and embeddings.get('buffalo_l', {}).get('downloadUrl'):
                download_url = embeddings['buffalo_l']['downloadUrl']
                print(f"  Download URL: {download_url}")
                
                dl_response = requests.get(download_url, headers=headers, cookies=cookies)
                if dl_response.status_code == 200:
                    print(f"  ✅ Downloaded {len(dl_response.content)} bytes")
                else:
                    print(f"  ⚠️ Download failed: {dl_response.status_code}")


def cleanup_test_data():
    """Cleanup old test data"""
    print("\n[0] Cleaning up old test actors...")
    
    from pymongo import MongoClient
    
    # Platform DB
    PLATFORM_URI = "mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/bharatlytics_platform?retryWrites=true&w=majority&appName=Cluster0"
    client = MongoClient(PLATFORM_URI)
    db = client.get_default_database()
    
    result = db.actors.delete_many({
        '$or': [
            {'attributes.employeeName': {'$regex': 'Shah Rukh Khan', '$options': 'i'}},
            {'attributes.employeeName': {'$regex': 'Salman Khan', '$options': 'i'}}
        ]
    })
    print(f"  Deleted {result.deleted_count} platform actors")
    
    # VMS DB
    VMS_URI = "mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/vms_dev?retryWrites=true&w=majority&appName=Cluster0"
    vms_client = MongoClient(VMS_URI)
    vms_db = vms_client.get_default_database()
    
    result = vms_db.visitors.delete_many({
        'name': {'$regex': 'Salman Khan', '$options': 'i'}
    })
    print(f"  Deleted {result.deleted_count} VMS visitors")
    
    result = vms_db.employees.delete_many({
        'employeeName': {'$regex': 'Shah Rukh Khan', '$options': 'i'}
    })
    print(f"  Deleted {result.deleted_count} VMS employees")


def main():
    """Run comprehensive E2E tests"""
    print("="*60)
    print("COMPREHENSIVE E2E TEST - Employee & Visitor with Embeddings")
    print("="*60)
    print(f"Employee Image: {SRK_IMAGE}")
    print(f"Visitor Image: {SALMAN_IMAGE}")
    
    # Verify images exist
    if not os.path.exists(SRK_IMAGE):
        print(f"❌ Employee image not found: {SRK_IMAGE}")
        return
    if not os.path.exists(SALMAN_IMAGE):
        print(f"❌ Visitor image not found: {SALMAN_IMAGE}")
        return
    
    # Cleanup
    cleanup_test_data()
    
    # Get tokens
    platform_token = get_platform_token()
    if not platform_token:
        return
    
    result = get_vms_sso_token(platform_token)
    if not result:
        return
    session_token, cookies = result
    
    # Run tests
    emp_id = test_employee_crud(session_token, cookies)
    visitor_id = test_visitor_crud(session_token, cookies)
    
    # Wait a bit more for embeddings
    print("\n[*] Waiting 5 more seconds for embedding workers...")
    time.sleep(5)
    
    # Test downloads
    test_embedding_download(session_token, cookies, emp_id, visitor_id)
    
    print("\n" + "="*60)
    print("E2E TEST COMPLETE")
    print("="*60)
    
    print(f"\n📋 Summary:")
    print(f"  Employee ID: {emp_id}")
    print(f"  Visitor ID: {visitor_id}")
    print(f"\n💡 If embeddings show 'queued' status:")
    print(f"   - Employee: Check actor_embedding_worker on server")
    print(f"   - Visitor: Run vms_embedding_worker locally or on server")


if __name__ == "__main__":
    main()
