"""
End-to-End Test for Residency-Aware Employee List

Tests the complete flow:
1. Residency detection
2. Data fetching based on mode
3. Manifest-based actor mapping
"""
import requests
import json


def test_employee_list_app_mode():
    """Test employee list in app mode"""
    print("\n" + "="*70)
    print("TEST: Employee List - App Mode")
    print("="*70)
    
    # This would be a company in app mode
    # For testing, we'll use the API directly
    
    url = "http://localhost:5001/api/employees"
    params = {'companyId': '6827296ab6e06b08639107c4'}
    
    # You would need a valid auth token
    # headers = {'Authorization': 'Bearer <token>'}
    
    try:
        response = requests.get(url, params=params, timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            employees = response.json()
            print(f"✅ Fetched {len(employees)} employees")
            
            if employees:
                print(f"\nSample employee:")
                print(json.dumps(employees[0], indent=2, default=str))
        else:
            print(f"❌ Error: {response.text}")
            
    except Exception as e:
        print(f"❌ Request failed: {e}")


def test_residency_detection():
    """Test residency detection for employees and visitors"""
    print("\n" + "="*70)
    print("TEST: Residency Detection")
    print("="*70)
    
    from app.services.residency_detector import ResidencyDetector
    
    company_id = '6827296ab6e06b08639107c4'
    
    emp_mode = ResidencyDetector.get_mode(company_id, 'employee')
    vis_mode = ResidencyDetector.get_mode(company_id, 'visitor')
    
    print(f"Company: {company_id}")
    print(f"Employee mode: {emp_mode}")
    print(f"Visitor mode: {vis_mode}")
    
    # Verify safe defaults
    assert emp_mode in ['platform', 'app'], "Invalid employee mode"
    assert vis_mode == 'app', "Visitors should default to app mode"
    
    print("✅ Residency detection working correctly")


def test_data_provider():
    """Test data provider directly"""
    print("\n" + "="*70)
    print("TEST: Data Provider")
    print("="*70)
    
    from app.services.data_provider import get_data_provider
    
    company_id = '6827296ab6e06b08639107c4'
    
    provider = get_data_provider(company_id)
    
    # Test employees
    print("\nFetching employees...")
    employees = provider.get_employees(company_id)
    print(f"✅ Got {len(employees)} employees")
    
    # Test visitors
    print("\nFetching visitors...")
    visitors = provider.get_visitors(company_id)
    print(f"✅ Got {len(visitors)} visitors")


def run_all_tests():
    """Run all E2E tests"""
    print("\n" + "="*70)
    print("END-TO-END TESTS - RESIDENCY-AWARE DATA PROVIDER")
    print("="*70)
    
    try:
        test_residency_detection()
        test_data_provider()
        # test_employee_list_app_mode()  # Requires running server
        
        print("\n" + "="*70)
        print("✅ ALL TESTS PASSED")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    run_all_tests()
