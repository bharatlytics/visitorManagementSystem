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

print("=== Creating Employees and Entities ===")

# Get company ID from first visit
first_visit = db['visits'].find_one()
if not first_visit:
    print("No visits found. Cannot determine company ID.")
    exit(1)

company_id = first_visit.get('companyId')
print(f"Company ID: {company_id}")

# 1. Extract unique employees from visits
print("\n1. Creating employees from visit data...")
employee_map = {}
for visit in db['visits'].find():
    host_id = visit.get('hostEmployeeId')
    host_name = visit.get('hostEmployeeName')
    
    if host_id and host_id not in employee_map:
        employee_map[host_id] = host_name or 'Unknown'

print(f"Found {len(employee_map)} unique employees in visits")

# Create employee records
for emp_id, emp_name in employee_map.items():
    # Check if employee already exists
    existing = db['employees'].find_one({'_id': ObjectId(emp_id) if ObjectId.is_valid(emp_id) else emp_id})
    if not existing:
        employee = {
            '_id': ObjectId(emp_id) if ObjectId.is_valid(emp_id) else ObjectId(),
            'companyId': company_id,
            'employeeName': emp_name,
            'email': f"{emp_name.lower().replace(' ', '.')}@company.com" if emp_name != 'Unknown' else None,
            'phone': None,
            'department': 'General',
            'designation': 'Employee'
        }
        db['employees'].insert_one(employee)
        print(f"  Created employee: {emp_name} ({emp_id})")
    else:
        print(f"  Employee already exists: {emp_name}")

# 2. Create sample entities (locations)
print("\n2. Creating sample entities...")
sample_entities = [
    {'name': 'Main Gate', 'type': 'gate'},
    {'name': 'Reception', 'type': 'reception'},
    {'name': 'Building A', 'type': 'building'},
    {'name': 'Building B', 'type': 'building'},
    {'name': 'Parking Lot', 'type': 'parking'}
]

for entity_data in sample_entities:
    # Check if entity already exists
    existing = db['entities'].find_one({'companyId': company_id, 'name': entity_data['name']})
    if not existing:
        entity = {
            '_id': ObjectId(),
            'companyId': company_id,
            'name': entity_data['name'],
            'type': entity_data['type'],
            'metadata': {}
        }
        db['entities'].insert_one(entity)
        print(f"  Created entity: {entity_data['name']} ({entity_data['type']})")
    else:
        print(f"  Entity already exists: {entity_data['name']}")

print("\n=== Setup Complete ===")
print(f"Employees: {db['employees'].count_documents({})}")
print(f"Entities: {db['entities'].count_documents({})}")
