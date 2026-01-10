from app.db import entities_collection
from bson import ObjectId

company_id = '6827296ab6e06b08639107c4'

# Try both string and ObjectId
entities_str = list(entities_collection.find({'companyId': company_id}))
entities_oid = list(entities_collection.find({'companyId': ObjectId(company_id)}))

print(f"Entities with string companyId: {len(entities_str)}")
print(f"Entities with ObjectId companyId: {len(entities_oid)}")

if entities_oid:
    print("\nFirst 5 entities:")
    for e in entities_oid[:5]:
        print(f"  - {e.get('name')} (type: {e.get('type')})")
else:
    print("\nNo entities found in VMS database!")
    print("This means VMS needs to fetch from platform, but auth is failing.")
