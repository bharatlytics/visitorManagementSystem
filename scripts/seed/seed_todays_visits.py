"""
Seed visits for today with various statuses for analytics and reports testing.
Uses existing visitors from VMS DB and employees from platform.
"""
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timedelta
import random
import os
from dotenv import load_dotenv

load_dotenv()

# Connect to VMS database
vms_client = MongoClient(os.getenv('VMS_MONGODB_URI'))
vms_db = vms_client.get_default_database()

# Connect to Platform database (same MongoDB but different db potentially)
platform_uri = os.getenv('PLATFORM_MONGODB_URI', os.getenv('VMS_MONGODB_URI'))
platform_client = MongoClient(platform_uri)

# Try to use platform's database for actors
try:
    platform_db = platform_client['bharatlytics']
except:
    platform_db = vms_db

print("=== Seeding Visit Data for Today ===")
print(f"Current time: {datetime.now()}")

# Get company ID from existing visits
existing_visit = vms_db['visits'].find_one()
if not existing_visit:
    print("No existing visits found to get company ID")
    exit(1)

company_id = existing_visit.get('companyId')
print(f"Company ID: {company_id}")

# Get existing visitors from VMS
visitors = list(vms_db['visitors'].find({'companyId': {'$in': [company_id, str(company_id)]}}))
if not visitors:
    # Try without company filter
    visitors = list(vms_db['visitors'].find().limit(10))
print(f"Found {len(visitors)} visitors")

# Get employees from platform actors collection
employees = []
try:
    # Try platform's actors collection
    actors = list(platform_db['actors'].find({
        'companyId': {'$in': [company_id, str(company_id), ObjectId(company_id) if ObjectId.is_valid(str(company_id)) else company_id]},
        'actorType': 'employee'
    }))
    for actor in actors:
        attrs = actor.get('attributes', {})
        employees.append({
            '_id': str(actor['_id']),
            'name': attrs.get('employeeName') or attrs.get('name') or 'Unknown Employee'
        })
except Exception as e:
    print(f"Error fetching from platform: {e}")

# Fallback to local employees
if not employees:
    local_emps = list(vms_db['employees'].find())
    for emp in local_emps:
        employees.append({
            '_id': str(emp['_id']),
            'name': emp.get('employeeName') or emp.get('name') or 'Unknown'
        })

# If still no employees, create from existing visit hostEmployeeNames
if not employees:
    host_names = vms_db['visits'].distinct('hostEmployeeName')
    for i, name in enumerate(host_names):
        if name and name != 'Unknown':
            employees.append({'_id': f'emp_{i}', 'name': name})

print(f"Found {len(employees)} employees/hosts")

if not visitors or not employees:
    print("Need at least 1 visitor and 1 employee to seed data")
    exit(1)

# Define visit types and purposes
visit_types = ['guest', 'vendor', 'contractor', 'interview', 'delivery']
purposes = [
    'Business Meeting', 'Project Discussion', 'Interview', 
    'Vendor Review', 'Equipment Delivery', 'Training Session',
    'Client Visit', 'Audit', 'Maintenance', 'Consultation'
]
check_in_methods = ['manual', 'qr', 'face']

# Get today's date range
today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
work_start = today.replace(hour=8)  # 8 AM
work_end = today.replace(hour=18)   # 6 PM

# Generate visits
new_visits = []
statuses = {
    'scheduled': 5,      # 5 scheduled for later today
    'checked_in': 6,     # 6 currently checked in
    'checked_out': 7     # 7 completed visits
}

visit_count = 0
for status, count in statuses.items():
    for i in range(count):
        visitor = random.choice(visitors)
        employee = random.choice(employees)
        
        # Random time during work hours
        random_minutes = random.randint(0, 600)  # 0-10 hours from 8 AM
        expected_arrival = work_start + timedelta(minutes=random_minutes)
        expected_departure = expected_arrival + timedelta(hours=random.randint(1, 4))
        
        visit = {
            '_id': ObjectId(),
            'companyId': company_id,
            'visitorId': visitor['_id'],
            'visitorName': visitor.get('visitorName') or visitor.get('name') or 'Visitor',
            'visitorCompany': visitor.get('organization') or visitor.get('company') or '',
            'hostEmployeeId': employee['_id'],
            'hostEmployeeName': employee['name'],
            'visitType': random.choice(visit_types),
            'purpose': random.choice(purposes),
            'status': status,
            'expectedArrival': expected_arrival,
            'expectedDeparture': expected_departure,
            'checkInMethod': None,
            'checkOutMethod': None,
            'actualArrival': None,
            'actualDeparture': None,
            'createdAt': datetime.now() - timedelta(days=random.randint(0, 1)),
            'lastUpdated': datetime.now()
        }
        
        if status == 'checked_in':
            # Checked in but not out yet
            arrival_offset = random.randint(-30, 30)  # +/- 30 mins from expected
            visit['actualArrival'] = expected_arrival + timedelta(minutes=arrival_offset)
            visit['checkInMethod'] = random.choice(check_in_methods)
            
        elif status == 'checked_out':
            # Completed visit
            arrival_offset = random.randint(-30, 30)
            departure_offset = random.randint(-30, 60)
            visit['actualArrival'] = expected_arrival + timedelta(minutes=arrival_offset)
            visit['actualDeparture'] = expected_departure + timedelta(minutes=departure_offset)
            visit['checkInMethod'] = random.choice(check_in_methods)
            visit['checkOutMethod'] = random.choice(check_in_methods)
            
            # Calculate duration
            if visit['actualArrival'] and visit['actualDeparture']:
                duration = visit['actualDeparture'] - visit['actualArrival']
                visit['durationMinutes'] = int(duration.total_seconds() / 60)
        
        new_visits.append(visit)
        visit_count += 1

# Insert visits
if new_visits:
    result = vms_db['visits'].insert_many(new_visits)
    print(f"\n✅ Created {len(result.inserted_ids)} visits for today:")
    print(f"   - {statuses['scheduled']} scheduled")
    print(f"   - {statuses['checked_in']} checked in")
    print(f"   - {statuses['checked_out']} checked out")
else:
    print("No visits created")

# Print summary
print("\n=== Visit Summary ===")
for status in ['scheduled', 'checked_in', 'checked_out']:
    count = vms_db['visits'].count_documents({'status': status})
    print(f"  {status}: {count}")

print("\n=== Seeding Complete ===")
