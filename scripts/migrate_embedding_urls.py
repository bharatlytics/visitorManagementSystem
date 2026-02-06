"""
Migration Script: Add downloadUrl to visitor embeddings
========================================================
This script adds the missing downloadUrl field to visitor embeddings
that have embeddingId but no downloadUrl.
"""
from pymongo import MongoClient
from bson import ObjectId
import os
from dotenv import load_dotenv

load_dotenv()

# MongoDB connection
VMS_MONGODB_URI = os.environ.get('VMS_MONGODB_URI', 'mongodb://localhost:27017/vms_db')
print(f"Connecting to: {VMS_MONGODB_URI[:60]}...")

client = MongoClient(VMS_MONGODB_URI)
db_name = VMS_MONGODB_URI.split('/')[-1].split('?')[0] if '/' in VMS_MONGODB_URI else ''
if not db_name:
    db_name = 'blGroup_visitorManagementSystem'
print(f"Using database: {db_name}")

db = client[db_name]
visitors = db['visitors']
employees = db['employees']


def migrate_visitor_embeddings():
    """Add downloadUrl to visitor embeddings that have embeddingId but no downloadUrl"""
    updated = 0
    skipped = 0
    
    # Find visitors with embeddings
    cursor = visitors.find({
        'visitorEmbeddings': {'$exists': True, '$ne': {}}
    })
    
    for visitor in cursor:
        visitor_id = visitor['_id']
        embeddings = visitor.get('visitorEmbeddings', {})
        updates = {}
        
        for model, emb_data in embeddings.items():
            if isinstance(emb_data, dict):
                embedding_id = emb_data.get('embeddingId')
                download_url = emb_data.get('downloadUrl')
                
                # If has embeddingId but no downloadUrl, add it
                if embedding_id and not download_url:
                    new_url = f"/api/visitors/embeddings/{embedding_id}"
                    updates[f'visitorEmbeddings.{model}.downloadUrl'] = new_url
                    print(f"  Visitor {visitor_id}: Adding downloadUrl for {model} -> {new_url}")
        
        if updates:
            visitors.update_one({'_id': visitor_id}, {'$set': updates})
            updated += 1
        else:
            skipped += 1
    
    print(f"\nVisitors: Updated {updated}, Skipped {skipped}")
    return updated


def migrate_employee_embeddings():
    """Add downloadUrl to employee embeddings that have embeddingId but no downloadUrl"""
    updated = 0
    skipped = 0
    
    # Find employees with embeddings
    cursor = employees.find({
        'employeeEmbeddings': {'$exists': True, '$ne': {}}
    })
    
    for employee in cursor:
        employee_id = employee['_id']
        embeddings = employee.get('employeeEmbeddings', {})
        updates = {}
        
        for model, emb_data in embeddings.items():
            if isinstance(emb_data, dict):
                embedding_id = emb_data.get('embeddingId')
                download_url = emb_data.get('downloadUrl')
                
                # If has embeddingId but no downloadUrl, add it
                if embedding_id and not download_url:
                    new_url = f"/api/employees/embeddings/{embedding_id}"
                    updates[f'employeeEmbeddings.{model}.downloadUrl'] = new_url
                    print(f"  Employee {employee_id}: Adding downloadUrl for {model} -> {new_url}")
        
        if updates:
            employees.update_one({'_id': employee_id}, {'$set': updates})
            updated += 1
        else:
            skipped += 1
    
    print(f"\nEmployees: Updated {updated}, Skipped {skipped}")
    return updated


if __name__ == "__main__":
    print("=" * 60)
    print("Migration: Add downloadUrl to embeddings")
    print("=" * 60)
    
    print("\n--- Migrating Visitors ---")
    visitor_count = migrate_visitor_embeddings()
    
    print("\n--- Migrating Employees ---")
    employee_count = migrate_employee_embeddings()
    
    print("\n" + "=" * 60)
    print(f"Migration complete!")
    print(f"  Visitors updated: {visitor_count}")
    print(f"  Employees updated: {employee_count}")
    print("=" * 60)
