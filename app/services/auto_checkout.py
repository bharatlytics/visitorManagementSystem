"""
Auto-Checkout Service
Automatically checks out visitors who have exceeded the configured duration
"""
from datetime import datetime, timedelta, timezone
from bson import ObjectId

from app.db import visit_collection, settings_collection


def get_auto_checkout_hours(company_id):
    """Get auto-checkout hours setting for a company"""
    try:
        company_oid = ObjectId(company_id)
        query = {'$or': [{'companyId': company_oid}, {'companyId': company_id}]}
    except:
        query = {'companyId': company_id}
    
    settings = settings_collection.find_one(query)
    return settings.get('autoCheckoutHours', 8) if settings else 8


def run_auto_checkout(company_id=None):
    """
    Process overdue visits and auto-checkout them.
    
    Args:
        company_id: Optional. If provided, only process visits for this company.
                   If None, process all companies.
    
    Returns:
        int: Number of visits auto-checked out
    """
    now = datetime.now(timezone.utc)
    auto_checked_out = 0
    
    # Build base query for checked-in visits
    base_query = {'status': 'checked_in', 'actualArrival': {'$exists': True}}
    
    if company_id:
        try:
            company_oid = ObjectId(company_id)
            base_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            base_query['companyId'] = company_id
    
    # Find all checked-in visits
    checked_in_visits = list(visit_collection.find(base_query))
    
    for visit in checked_in_visits:
        visit_company_id = visit.get('companyId')
        if isinstance(visit_company_id, ObjectId):
            visit_company_id = str(visit_company_id)
        
        # Get auto-checkout hours for this company
        auto_checkout_hours = get_auto_checkout_hours(visit_company_id)
        
        # Calculate cutoff time
        cutoff_time = now - timedelta(hours=auto_checkout_hours)
        
        actual_arrival = visit.get('actualArrival')
        if actual_arrival:
            # Ensure timezone-aware comparison
            if actual_arrival.tzinfo is None:
                actual_arrival = actual_arrival.replace(tzinfo=timezone.utc)
            
            if actual_arrival < cutoff_time:
                # Auto-checkout this visit
                visit_collection.update_one(
                    {'_id': visit['_id']},
                    {
                        '$set': {
                            'status': 'checked_out',
                            'actualDeparture': now,
                            'checkOutMethod': 'auto',
                            'autoCheckoutReason': f'Exceeded {auto_checkout_hours} hour limit',
                            'lastUpdated': now
                        }
                    }
                )
                auto_checked_out += 1
                print(f"[Auto-Checkout] Checked out visit {visit['_id']} (exceeded {auto_checkout_hours}h)")
    
    if auto_checked_out > 0:
        print(f"[Auto-Checkout] Processed {auto_checked_out} overdue visits")
    
    return auto_checked_out
