"""Delete test entities from VMS database"""
from app.db import entities_collection
from bson import ObjectId

company_id = ObjectId('6827296ab6e06b08639107c4')

# Delete test entities
result = entities_collection.delete_many({'companyId': company_id})
print(f"Deleted {result.deleted_count} test entities from VMS database")

# Verify
entities = list(entities_collection.find({'companyId': company_id}))
print(f"Remaining entities in VMS: {len(entities)}")
