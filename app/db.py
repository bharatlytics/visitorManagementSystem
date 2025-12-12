"""
VMS Database Connection
"""
from pymongo import MongoClient
from gridfs import GridFS
from app.config import Config

# MongoDB connection
print(f"[DB] Connecting to URI: {Config.VMS_MONGODB_URI}")  # Debug
client = MongoClient(Config.VMS_MONGODB_URI)
db = client.get_default_database()

# Collections - VMS owns these (matching original naming)
visitor_collection = db['visitors']
visit_collection = db['visits']
settings_collection = db['settings']
devices_collection = db['devices']
embedding_jobs_collection = db['embedding_jobs']

# Standalone mode collections (when not connected to platform)
companies_collection = db['companies']
employee_collection = db['employees']
locations_collection = db['locations']  # VMS Locations (maps to platform entities)
users_collection = db['users']

# GridFS for visitor images and embeddings
visitor_image_fs = GridFS(db, collection='visitor_images')
visitor_embedding_fs = GridFS(db, collection='visitor_embeddings')
employee_image_fs = GridFS(db, collection='employee_images')
employee_embedding_fs = GridFS(db, collection='employee_embeddings')

# Aliases for backward compatibility
visitors_collection = visitor_collection
visits_collection = visit_collection
employees_collection = employee_collection
entities_collection = locations_collection  # Alias for data_provider.py
