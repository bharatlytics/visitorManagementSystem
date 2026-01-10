from pymongo import MongoClient
import os
from dotenv import load_dotenv
from bson import ObjectId

load_dotenv()
mongo_uri = os.getenv('VMS_MONGODB_URI')
if not mongo_uri:
    print("Error: VMS_MONGODB_URI not found in .env")
    exit(1)

client = MongoClient(mongo_uri)
db = client.get_default_database()

print("=== Updating Visits Metadata ===")

# 1. Cache Employees
employees = {}
print("Caching employees...")
for emp in db['employees'].find():
    eid = str(emp['_id'])
    employees[eid] = emp
    if 'employeeId' in emp:
        employees[emp['employeeId']] = emp

# 2. Cache Visitors
visitors = {}
print("Caching visitors...")
for vis in db['visitors'].find():
    vid = str(vis['_id'])
    visitors[vid] = vis

# 3. Cache Entities (Locations)
entities = {}
print("Caching entities...")
for ent in db['entities'].find():
    eid = str(ent['_id'])
    entities[eid] = ent

# 4. Update Visits
visits = list(db['visits'].find())
print(f"Processing {len(visits)} visits...")

updated_count = 0
for visit in visits:
    visit_id = visit['_id']
    updates = {}
    
    # Update Host Name
    if not visit.get('hostEmployeeName') or visit.get('hostEmployeeName') == 'Unknown':
        host_id = visit.get('hostEmployeeId')
        if host_id:
            # Try matching by ID string or ObjectId string
            host = employees.get(str(host_id))
            if host:
                updates['hostEmployeeName'] = host.get('employeeName') or host.get('name')
                print(f"  [{visit_id}] Linked Host: {updates['hostEmployeeName']}")

    # Update Visitor Name
    if not visit.get('visitorName') or visit.get('visitorName') == 'Unknown':
        visitor_id = visit.get('visitorId')
        if visitor_id:
            visitor = visitors.get(str(visitor_id))
            if visitor:
                updates['visitorName'] = visitor.get('visitorName')
                print(f"  [{visit_id}] Linked Visitor: {updates['visitorName']}")

    # Update Location Name
    if not visit.get('locationName'):
        location_id = visit.get('locationId')
        if location_id:
            location = entities.get(str(location_id))
            if location:
                updates['locationName'] = location.get('name')
                print(f"  [{visit_id}] Linked Location: {updates['locationName']}")

    if updates:
        db['visits'].update_one({'_id': visit_id}, {'$set': updates})
        updated_count += 1

print(f"\n=== Update Complete. Updated {updated_count} visits. ===")
