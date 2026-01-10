"""
E2E Test for VMS Employee and Visitor Registration
Tests the federated data exchange architecture:
- Employee: syncs to platform
- Visitor: stays in VMS (federated query)
"""
import requests
import json

# Configuration
VMS_URL = "http://localhost:5001"
PLATFORM_URL = "http://localhost:5000"
COMPANY_ID = "6827296ab6e06b08639107c4"

# Test credentials
TEST_EMAIL = "admin@bharatlytics.com"
TEST_PASSWORD = "admin123"

def login_and_get_vms_session():
    """
    Login to platform, then use platform token to authenticate with VMS via SSO
    """
    print("1. Logging in to Platform...")
    
    # Try platform login endpoints
    login_urls = [
        f"{PLATFORM_URL}/bharatlytics/v1/users/login",
        f"{PLATFORM_URL}/bharatlytics/users/login",
    ]
    
    platform_token = None
    for url in login_urls:
        try:
            resp = requests.post(url, json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                platform_token = data.get('token')
                print(f"   ✅ Platform login successful")
                break
        except Exception as e:
            continue
    
    if not platform_token:
        print("   ❌ Platform login failed")
        return None
    
    # Create VMS session using platform SSO
    print("   Using platform token for VMS SSO...")
    vms_session = requests.Session()
    
    sso_resp = vms_session.post(f"{VMS_URL}/auth/platform-sso", json={
        "token": platform_token,
        "companyId": COMPANY_ID
    })
    
    if sso_resp.status_code == 200:
        print(f"   ✅ VMS SSO successful")
        # Also set bearer token for API calls
        vms_session.headers.update({
            "Authorization": f"Bearer {platform_token}"
        })
        return vms_session
    else:
        print(f"   ❌ VMS SSO failed: {sso_resp.status_code} - {sso_resp.text[:100]}")
        return None

def test_employee_registration(session):
    """Test 1: Register employee with text data only"""
    print("\n2. Registering Employee (text only)...")
    
    resp = session.post(f"{VMS_URL}/api/employees/register", data={
        "companyId": COMPANY_ID,
        "employeeId": "TEST001",
        "employeeName": "Test Employee",
        "employeeEmail": "test.emp@example.com",
        "department": "Engineering",
        "employeeDesignation": "Software Engineer"
    })
    
    print(f"   Status: {resp.status_code}")
    if resp.status_code in [200, 201]:
        data = resp.json()
        print(f"   ✅ Employee registered!")
        print(f"   ID: {data.get('_id')}")
        print(f"   Platform Sync: {data.get('platformSync')}")
        return data.get('_id')
    elif resp.status_code == 409:
        print(f"   ⚠️ Employee already exists (OK if re-running)")
        return "existing"
    else:
        print(f"   ❌ Failed: {resp.text[:200]}")
        return None

def test_visitor_registration(session):
    """Test 2: Register visitor (should stay in VMS, not sync to platform)"""
    print("\n3. Registering Visitor (stays in VMS)...")
    
    resp = session.post(f"{VMS_URL}/api/visitors/register", data={
        "companyId": COMPANY_ID,
        "visitorName": "Test Visitor",
        "phone": "9876543210",
        "visitorType": "general"
    })
    
    print(f"   Status: {resp.status_code}")
    if resp.status_code in [200, 201]:
        data = resp.json()
        print(f"   ✅ Visitor registered!")
        print(f"   ID: {data.get('_id')}")
        print(f"   Data Residency: {data.get('dataResidency')}")
        print(f"   Federated Access: {data.get('federatedAccess')}")
        return data.get('_id')
    else:
        print(f"   ❌ Failed: {resp.text[:200]}")
        return None

def check_platform_actors(session):
    """Test 3: Check if employee is visible on platform"""
    print("\n4. Checking Platform Actors Collection...")
    
    resp = requests.get(
        f"{PLATFORM_URL}/bharatlytics/v1/actors",
        params={"companyId": COMPANY_ID, "actorType": "employee"},
        headers=session.headers
    )
    
    print(f"   Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        if isinstance(data, list):
            actors = data
        else:
            actors = data.get('actors', [])
        print(f"   Found {len(actors)} employee actors on platform")
        for actor in actors[:3]:  # Show first 3
            name = actor.get('attributes', {}).get('name') or actor.get('name', 'N/A')
            print(f"   - {name}")
        return True
    else:
        print(f"   ❌ Failed: {resp.text[:200]}")
        return False

def check_federated_query(session):
    """Test 4: Check federated query for visitors"""
    print("\n5. Testing Federated Query for Visitors...")
    
    # Direct call to VMS federated endpoint (simulates platform routing)
    resp = session.get(
        f"{VMS_URL}/api/query/visitors",
        params={"companyId": COMPANY_ID, "includeImages": "false"},
        headers={"X-Platform-Request": "true"}
    )
    
    print(f"   Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"   ✅ Federated query returned {data.get('count', 0)} visitors")
        print(f"   Source: {data.get('source')}")
        print(f"   Data Type: {data.get('dataType')}")
        return True
    else:
        print(f"   ❌ Failed: {resp.text[:200]}")
        return False

def main():
    print("=" * 60)
    print("VMS Federated Data Exchange E2E Test")
    print("=" * 60)
    
    # Login and get VMS session
    session = login_and_get_vms_session()
    if not session:
        print("\n❌ Cannot proceed without authentication")
        return
    
    # Run tests
    emp_id = test_employee_registration(session)
    vis_id = test_visitor_registration(session)
    check_platform_actors(session)
    check_federated_query(session)
    
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Employee ID: {emp_id}")
    print(f"Visitor ID: {vis_id}")
    print("\nExpected behavior:")
    print("- Employee should appear on platform actors (synced)")
    print("- Visitor should ONLY be in VMS (accessible via federated query)")
    print("=" * 60)

if __name__ == "__main__":
    main()
