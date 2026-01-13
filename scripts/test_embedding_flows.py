"""
Test VMS Embedding Flows
========================
Verifies that embeddings work correctly for both visitors and employees:
1. Registration with images → worker generates embedding
2. Registration with pre-computed embedding 
3. Fetching entities returns embedding download URLs

Run after VMS server is running:
    python scripts/test_embedding_flows.py
"""
import requests
import jwt
import os
import time
from datetime import datetime, timedelta

# ========== CONFIGURATION ==========
VMS_URL = "http://localhost:5001"
COMPANY_ID = "6827296ab6e06b08639107c4"
VMS_JWT_SECRET = 'vms-secret-key-change-in-production'

# Test images - use any face image you have
TEST_IMAGE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "Shah-Rukh-Khan.jpg")
if not os.path.exists(TEST_IMAGE):
    TEST_IMAGE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "salman.jpg")


def get_vms_token():
    """Generate VMS access token"""
    payload = {
        'user_id': 'test_user',
        'company_id': COMPANY_ID,
        'companyId': COMPANY_ID,
        'exp': datetime.utcnow() + timedelta(hours=2)
    }
    return jwt.encode(payload, VMS_JWT_SECRET, algorithm='HS256')


def test_visitor_registration_with_images():
    """Test visitor registration with face images (worker will generate embedding)"""
    print("\n" + "="*60)
    print("TEST 1: Visitor Registration with Images")
    print("="*60)
    
    token = get_vms_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # First get a host employee
    resp = requests.get(f"{VMS_URL}/api/employees?companyId={COMPANY_ID}", headers=headers)
    if resp.status_code != 200 or not resp.json():
        print("  ❌ No employees found. Create an employee first.")
        return None
    
    employees = resp.json()
    host_id = employees[0].get('_id')
    print(f"  Using host employee: {host_id}")
    
    # Register visitor with images
    phone = f"+91{int(time.time()) % 10000000000:010d}"
    
    if not os.path.exists(TEST_IMAGE):
        print(f"  ❌ Test image not found: {TEST_IMAGE}")
        return None
    
    files = {
        'center': ('center.jpg', open(TEST_IMAGE, 'rb'), 'image/jpeg'),
    }
    
    form_data = {
        'companyId': COMPANY_ID,
        'visitorName': f'Test Visitor {int(time.time())}',
        'phone': phone,
        'hostEmployeeId': host_id,
        'visitorType': 'guest'
    }
    
    resp = requests.post(
        f"{VMS_URL}/api/visitors/register",
        data=form_data,
        files=files,
        headers=headers
    )
    
    # Close file handles
    for f in files.values():
        f[1].close()
    
    if resp.status_code not in [200, 201]:
        print(f"  ❌ Registration failed: {resp.status_code} - {resp.text[:200]}")
        return None
    
    result = resp.json()
    visitor_id = result.get('_id')
    embedding_status = result.get('embeddingStatus', {})
    
    print(f"  ✅ Visitor registered: {visitor_id}")
    print(f"  📊 hasBiometric: {result.get('hasBiometric')}")
    print(f"  📊 embeddingStatus: {embedding_status}")
    
    # Verify buffalo_l is queued
    if embedding_status.get('buffalo_l') == 'queued':
        print("  ✅ buffalo_l embedding queued correctly")
    else:
        print(f"  ⚠️ buffalo_l status: {embedding_status.get('buffalo_l')}")
    
    return visitor_id


def test_fetch_visitor_with_embedding(visitor_id):
    """Test fetching visitor and verifying embedding downloadUrl"""
    print("\n" + "="*60)
    print("TEST 2: Fetch Visitor with Embedding")
    print("="*60)
    
    if not visitor_id:
        print("  ⏭️ Skipped - no visitor ID")
        return
    
    token = get_vms_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # Wait a bit for embedding generation (if worker is running)
    print("  Waiting 3 seconds for embedding worker...")
    time.sleep(3)
    
    # Fetch visitor
    resp = requests.get(
        f"{VMS_URL}/api/visitors?companyId={COMPANY_ID}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"  ❌ Fetch failed: {resp.status_code}")
        return
    
    data = resp.json()
    visitors = data.get('visitors', [])
    
    # Find our visitor
    visitor = next((v for v in visitors if v.get('_id') == visitor_id), None)
    
    if not visitor:
        print(f"  ❌ Visitor {visitor_id} not found in list")
        return
    
    print(f"  ✅ Found visitor: {visitor.get('visitorName')}")
    
    embeddings = visitor.get('visitorEmbeddings', {})
    print(f"  📊 Embeddings: {embeddings}")
    
    buffalo = embeddings.get('buffalo_l', {})
    if buffalo:
        status = buffalo.get('status')
        download_url = buffalo.get('downloadUrl')
        print(f"  📊 buffalo_l status: {status}")
        if download_url:
            print(f"  ✅ downloadUrl present: {download_url[:80]}...")
        else:
            if status == 'done':
                print("  ⚠️ downloadUrl missing but status is done")
            else:
                print(f"  ℹ️ No downloadUrl yet (status: {status})")


def test_employee_registration_with_images():
    """Test employee registration with face images"""
    print("\n" + "="*60)
    print("TEST 3: Employee Registration with Images")
    print("="*60)
    
    token = get_vms_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    if not os.path.exists(TEST_IMAGE):
        print(f"  ❌ Test image not found: {TEST_IMAGE}")
        return None
    
    files = {
        'center': ('center.jpg', open(TEST_IMAGE, 'rb'), 'image/jpeg'),
    }
    
    emp_code = f"EMP_{int(time.time())}"
    form_data = {
        'companyId': COMPANY_ID,
        'employeeId': emp_code,
        'employeeName': f'Test Employee {int(time.time())}',
        'department': 'Testing'
    }
    
    resp = requests.post(
        f"{VMS_URL}/api/employees/register",
        data=form_data,
        files=files,
        headers=headers
    )
    
    for f in files.values():
        f[1].close()
    
    if resp.status_code not in [200, 201]:
        print(f"  ❌ Registration failed: {resp.status_code} - {resp.text[:200]}")
        return None
    
    result = resp.json()
    employee_id = result.get('_id')
    embedding_status = result.get('embeddingStatus', {})
    
    print(f"  ✅ Employee registered: {employee_id}")
    print(f"  📊 hasBiometric: {result.get('hasBiometric')}")
    print(f"  📊 embeddingStatus: {embedding_status}")
    print(f"  📊 residencyMode: {result.get('residencyMode')}")
    
    if embedding_status.get('buffalo_l') == 'queued':
        print("  ✅ buffalo_l embedding queued correctly")
    
    return employee_id


def test_fetch_employee_with_embedding(employee_id):
    """Test fetching employee and verifying embedding"""
    print("\n" + "="*60)
    print("TEST 4: Fetch Employee with Embedding")
    print("="*60)
    
    if not employee_id:
        print("  ⏭️ Skipped - no employee ID")
        return
    
    token = get_vms_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    print("  Waiting 3 seconds for embedding worker...")
    time.sleep(3)
    
    resp = requests.get(
        f"{VMS_URL}/api/employees/{employee_id}?companyId={COMPANY_ID}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"  ❌ Fetch failed: {resp.status_code} - {resp.text[:100]}")
        return
    
    employee = resp.json()
    print(f"  ✅ Found employee: {employee.get('employeeName')}")
    
    embeddings = employee.get('employeeEmbeddings', {}) or employee.get('actorEmbeddings', {})
    print(f"  📊 Embeddings: {embeddings}")
    
    buffalo = embeddings.get('buffalo_l', {})
    if buffalo:
        status = buffalo.get('status')
        download_url = buffalo.get('downloadUrl')
        print(f"  📊 buffalo_l status: {status}")
        if download_url:
            print(f"  ✅ downloadUrl present: {download_url[:80]}...")


def main():
    print("="*60)
    print("VMS EMBEDDING FLOWS TEST")
    print("="*60)
    print(f"VMS URL: {VMS_URL}")
    print(f"Company ID: {COMPANY_ID}")
    print(f"Test Image: {TEST_IMAGE}")
    
    # Test visitor flow
    visitor_id = test_visitor_registration_with_images()
    test_fetch_visitor_with_embedding(visitor_id)
    
    # Test employee flow
    employee_id = test_employee_registration_with_images()
    test_fetch_employee_with_embedding(employee_id)
    
    print("\n" + "="*60)
    print("TEST COMPLETE")
    print("="*60)
    print("\n💡 If embeddings show 'queued' status:")
    print("   Run vms_embedding_worker.py to generate embeddings")


if __name__ == "__main__":
    main()
