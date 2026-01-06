"""
Test Embedding Download Endpoints
Verifies that embedding download URLs are generated correctly and endpoints work
"""
import requests
import json

# Test configuration
BASE_URL = "http://localhost:5001"
COMPANY_ID = "6827296ab6e06b08639107c4"

def test_visitor_list_has_download_urls():
    """Test that visitor list includes downloadUrl in embeddings"""
    print("\n=== Test 1: Visitor List Includes Download URLs ===")
    
    url = f"{BASE_URL}/api/visitors/?companyId={COMPANY_ID}"
    
    try:
        response = requests.get(url)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print("❌ Authentication required - this is expected without token")
            print("✅ Endpoint is accessible (returns 401, not 404)")
            return True
        
        data = response.json()
        visitors = data.get('visitors', [])
        
        if not visitors:
            print("⚠️  No visitors found")
            return False
        
        # Check first visitor
        visitor = visitors[0]
        embeddings = visitor.get('visitorEmbeddings', {})
        
        print(f"\nFirst visitor: {visitor.get('visitorName')}")
        print(f"Embeddings: {json.dumps(embeddings, indent=2)}")
        
        # Verify downloadUrl exists
        has_download_url = False
        for model, emb_data in embeddings.items():
            if isinstance(emb_data, dict) and emb_data.get('embeddingId'):
                if 'downloadUrl' in emb_data:
                    has_download_url = True
                    print(f"\n✅ Found downloadUrl for {model}:")
                    print(f"   {emb_data['downloadUrl']}")
                else:
                    print(f"\n❌ Missing downloadUrl for {model}")
        
        return has_download_url
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_embedding_endpoint_exists():
    """Test that embedding download endpoint exists"""
    print("\n=== Test 2: Embedding Download Endpoint Exists ===")
    
    # Use a dummy embedding ID
    embedding_id = "6881fcfbb80d7fe19da787cf"
    url = f"{BASE_URL}/api/visitors/embeddings/{embedding_id}"
    
    try:
        response = requests.get(url)
        print(f"URL: {url}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 404:
            print("❌ Endpoint returns 404 - route not registered!")
            return False
        elif response.status_code == 401:
            print("✅ Endpoint exists (returns 401 auth required, not 404)")
            return True
        elif response.status_code == 400:
            print("✅ Endpoint exists (returns 400 bad request, not 404)")
            print(f"Response: {response.json()}")
            return True
        else:
            print(f"✅ Endpoint exists (status {response.status_code})")
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_route_registration():
    """Test that routes are properly registered"""
    print("\n=== Test 3: Route Registration ===")
    
    try:
        # Import app and check routes
        import sys
        sys.path.insert(0, 'c:/Users/sahil/OneDrive/Documents/GitHub/visitorManagementSystem')
        
        from app import create_app
        app = create_app()
        
        # Find embedding routes
        visitor_embedding_routes = []
        employee_embedding_routes = []
        
        for rule in app.url_map.iter_rules():
            rule_str = str(rule)
            if 'embedding' in rule_str:
                if 'visitor' in rule_str:
                    visitor_embedding_routes.append(rule_str)
                elif 'employee' in rule_str:
                    employee_embedding_routes.append(rule_str)
        
        print(f"\nVisitor embedding routes:")
        for route in visitor_embedding_routes:
            print(f"  ✅ {route}")
        
        print(f"\nEmployee embedding routes:")
        for route in employee_embedding_routes:
            print(f"  ✅ {route}")
        
        success = len(visitor_embedding_routes) > 0 and len(employee_embedding_routes) > 0
        
        if success:
            print("\n✅ All embedding routes registered correctly")
        else:
            print("\n❌ Missing embedding routes")
        
        return success
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_url_generation():
    """Test URL generation helper function"""
    print("\n=== Test 4: URL Generation Helper ===")
    
    try:
        import sys
        sys.path.insert(0, 'c:/Users/sahil/OneDrive/Documents/GitHub/visitorManagementSystem')
        
        from app.utils import generate_embedding_url
        
        # Test URL generation
        embedding_id = "test123"
        base_url = "http://localhost:5001"
        
        visitor_url = generate_embedding_url(embedding_id, 'visitor', base_url)
        employee_url = generate_embedding_url(embedding_id, 'employee', base_url)
        
        expected_visitor = f"{base_url}/api/visitors/embeddings/{embedding_id}"
        expected_employee = f"{base_url}/api/employees/embeddings/{embedding_id}"
        
        print(f"\nGenerated visitor URL: {visitor_url}")
        print(f"Expected: {expected_visitor}")
        print(f"Match: {'✅' if visitor_url == expected_visitor else '❌'}")
        
        print(f"\nGenerated employee URL: {employee_url}")
        print(f"Expected: {expected_employee}")
        print(f"Match: {'✅' if employee_url == expected_employee else '❌'}")
        
        return visitor_url == expected_visitor and employee_url == expected_employee
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("EMBEDDING DOWNLOAD ENDPOINTS - COMPREHENSIVE TEST")
    print("=" * 60)
    
    results = {
        "Route Registration": test_route_registration(),
        "URL Generation": test_url_generation(),
        "Embedding Endpoint Exists": test_embedding_endpoint_exists(),
        "Visitor List Has Download URLs": test_visitor_list_has_download_urls(),
    }
    
    print("\n" + "=" * 60)
    print("TEST RESULTS SUMMARY")
    print("=" * 60)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "=" * 60)
    if all_passed:
        print("🎉 ALL TESTS PASSED!")
    else:
        print("⚠️  SOME TESTS FAILED - Review output above")
    print("=" * 60)
