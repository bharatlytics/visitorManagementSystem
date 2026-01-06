"""
Sync Queue System for Fault-Tolerant Data Residency

Handles operations when Platform is down, with retry mechanism and exponential backoff.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from bson import ObjectId
from app.db import db

# Sync queue collection
sync_queue_collection = db['sync_queue']

# Retry schedule (in seconds)
RETRY_SCHEDULE = [60, 300, 900, 3600, 21600, 86400]  # 1min, 5min, 15min, 1hr, 6hr, 24hr
MAX_RETRIES = len(RETRY_SCHEDULE)


class SyncQueue:
    """Manages sync queue for Platform operations"""
    
    @staticmethod
    def enqueue(operation: str, entity_type: str, entity_id: str, 
                data: Dict[str, Any], company_id: str) -> str:
        """
        Add operation to sync queue.
        
        Args:
            operation: 'create', 'update', 'delete'
            entity_type: 'employee', 'visitor'
            entity_id: ID of the entity
            data: Full entity data
            company_id: Company ID
            
        Returns:
            Queue item ID
        """
        queue_item = {
            'operation': operation,
            'entityType': entity_type,
            'entityId': entity_id,
            'data': data,
            'companyId': company_id,
            'status': 'pending',
            'retryCount': 0,
            'nextRetry': datetime.utcnow(),
            'createdAt': datetime.utcnow(),
            'lastAttempt': None,
            'error': None
        }
        
        result = sync_queue_collection.insert_one(queue_item)
        print(f"[SyncQueue] Enqueued {operation} {entity_type} {entity_id}")
        return str(result.inserted_id)
    
    @staticmethod
    def get_pending(limit: int = 10) -> list:
        """Get pending items ready for retry"""
        return list(sync_queue_collection.find({
            'status': 'pending',
            'nextRetry': {'$lte': datetime.utcnow()},
            'retryCount': {'$lt': MAX_RETRIES}
        }).limit(limit))
    
    @staticmethod
    def mark_processing(queue_id: str):
        """Mark item as being processed"""
        sync_queue_collection.update_one(
            {'_id': ObjectId(queue_id)},
            {
                '$set': {
                    'status': 'processing',
                    'lastAttempt': datetime.utcnow()
                }
            }
        )
    
    @staticmethod
    def mark_completed(queue_id: str):
        """Mark item as completed and remove from queue"""
        sync_queue_collection.delete_one({'_id': ObjectId(queue_id)})
        print(f"[SyncQueue] Completed and removed {queue_id}")
    
    @staticmethod
    def mark_failed(queue_id: str, error: str):
        """Mark item as failed and schedule retry"""
        item = sync_queue_collection.find_one({'_id': ObjectId(queue_id)})
        if not item:
            return
        
        retry_count = item.get('retryCount', 0) + 1
        
        if retry_count >= MAX_RETRIES:
            # Max retries exceeded, mark as permanently failed
            sync_queue_collection.update_one(
                {'_id': ObjectId(queue_id)},
                {
                    '$set': {
                        'status': 'failed',
                        'error': error,
                        'failedAt': datetime.utcnow(),
                        'retryCount': retry_count
                    }
                }
            )
            print(f"[SyncQueue] FAILED permanently: {queue_id} - {error}")
        else:
            # Schedule retry with exponential backoff
            next_retry = datetime.utcnow() + timedelta(seconds=RETRY_SCHEDULE[retry_count - 1])
            sync_queue_collection.update_one(
                {'_id': ObjectId(queue_id)},
                {
                    '$set': {
                        'status': 'pending',
                        'error': error,
                        'retryCount': retry_count,
                        'nextRetry': next_retry
                    }
                }
            )
            print(f"[SyncQueue] Retry scheduled for {queue_id} at {next_retry} (attempt {retry_count})")
    
    @staticmethod
    def get_stats() -> Dict[str, int]:
        """Get queue statistics"""
        return {
            'pending': sync_queue_collection.count_documents({'status': 'pending'}),
            'processing': sync_queue_collection.count_documents({'status': 'processing'}),
            'failed': sync_queue_collection.count_documents({'status': 'failed'})
        }
    
    @staticmethod
    def process_queue():
        """
        Process pending queue items.
        Should be called by background worker or cron job.
        """
        from app.services.platform_client_wrapper import PlatformClientWrapper
        
        pending = SyncQueue.get_pending()
        print(f"[SyncQueue] Processing {len(pending)} pending items")
        
        for item in pending:
            queue_id = str(item['_id'])
            SyncQueue.mark_processing(queue_id)
            
            try:
                # Execute the operation
                platform_client = PlatformClientWrapper()
                
                if item['operation'] == 'create':
                    if item['entityType'] == 'employee':
                        platform_client.create_employee(item['companyId'], item['data'])
                    elif item['entityType'] == 'visitor':
                        platform_client.create_visitor(item['companyId'], item['data'])
                
                elif item['operation'] == 'update':
                    if item['entityType'] == 'employee':
                        platform_client.update_employee(item['entityId'], item['data'])
                    elif item['entityType'] == 'visitor':
                        platform_client.update_visitor(item['entityId'], item['data'])
                
                elif item['operation'] == 'delete':
                    if item['entityType'] == 'employee':
                        platform_client.delete_employee(item['entityId'])
                    elif item['entityType'] == 'visitor':
                        platform_client.delete_visitor(item['entityId'])
                
                # Success
                SyncQueue.mark_completed(queue_id)
                
            except Exception as e:
                # Failed, schedule retry
                SyncQueue.mark_failed(queue_id, str(e))
