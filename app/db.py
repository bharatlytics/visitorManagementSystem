"""
VMS Database Connection
"""
from pymongo import MongoClient
from gridfs import GridFS
from app.config import Config

# MongoDB connection
client = MongoClient(Config.VMS_MONGODB_URI)
db = client.get_default_database()

# Collections - VMS owns these
visitors_collection = db['visitors']
visits_collection = db['visits']
settings_collection = db['settings']

# Standalone mode collections (when not connected to platform)
companies_collection = db['companies']
employees_collection = db['employees']
entities_collection = db['entities']
users_collection = db['users']

# GridFS for visitor images
visitor_image_fs = GridFS(db, collection='visitor_images')
