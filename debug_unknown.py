from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
client = MongoClient(os.getenv('VMS_MONGODB_URI'))
db = client.get_default_database()

print("=== Checked-in visits ===")
visits = list(db['visits'].find({'status': 'checked_in'}).limit(10))
for v in visits:
    print(f"Visit {v.get('_id')}:")
    print(f"  visitorName: {v.get('visitorName')}")
    print(f"  visitorId: {v.get('visitorId')}")
    print(f"  actualArrival: {v.get('actualArrival')}")
    print(f"  hostEmployeeName: {v.get('hostEmployeeName')}")
    print()

print("\n=== Checking visitors collection ===")
for v in visits:
    visitor_id = v.get('visitorId')
    if visitor_id:
        visitor = db['visitors'].find_one({'_id': visitor_id})
        print(f"Visitor {visitor_id}: {visitor.get('visitorName') if visitor else 'NOT FOUND'}")
