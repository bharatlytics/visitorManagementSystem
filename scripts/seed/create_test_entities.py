"""Create test entities in VMS local database"""
from app.db import entities_collection
from bson import ObjectId
from datetime import datetime

company_id = ObjectId('6827296ab6e06b08639107c4')

# Create some test entities
test_entities = [
    {
        'companyId': company_id,
        'name': 'JBM Auto (organization)',
        'type': 'organization',
        'status': 'active',
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow()
    },
    {
        'companyId': company_id,
        'name': 'Main Office',
        'type': 'organization',
        'status': 'active',
        'createdAt': datetime.utcnow(),
        'updatedAt': datetime.utcnow()
    }
]

# Clear existing entities for this company
entities_collection.delete_many({'companyId': company_id})

# Insert test entities
result = entities_collection.insert_many(test_entities)
print(f"Created {len(result.inserted_ids)} test entities")

# Verify
entities = list(entities_collection.find({'companyId': company_id}))
print(f"\nVerified {len(entities)} entities in database:")
for e in entities:
    print(f"  - {e['name']} (type: {e['type']})")
