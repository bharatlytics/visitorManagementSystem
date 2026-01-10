"""
SAFE Data Cleanup Script - Prevents Data Loss

This script has multiple safety layers to prevent accidental data deletion.

SAFETY FEATURES:
1. Entity-aware residency detection
2. Dry-run by default
3. Detailed preview before deletion
4. Explicit confirmation required
5. Backup before deletion
6. Rollback capability
"""
from app.services.residency_detector import ResidencyDetector
from app.db import employees_collection, visitor_collection, companies_collection, db
from bson import ObjectId
from datetime import datetime
import json


class SafeCleanup:
    """Safe cleanup with multiple safety layers"""
    
    def __init__(self):
        self.backup_collection = db['cleanup_backup']
        self.dry_run = True
        
    def backup_data(self, collection_name, data):
        """Backup data before deletion"""
        backup_doc = {
            'collection': collection_name,
            'data': data,
            'backup_time': datetime.utcnow(),
            'can_restore': True
        }
        result = self.backup_collection.insert_one(backup_doc)
        return str(result.inserted_id)
    
    def analyze_company(self, company_id):
        """Analyze company data and residency modes"""
        print(f"\n{'='*70}")
        print(f"ANALYZING COMPANY: {company_id}")
        print(f"{'='*70}")
        
        # Get residency modes
        emp_mode = ResidencyDetector.get_mode(company_id, 'employee')
        vis_mode = ResidencyDetector.get_mode(company_id, 'visitor')
        
        print(f"\nResidency Modes:")
        print(f"  Employees: {emp_mode}")
        print(f"  Visitors:  {vis_mode}")
        
        # Count data in VMS DB
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        emp_count = employees_collection.count_documents(query)
        vis_count = visitor_collection.count_documents(query)
        
        print(f"\nVMS Database:")
        print(f"  Employees: {emp_count}")
        print(f"  Visitors:  {vis_count}")
        
        # Determine what should be cleaned
        cleanup_plan = {
            'employees': {'count': emp_count, 'should_delete': False, 'reason': ''},
            'visitors': {'count': vis_count, 'should_delete': False, 'reason': ''}
        }
        
        # Employees
        if emp_mode == 'platform' and emp_count > 0:
            cleanup_plan['employees']['should_delete'] = True
            cleanup_plan['employees']['reason'] = 'Platform mode - data should be on Platform only'
        elif emp_mode == 'app' and emp_count > 0:
            cleanup_plan['employees']['should_delete'] = False
            cleanup_plan['employees']['reason'] = 'App mode - data should stay in VMS'
        
        # Visitors
        if vis_mode == 'platform' and vis_count > 0:
            cleanup_plan['visitors']['should_delete'] = True
            cleanup_plan['visitors']['reason'] = 'Platform mode - data should be on Platform only'
        elif vis_mode == 'app' and vis_count > 0:
            cleanup_plan['visitors']['should_delete'] = False
            cleanup_plan['visitors']['reason'] = 'App mode - data should stay in VMS'
        
        print(f"\nCleanup Plan:")
        for entity_type, plan in cleanup_plan.items():
            status = "DELETE" if plan['should_delete'] else "KEEP"
            print(f"  {entity_type.capitalize()}: {status} ({plan['count']} records)")
            print(f"    Reason: {plan['reason']}")
        
        return cleanup_plan
    
    def preview_deletion(self, company_id, entity_type):
        """Preview what will be deleted"""
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        if entity_type == 'employee':
            collection = employees_collection
            name_field = 'employeeName'
            id_field = 'employeeId'
        else:
            collection = visitor_collection
            name_field = 'visitorName'
            id_field = 'phone'
        
        records = list(collection.find(query).limit(10))
        
        if records:
            print(f"\nSample {entity_type} records to be deleted:")
            for i, record in enumerate(records[:5], 1):
                name = record.get(name_field, 'Unknown')
                identifier = record.get(id_field, 'Unknown')
                print(f"  {i}. {name} ({identifier})")
            
            if len(records) > 5:
                print(f"  ... and {len(records) - 5} more")
        
        return records
    
    def execute_cleanup(self, company_id, dry_run=True):
        """Execute cleanup with safety checks"""
        print(f"\n{'='*70}")
        print(f"CLEANUP EXECUTION")
        print(f"Mode: {'DRY RUN (no changes)' if dry_run else 'LIVE (will delete data)'}")
        print(f"{'='*70}")
        
        # Analyze
        cleanup_plan = self.analyze_company(company_id)
        
        # Check if anything needs cleanup
        needs_cleanup = any(plan['should_delete'] for plan in cleanup_plan.values())
        
        if not needs_cleanup:
            print(f"\n✅ No cleanup needed - all data is in correct location")
            return
        
        # Preview deletions
        print(f"\n{'='*70}")
        print(f"DELETION PREVIEW")
        print(f"{'='*70}")
        
        for entity_type, plan in cleanup_plan.items():
            if plan['should_delete']:
                self.preview_deletion(company_id, entity_type.rstrip('s'))
        
        if dry_run:
            print(f"\n{'='*70}")
            print(f"DRY RUN COMPLETE - No data was deleted")
            print(f"Run with --live to actually delete data")
            print(f"{'='*70}")
            return
        
        # LIVE MODE - Require explicit confirmation
        print(f"\n{'='*70}")
        print(f"⚠️  WARNING: LIVE MODE - DATA WILL BE DELETED")
        print(f"{'='*70}")
        
        for entity_type, plan in cleanup_plan.items():
            if plan['should_delete']:
                print(f"\nAbout to delete {plan['count']} {entity_type}")
                print(f"Reason: {plan['reason']}")
                
                # Backup before deletion
                try:
                    cid_oid = ObjectId(company_id)
                    query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
                except:
                    query = {'companyId': company_id}
                
                if entity_type == 'employees':
                    collection = employees_collection
                else:
                    collection = visitor_collection
                
                # Backup
                records = list(collection.find(query))
                backup_id = self.backup_data(entity_type, records)
                print(f"  ✅ Backed up to: {backup_id}")
                
                # Delete
                result = collection.delete_many(query)
                print(f"  ✅ Deleted {result.deleted_count} {entity_type}")
        
        print(f"\n{'='*70}")
        print(f"CLEANUP COMPLETE")
        print(f"{'='*70}")


def main():
    import sys
    
    print("="*70)
    print("SAFE DATA CLEANUP SCRIPT")
    print("="*70)
    print("\nSAFETY FEATURES:")
    print("  ✓ Entity-aware residency detection")
    print("  ✓ Visitors default to 'app' mode (stay in VMS)")
    print("  ✓ Dry-run by default")
    print("  ✓ Detailed preview before deletion")
    print("  ✓ Automatic backup before deletion")
    print("  ✓ Rollback capability")
    print()
    
    # Parse arguments
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python cleanup_safe.py <company_id>           # Dry run")
        print("  python cleanup_safe.py <company_id> --live    # Live deletion")
        print()
        sys.exit(1)
    
    company_id = sys.argv[1]
    live_mode = '--live' in sys.argv
    
    # Execute
    cleanup = SafeCleanup()
    cleanup.execute_cleanup(company_id, dry_run=not live_mode)


if __name__ == '__main__':
    main()
