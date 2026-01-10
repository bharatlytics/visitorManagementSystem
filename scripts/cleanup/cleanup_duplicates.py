"""
Data Cleanup Script - Remove Duplicate Data Based on Residency Mode

This script cleans up duplicate data to ensure:
- Platform mode companies: Data ONLY on Platform (remove VMS copies)
- App mode companies: Data ONLY in VMS (keep VMS data)
"""
from app.services.residency_detector import ResidencyDetector
from app.db import employees_collection, visitor_collection, companies_collection
from bson import ObjectId


def cleanup_employee_duplicates(company_id, dry_run=True):
    """
    Clean up duplicate employee data based on residency mode.
    
    Args:
        company_id: Company ID to clean up
        dry_run: If True, only show what would be deleted (default: True)
    """
    mode = ResidencyDetector.get_mode(company_id, 'employee')
    print(f"\n[Cleanup] Company {company_id} - Employee residency mode: {mode}")
    
    if mode == 'platform':
        # Platform mode: Delete VMS copies
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        count = employees_collection.count_documents(query)
        print(f"[Cleanup] Found {count} employees in VMS DB (should be 0 for platform mode)")
        
        if count > 0:
            if dry_run:
                print(f"[Cleanup] DRY RUN: Would delete {count} employees from VMS DB")
                # Show sample
                sample = employees_collection.find_one(query)
                if sample:
                    print(f"[Cleanup] Sample: {sample.get('employeeName')} ({sample.get('employeeId')})")
            else:
                result = employees_collection.delete_many(query)
                print(f"[Cleanup] ✅ Deleted {result.deleted_count} duplicate employees from VMS DB")
    
    elif mode == 'app':
        # App mode: Keep VMS data
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        count = employees_collection.count_documents(query)
        print(f"[Cleanup] Found {count} employees in VMS DB (correct for app mode)")
        print(f"[Cleanup] ✅ No cleanup needed - data should stay in VMS")


def cleanup_visitor_duplicates(company_id, dry_run=True):
    """Clean up duplicate visitor data based on residency mode."""
    mode = ResidencyDetector.get_mode(company_id, 'visitor')
    print(f"\n[Cleanup] Company {company_id} - Visitor residency mode: {mode}")
    
    if mode == 'platform':
        # Platform mode: Delete VMS copies
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        count = visitor_collection.count_documents(query)
        print(f"[Cleanup] Found {count} visitors in VMS DB (should be 0 for platform mode)")
        
        if count > 0:
            if dry_run:
                print(f"[Cleanup] DRY RUN: Would delete {count} visitors from VMS DB")
            else:
                result = visitor_collection.delete_many(query)
                print(f"[Cleanup] ✅ Deleted {result.deleted_count} duplicate visitors from VMS DB")
    
    elif mode == 'app':
        # App mode: Keep VMS data
        try:
            cid_oid = ObjectId(company_id)
            query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
        except:
            query = {'companyId': company_id}
        
        count = visitor_collection.count_documents(query)
        print(f"[Cleanup] Found {count} visitors in VMS DB (correct for app mode)")
        print(f"[Cleanup] ✅ No cleanup needed - data should stay in VMS")


def cleanup_all_companies(dry_run=True):
    """Clean up all companies"""
    print("=" * 60)
    print("DATA CLEANUP SCRIPT")
    print("=" * 60)
    print(f"Mode: {'DRY RUN (no changes)' if dry_run else 'LIVE (will delete data)'}")
    print()
    
    # Get all companies
    companies = list(companies_collection.find({}))
    print(f"Found {len(companies)} companies in VMS DB\n")
    
    for company in companies:
        company_id = str(company['_id'])
        company_name = company.get('name', 'Unknown')
        print(f"\n{'='*60}")
        print(f"Company: {company_name} ({company_id})")
        print(f"{'='*60}")
        
        cleanup_employee_duplicates(company_id, dry_run)
        cleanup_visitor_duplicates(company_id, dry_run)
    
    print("\n" + "=" * 60)
    if dry_run:
        print("DRY RUN COMPLETE - No data was deleted")
        print("Run with dry_run=False to actually delete duplicates")
    else:
        print("CLEANUP COMPLETE")
    print("=" * 60)


def cleanup_specific_company(company_id, dry_run=True):
    """Clean up a specific company"""
    print("=" * 60)
    print(f"CLEANUP FOR COMPANY: {company_id}")
    print("=" * 60)
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}\n")
    
    cleanup_employee_duplicates(company_id, dry_run)
    cleanup_visitor_duplicates(company_id, dry_run)
    
    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    import sys
    
    # Example usage:
    # python cleanup_duplicates.py                    # Dry run all companies
    # python cleanup_duplicates.py --live             # Clean all companies
    # python cleanup_duplicates.py <company_id>       # Dry run specific company
    # python cleanup_duplicates.py <company_id> --live # Clean specific company
    
    if len(sys.argv) > 1:
        if sys.argv[1] == '--live':
            cleanup_all_companies(dry_run=False)
        elif len(sys.argv) > 2 and sys.argv[2] == '--live':
            cleanup_specific_company(sys.argv[1], dry_run=False)
        else:
            cleanup_specific_company(sys.argv[1], dry_run=True)
    else:
        # Default: dry run all companies
        cleanup_all_companies(dry_run=True)
