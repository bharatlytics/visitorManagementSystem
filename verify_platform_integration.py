import os
import sys
import jwt
import requests
from datetime import datetime, timedelta
from app.services.platform_client import PlatformClient
from app.config.settings import Config

# Mock PlatformClient to avoid Flask session dependency
class TestPlatformClient(PlatformClient):
    def __init__(self, api_url, token, company_id):
        super().__init__(api_url)
        self.token = token
        self.cid = company_id
        
    def _get_token(self):
        return self.token
        
    def _get_company_id(self):
        return self.cid



def get_test_ids():
    from pymongo import MongoClient
    # Use same URI as setup_test_user.py
    uri = 'mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
    client = MongoClient(uri)
    db = client['factorylyticsDB']
    
    user = db.users.find_one({'email': 'user_a@test.com'})
    if not user:
        raise Exception("User A not found. Run setup_test_user.py first.")
        
    return str(user['_id']), str(user['companyId'])

def test_integration():
    print("Starting VMS-Platform Integration Verification...")
    
    # 1. Get IDs
    try:
        user_id, company_id = get_test_ids()
        print(f"Using User ID: {user_id}, Company ID: {company_id}")
    except Exception as e:
        print(f"Setup failed: {e}")
        return

    # 2. Setup Token
    payload = {
        'userId': user_id,
        'userEmail': 'user_a@test.com',
        'companyId': company_id,
        'roles': ['user'],
        'exp': datetime.utcnow() + timedelta(hours=1)
    }
    token = jwt.encode(payload, Config.PLATFORM_JWT_SECRET, algorithm='HS256')
    
    print(f"Generated Test Token: {token[:20]}...")
    
    # 2. Initialize Client
    client = TestPlatformClient(api_url='http://localhost:5000', token=token, company_id=company_id)
    
    # 3. Test get_company
    print("\nTesting get_company...")
    company = client.get_company()
    if company and company.get('company', {}).get('companyName') == 'Company A':
        print("PASS: get_company returned correct company.")
    else:
        print(f"FAIL: get_company failed. Result: {company}")
        
    # 4. Test get_employees (actors)
    print("\nTesting get_employees...")
    # Note: We might not have employees for Company A yet, but 200 OK is success
    employees = client.get_employees()
    if employees is not None:
        print(f"PASS: get_employees returned {len(employees)} employees.")
    else:
        print("FAIL: get_employees failed (returned None).")

    # 5. Test get_entities
    print("\nTesting get_entities...")
    entities = client.get_entities()
    if entities is not None:
        print(f"PASS: get_entities returned {len(entities)} entities.")
    else:
        print("FAIL: get_entities failed (returned None).")

if __name__ == "__main__":
    test_integration()
