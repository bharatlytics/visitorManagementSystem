from pymongo import MongoClient
import os
from dotenv import load_dotenv
from bson import ObjectId

load_dotenv()
client = MongoClient(os.getenv('VMS_MONGODB_URI'))
db = client.get_default_database()

print("=== Fixing invalid visit records ===")

# Find visits with missing visitorName or actualArrival
invalid_visits = list(db['visits'].find({
    '$or': [
        {'visitorName': None},
        {'visitorName': {'$exists': False}},
        {'actualArrival': None},
        {'actualArrival': {'$exists': False}}
    ],
    'status': 'checked_in'
}))

print(f"Found {len(invalid_visits)} invalid checked-in visits")

for visit in invalid_visits:
    visit_id = visit['_id']
    visitor_id = visit.get('visitorId')
    
    print(f"\nFixing visit {visit_id}...")
    
    # If visitor exists, populate visitorName
    if visitor_id:
        visitor = db['visitors'].find_one({'_id': visitor_id})
        if visitor:
            visitor_name = visitor.get('visitorName')
            print(f"  Found visitor: {visitor_name}")
            
            # Update the visit with visitor name
            db['visits'].update_one(
                {'_id': visit_id},
                {'$set': {'visitorName': visitor_name}}
            )
            print(f"  Updated visitorName to: {visitor_name}")
    
    # If actualArrival is missing, this visit is invalid - check it out
    if not visit.get('actualArrival'):
        print(f"  Visit has no actualArrival - marking as invalid/checked_out")
        db['visits'].update_one(
            {'_id': visit_id},
            {'$set': {
                'status': 'checked_out',
                'checkOutMethod': 'system_cleanup',
                'actualDeparture': None
            }}
        )

print("\n=== Cleanup complete ===")
