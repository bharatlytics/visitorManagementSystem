"""
Cleanup Test Visitors Script
Removes duplicate test visitors created during E2E testing
"""
import os
import sys

# Add the project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from pymongo import MongoClient
from bson import ObjectId
from app.config import Config

def cleanup_test_visitors():
    """Remove test visitors created during E2E testing"""
    
    client = MongoClient(Config.VMS_MONGODB_URI)
    db = client.get_default_database()
    visitors = db['visitors']
    
    # Find test visitors (name pattern: "Test Visitor XXXXXXX")
    test_pattern = {"visitorName": {"$regex": "^Test Visitor \\d+$"}}
    
    test_visitors = list(visitors.find(test_pattern))
    print(f"Found {len(test_visitors)} test visitors")
    
    if len(test_visitors) == 0:
        print("No test visitors to clean up.")
        return
    
    # Group by phone number to find duplicates
    phone_groups = {}
    for v in test_visitors:
        phone = v.get('phone', 'unknown')
        if phone not in phone_groups:
            phone_groups[phone] = []
        phone_groups[phone].append(v)
    
    # Remove duplicates, keeping only the oldest one
    deleted_count = 0
    for phone, group in phone_groups.items():
        if len(group) > 1:
            # Sort by createdAt, keep oldest
            sorted_group = sorted(group, key=lambda x: x.get('createdAt', x['_id'].generation_time))
            
            # Delete all except the oldest
            for visitor in sorted_group[1:]:
                visitors.delete_one({'_id': visitor['_id']})
                deleted_count += 1
                print(f"  Deleted duplicate: {visitor['visitorName']} ({visitor['_id']})")
    
    print(f"\nDeleted {deleted_count} duplicate test visitors")
    print(f"Remaining: {visitors.count_documents(test_pattern)} test visitors")


def cleanup_all_test_visitors():
    """Remove ALL test visitors (use with caution)"""
    
    client = MongoClient(Config.VMS_MONGODB_URI)
    db = client.get_default_database()
    visitors = db['visitors']
    
    test_pattern = {"visitorName": {"$regex": "^Test Visitor \\d+$"}}
    
    result = visitors.delete_many(test_pattern)
    print(f"Deleted {result.deleted_count} test visitors")


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Cleanup test visitors')
    parser.add_argument('--all', action='store_true', 
                        help='Delete ALL test visitors, not just duplicates')
    
    args = parser.parse_args()
    
    if args.all:
        confirm = input("This will delete ALL test visitors. Are you sure? (yes/no): ")
        if confirm.lower() == 'yes':
            cleanup_all_test_visitors()
        else:
            print("Aborted.")
    else:
        cleanup_test_visitors()
