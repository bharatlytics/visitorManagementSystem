"""
VMS Platform Notify

Utility to notify Platform of data changes via webhook.
Platform will queue the sync and pull data when ready.

Usage:
    from app.services.platform_notify import notify_data_change
    
    # After registering employee
    notify_data_change('employee', employee_id, company_id, action='created')
"""
import requests
import os
from threading import Thread

PLATFORM_URL = os.getenv('PLATFORM_URL', 'http://localhost:5000')
APP_ID = 'vms_app_v1'


def notify_data_change(record_type, record_id, company_id, action='created'):
    """
    Notify Platform that VMS has new/updated data.
    
    Platform will queue the sync and pull from VMS when ready.
    This is non-blocking - fires and forgets in background thread.
    
    Args:
        record_type: 'employee' or 'visitor'
        record_id: ObjectId or string ID of the record
        company_id: ObjectId or string ID of the company
        action: 'created', 'updated', or 'deleted'
    """
    def _notify():
        try:
            url = f"{PLATFORM_URL}/bharatlytics/integration/v1/data-change"
            
            payload = {
                'appId': APP_ID,
                'companyId': str(company_id),
                'recordType': record_type,
                'recordId': str(record_id),
                'action': action
            }
            
            response = requests.post(url, json=payload, timeout=5)
            
            if response.status_code in [200, 202]:
                print(f"[VMS->Platform] Notified: {record_type}/{record_id} ({action})")
            else:
                print(f"[VMS->Platform] Notify failed: {response.status_code} - {response.text[:100]}")
                
        except requests.RequestException as e:
            # Log but don't fail - sync will be retried by platform reconciliation
            print(f"[VMS->Platform] Notify error (will retry): {e}")
    
    # Run in background thread to not block the API response
    thread = Thread(target=_notify, daemon=True)
    thread.start()
    
    return True  # Always return success - actual sync is async
