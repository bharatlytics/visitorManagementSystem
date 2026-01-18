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


def auto_cancel_stale_visits(company_id=None, hours_threshold=24):
    """
    Auto-cancel scheduled visits that were not checked-in within threshold.
    
    Visits that remain in 'scheduled' status past their expected arrival
    plus the threshold hours are automatically cancelled.
    
    Args:
        company_id: Optional. If provided, only process visits for this company.
        hours_threshold: Hours after expected arrival to wait before cancelling (default: 24)
    
    Returns:
        int: Number of visits cancelled
    """
    now = datetime.now(timezone.utc)
    cancelled_count = 0
    
    # Build query for scheduled visits past their expected arrival
    cutoff_time = now - timedelta(hours=hours_threshold)
    
    base_query = {
        'status': 'scheduled',
        'expectedArrival': {'$lt': cutoff_time}
    }
    
    if company_id:
        try:
            company_oid = ObjectId(company_id)
            base_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            base_query['companyId'] = company_id
    
    # Find stale visits
    stale_visits = list(visit_collection.find(base_query))
    
    for visit in stale_visits:
        visit_collection.update_one(
            {'_id': visit['_id']},
            {
                '$set': {
                    'status': 'cancelled',
                    'cancelReason': f'Auto-cancelled: Not checked-in within {hours_threshold} hours of scheduled time',
                    'cancelledAt': now,
                    'lastUpdated': now,
                    'autoCancelled': True
                }
            }
        )
        cancelled_count += 1
        print(f"[Auto-Cancel] Cancelled stale visit {visit['_id']} (scheduled for {visit.get('expectedArrival')})")
    
    if cancelled_count > 0:
        print(f"[Auto-Cancel] Cancelled {cancelled_count} stale visits")
    
    return cancelled_count


def auto_mark_no_shows(company_id=None, hours_buffer=4):
    """
    Mark scheduled visits as 'no_show' if visitor didn't arrive.
    
    Visits that remain in 'scheduled' status past their expected arrival
    plus the buffer hours are marked as no-show (but not cancelled).
    This allows for reporting while preserving the visit record.
    
    Args:
        company_id: Optional. If provided, only process visits for this company.
        hours_buffer: Hours after expected arrival to wait before marking no-show (default: 4)
    
    Returns:
        int: Number of visits marked as no-show
    """
    now = datetime.now(timezone.utc)
    no_show_count = 0
    
    # Build query for scheduled visits past their expected arrival + buffer
    cutoff_time = now - timedelta(hours=hours_buffer)
    
    base_query = {
        'status': 'scheduled',
        'expectedArrival': {'$lt': cutoff_time},
        'noShowMarked': {'$ne': True}  # Not already marked
    }
    
    if company_id:
        try:
            company_oid = ObjectId(company_id)
            base_query['$or'] = [{'companyId': company_oid}, {'companyId': company_id}]
        except:
            base_query['companyId'] = company_id
    
    # Find no-show candidates
    no_show_visits = list(visit_collection.find(base_query))
    
    for visit in no_show_visits:
        visit_collection.update_one(
            {'_id': visit['_id']},
            {
                '$set': {
                    'noShowMarked': True,
                    'noShowMarkedAt': now,
                    'lastUpdated': now
                }
            }
        )
        no_show_count += 1
        print(f"[No-Show] Marked visit {visit['_id']} as no-show (expected at {visit.get('expectedArrival')})")
    
    if no_show_count > 0:
        print(f"[No-Show] Marked {no_show_count} visits as no-show")
    
    return no_show_count


def run_all_visit_maintenance(company_id=None):
    """
    Run all visit maintenance tasks:
    1. Auto-checkout overdue visitors
    2. Mark no-shows
    3. Cancel stale visits
    
    This should be called periodically (e.g., every hour via cron/scheduler).
    
    Args:
        company_id: Optional. If provided, only process for this company.
    
    Returns:
        dict: Summary of actions taken
    """
    results = {
        'autoCheckouts': run_auto_checkout(company_id),
        'noShows': auto_mark_no_shows(company_id),
        'staleCancellations': auto_cancel_stale_visits(company_id),
        'processedAt': datetime.now(timezone.utc).isoformat()
    }
    
    print(f"[Visit Maintenance] Complete: {results}")
    return results
