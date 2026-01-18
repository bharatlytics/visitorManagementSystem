"""
VMS Database Connection
"""
from pymongo import MongoClient, ASCENDING
from gridfs import GridFS
from app.config import Config

# MongoDB connection
print(f"[DB] Connecting to URI: {Config.VMS_MONGODB_URI}")  # Debug
client = MongoClient(Config.VMS_MONGODB_URI)

# Extract database name from URI, or use default
# MongoDB Atlas URIs may not have db name in path
uri = Config.VMS_MONGODB_URI
db_name = uri.split('/')[-1].split('?')[0] if '/' in uri else ''
if not db_name:
    db_name = 'blGroup_visitorManagementSystem'  # Default VMS database
print(f"[DB] Using database: {db_name}")
db = client[db_name]

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
attendance_collection = db['attendance']  # Employee attendance records
sync_audit_log_collection = db['sync_audit_logs']  # Audit logs for sync operations

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


def get_db():
    """
    Get the database instance for dynamic collection access.
    Use this when you need to access collections that aren't predefined.
    """
    return db



# =====================================================
# DATABASE INDEXES - Ensure uniqueness and performance
# =====================================================
def ensure_indexes():
    """Create database indexes for uniqueness and query optimization"""
    try:
        # Visitors: Unique phone per company
        visitor_collection.create_index(
            [("companyId", ASCENDING), ("phone", ASCENDING)],
            unique=True,
            name="unique_visitor_phone_per_company",
            sparse=True  # Allow null phones
        )
        
        # Visitors: Index on email for lookups (not unique - optional field)
        visitor_collection.create_index(
            [("companyId", ASCENDING), ("email", ASCENDING)],
            name="visitor_email_lookup",
            sparse=True
        )
        
        # Employees: Unique employeeId per company
        employee_collection.create_index(
            [("companyId", ASCENDING), ("employeeId", ASCENDING)],
            unique=True,
            name="unique_employee_id_per_company",
            sparse=True
        )
        
        # Employees: Unique email per company
        employee_collection.create_index(
            [("companyId", ASCENDING), ("email", ASCENDING)],
            unique=True,
            name="unique_employee_email_per_company",
            sparse=True
        )
        
        # Visits: Index for querying visits by visitor
        visit_collection.create_index(
            [("companyId", ASCENDING), ("visitorId", ASCENDING), ("status", ASCENDING)],
            name="visit_by_visitor_status"
        )
        
        # Visits: Index for date-based queries
        visit_collection.create_index(
            [("companyId", ASCENDING), ("expectedArrival", ASCENDING)],
            name="visit_by_date"
        )
        
        # Locations: Unique name per company
        locations_collection.create_index(
            [("companyId", ASCENDING), ("name", ASCENDING)],
            unique=True,
            name="unique_location_name_per_company",
            sparse=True
        )
        
        # Companies: Unique by _id (default) and name
        companies_collection.create_index(
            [("name", ASCENDING)],
            unique=True,
            name="unique_company_name",
            sparse=True
        )
        
        # Users: Unique username
        users_collection.create_index(
            [("username", ASCENDING)],
            unique=True,
            name="unique_username",
            sparse=True
        )
        
        print("[DB] Database indexes created successfully")
        
    except Exception as e:
        print(f"[DB] Index creation warning (may already exist): {e}")


# Run index creation on module load
ensure_indexes()

