"""
Background Worker for Sync Queue Processing

Processes pending sync queue items and retries failed operations.
Should be run as a background task or cron job.
"""
import time
from app.services.sync_queue import SyncQueue


def process_sync_queue_worker():
    """
    Background worker that continuously processes the sync queue.
    Run this in a separate thread or process.
    """
    print("[SyncQueueWorker] Starting background worker...")
    
    while True:
        try:
            # Process pending items
            SyncQueue.process_queue()
            
            # Get stats
            stats = SyncQueue.get_stats()
            if stats['pending'] > 0 or stats['failed'] > 0:
                print(f"[SyncQueueWorker] Queue stats: {stats}")
            
            # Sleep for 60 seconds before next check
            time.sleep(60)
            
        except KeyboardInterrupt:
            print("[SyncQueueWorker] Shutting down...")
            break
        except Exception as e:
            print(f"[SyncQueueWorker] Error: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(60)  # Wait before retry


if __name__ == '__main__':
    # Run worker directly
    process_sync_queue_worker()
