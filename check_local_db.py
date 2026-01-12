"""Check LOCAL MongoDB (VMS default)"""
from pymongo import MongoClient
client = MongoClient('mongodb://localhost:27017/vms_db')
db = client.get_default_database()

print(f'Database: {db.name}')
print(f'Collections: {db.list_collection_names()}')
print(f'Visitors count: {db.visitors.count_documents({})}')
print(f'Employees count: {db.employees.count_documents({})}')

print('\nRecent visitors:')
for v in db.visitors.find().sort('createdAt', -1).limit(5):
    print(f"  Name: {v.get('visitorName')}")
    print(f"  Images: {list(v.get('visitorImages', {}).keys())}")  
    print(f"  Embeddings: {v.get('visitorEmbeddings')}")
    print()
