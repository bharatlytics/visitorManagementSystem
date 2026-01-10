"""
Check what entities exist in VMS local database
"""
import sys
sys.path.insert(0, 'c:\\Users\\sahil\\OneDrive\\Documents\\GitHub\\visitorManagementSystem')

from app.db import entities_collection
from bson import ObjectId

company_id = "6827296ab6e06b08639107c4"

print("="*60)
print("Checking VMS Local Database for Entities")
print("="*60)

try:
    cid_oid = ObjectId(company_id)
    query = {'$or': [{'companyId': cid_oid}, {'companyId': company_id}]}
except:
    query = {'companyId': company_id}

entities = list(entities_collection.find(query))

print(f"\nFound {len(entities)} entities in VMS local DB:")
for ent in entities:
    print(f"  - {ent.get('name')} (type: {ent.get('type')})")

print("\n" + "="*60)
