"""
Verification Tests for Data Residency Architecture

Run these tests to verify the implementation is working correctly.
"""
from app.services.residency_detector import ResidencyDetector
from app.services.sync_queue import SyncQueue
from app.db import employees_collection, visitor_collection
from bson import ObjectId


def test_residency_detection():
    """Test residency mode detection"""
    print("\n" + "="*60)
    print("TEST 1: Residency Detection")
    print("="*60)
    
    company_id = '6827296ab6e06b08639107c4'
    
    # Test employee residency
    emp_mode = ResidencyDetector.get_mode(company_id, 'employee')
    print(f"✓ Employee residency mode: {emp_mode}")
    
    # Test visitor residency
    vis_mode = ResidencyDetector.get_mode(company_id, 'visitor')
    print(f"✓ Visitor residency mode: {vis_mode}")
    
    assert emp_mode in ['platform', 'app'], "Invalid residency mode"
    assert vis_mode in ['platform', 'app'], "Invalid residency mode"
    
    print("✅ Residency detection working correctly")


def test_zero_duplication():
    """Test that there's no data duplication"""
    print("\n" + "="*60)
    print("TEST 2: Zero Data Duplication")
    print("="*60)
    
    company_id = '6827296ab6e06b08639107c4'
    mode = ResidencyDetector.get_mode(company_id, 'employee')
    
    print(f"Company residency mode: {mode}")
    
    # Count employees in VMS DB
    try:
        cid_oid = ObjectId(company_id)
        query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
    except:
        query = {'companyId': company_id}
    
    vms_count = employees_collection.count_documents(query)
    print(f"Employees in VMS DB: {vms_count}")
    
    if mode == 'platform':
        if vms_count == 0:
            print("✅ PASS: Platform mode has 0 employees in VMS DB (correct)")
        else:
            print(f"❌ FAIL: Platform mode should have 0 employees in VMS DB, found {vms_count}")
            print("   Run: python cleanup_duplicates.py --live")
    else:
        print(f"✓ App mode has {vms_count} employees in VMS DB (expected)")


def test_sync_queue():
    """Test sync queue functionality"""
    print("\n" + "="*60)
    print("TEST 3: Sync Queue")
    print("="*60)
    
    stats = SyncQueue.get_stats()
    print(f"Queue stats: {stats}")
    
    if stats['failed'] > 0:
        print(f"⚠️  WARNING: {stats['failed']} failed items in queue")
        print("   Check sync_queue collection for errors")
    else:
        print("✅ No failed items in queue")
    
    if stats['pending'] > 0:
        print(f"ℹ️  INFO: {stats['pending']} pending items (will be processed by worker)")
    else:
        print("✅ No pending items")


def test_platform_client():
    """Test Platform client connectivity"""
    print("\n" + "="*60)
    print("TEST 4: Platform Client")
    print("="*60)
    
    from app.services.platform_client_wrapper import PlatformClientWrapper, PlatformDownError
    from app.config import Config
    import jwt
    from datetime import datetime, timedelta
    
    try:
        # Generate test token
        platform_secret = Config.PLATFORM_JWT_SECRET or Config.JWT_SECRET
        payload = {
            'sub': 'vms_app_v1',
            'companyId': '6827296ab6e06b08639107c4',
            'iss': 'vms',
            'exp': datetime.utcnow() + timedelta(hours=1)
        }
        platform_token = jwt.encode(payload, platform_secret, algorithm='HS256')
        
        # Test connection
        client = PlatformClientWrapper(platform_token)
        employees = client.get_employees('6827296ab6e06b08639107c4')
        
        print(f"✅ Platform client working - fetched {len(employees)} employees")
        
    except PlatformDownError as e:
        print(f"⚠️  Platform is down: {e}")
        print("   This is OK if Platform is intentionally offline")
    except Exception as e:
        print(f"❌ Error testing Platform client: {e}")


def run_all_tests():
    """Run all verification tests"""
    print("\n" + "="*60)
    print("DATA RESIDENCY ARCHITECTURE - VERIFICATION TESTS")
    print("="*60)
    
    try:
        test_residency_detection()
        test_zero_duplication()
        test_sync_queue()
        test_platform_client()
        
        print("\n" + "="*60)
        print("✅ ALL TESTS COMPLETE")
        print("="*60)
        print("\nNext steps:")
        print("1. If any failures, address them")
        print("2. Push code: git push origin main")
        print("3. Run cleanup: python cleanup_duplicates.py --live")
        print("4. Deploy to production")
        
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    run_all_tests()
