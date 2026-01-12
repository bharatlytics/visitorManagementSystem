"""Check all VMS data"""
from pymongo import MongoClient
client = MongoClient('mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/vms_dev?retryWrites=true&w=majority&appName=Cluster0')
db = client.get_default_database()

print(f"Database name: {db.name}")
print(f"\nCollections: {db.list_collection_names()}")

print(f"\nVisitors count: {db.visitors.count_documents({})}")
print(f"Employees count: {db.employees.count_documents({})}")

# Check specific visitor  
vis_id = '69649062d58254b032de1050'
from bson import ObjectId
visitor = db.visitors.find_one({'_id': ObjectId(vis_id)})
if visitor:
    print(f"\nFound visitor {vis_id}:")
    print(f"  Name: {visitor.get('visitorName')}")
    print(f"  Images: {list(visitor.get('visitorImages', {}).keys())}")
    print(f"  Embeddings: {visitor.get('visitorEmbeddings')}")
else:
    print(f"\nVisitor {vis_id} NOT found in visitors collection")
    
# Check all company IDs in visitors
print("\nAll visitors by company:")
for v in db.visitors.find({}, {'companyId': 1, 'visitorName': 1}):
    print(f"  {v}")
