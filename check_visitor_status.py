"""Check visitor embedding status"""
from pymongo import MongoClient
client = MongoClient('mongodb+srv://bharatlytics:nN9AEW7exNdqoQ3r@cluster0.tato9.mongodb.net/vms_dev?retryWrites=true&w=majority&appName=Cluster0')
db = client.get_default_database()

print('Recent Visitors:')
for v in db.visitors.find().sort('createdAt', -1).limit(3):
    print(f"  ID: {v.get('_id')}")
    print(f"  Name: {v.get('visitorName')}")
    print(f"  Images: {list(v.get('visitorImages', {}).keys())}")
    print(f"  Embeddings: {v.get('visitorEmbeddings')}")
    print(f"  Status: {v.get('status')}")
    print()

print("\nPending embedding jobs (embedding_jobs collection):")
for job in db.embedding_jobs.find({'status': 'queued'}).limit(5):
    print(f"  Job: {job}")
