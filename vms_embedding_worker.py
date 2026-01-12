"""
VMS Embedding Worker
====================
Generates face embeddings for VMS local database:
- Employees (when residency mode = 'app')
- Visitors (always local in VMS)

Uses multi-pose averaging for higher accuracy.
Stores embeddings in VMS GridFS collections.

Run this worker alongside the VMS application:
    python vms_embedding_worker.py
"""
import time
from pymongo import MongoClient
from datetime import datetime, timedelta, timezone
import cv2
import numpy as np
from insightface.app import FaceAnalysis
from bson import ObjectId
from gridfs import GridFS
import pickle
import requests
import base64
import sys
import os

# ========== CONFIGURATION ==========
# VMS MongoDB connection string - MUST be set via environment variable
VMS_MONGODB_URI = os.environ.get('VMS_MONGODB_URI')
if not VMS_MONGODB_URI:
    raise ValueError("VMS_MONGODB_URI environment variable is required")
VMS_URL = os.environ.get('VMS_URL', 'http://localhost:5001')

# MongoDB connection - VMS database
print(f"[VMS Worker] Connecting to VMS MongoDB...")
client = MongoClient(VMS_MONGODB_URI)
db = client.get_default_database()

MODEL_NAME = "buffalo_l"
WORKER_ID = "vms_embedding_worker1"
POLL_INTERVAL = 5  # seconds between scans
MAX_RETRIES = 3

# Collections
employees_collection = db['employees']
visitors_collection = db['visitors']
embedding_jobs_collection = db['embedding_jobs']

# GridFS for images and embeddings
employee_image_fs = GridFS(db, collection='employee_images')
employee_embedding_fs = GridFS(db, collection='employee_embeddings')
visitor_image_fs = GridFS(db, collection='visitor_images')
visitor_embedding_fs = GridFS(db, collection='visitor_embeddings')

# Initialize face detector
print(f"[{WORKER_ID}] Loading {MODEL_NAME} model...")
face_detector = FaceAnalysis(name=MODEL_NAME, providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
face_detector.prepare(ctx_id=0)
print(f"[{WORKER_ID}] Model loaded successfully")

from numpy.linalg import norm


def is_duplicate_face(new_embedding, company_id, entity_type, threshold=0.4):
    """Check if face already exists for this company/entity type"""
    if entity_type == 'employee':
        collection = employees_collection
        embed_field = 'employeeEmbeddings'
        embedding_fs = employee_embedding_fs
    else:
        collection = visitors_collection
        embed_field = 'visitorEmbeddings'
        embedding_fs = visitor_embedding_fs
    
    cursor = collection.find({
        'companyId': company_id,
        f'{embed_field}.buffalo_l.embeddingId': {'$exists': True},
        'status': {'$nin': ['archived', 'deleted']}
    })
    
    for entity in cursor:
        emb_entry = entity.get(embed_field, {}).get('buffalo_l', {})
        embedding_id = emb_entry.get('embeddingId')
        if not embedding_id:
            continue
            
        try:
            file = embedding_fs.get(embedding_id)
            existing_embedding = pickle.loads(file.read())
            sim = np.dot(new_embedding, existing_embedding) / (norm(new_embedding) * norm(existing_embedding))
            if sim > threshold:
                return True, str(entity['_id'])
        except Exception:
            continue
    
    return False, None


def download_image(url_or_base64):
    """Download image from URL or decode base64"""
    try:
        if not url_or_base64:
            return None
            
        if url_or_base64.startswith('data:image'):
            # Base64 encoded with data URI
            base64_data = url_or_base64.split(',')[1]
            image_bytes = base64.b64decode(base64_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        elif url_or_base64.startswith('http'):
            # URL
            response = requests.get(url_or_base64, timeout=10)
            if response.status_code == 200:
                nparr = np.frombuffer(response.content, np.uint8)
                return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        else:
            # Try as raw base64
            try:
                image_bytes = base64.b64decode(url_or_base64)
                nparr = np.frombuffer(image_bytes, np.uint8)
                return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            except:
                pass
    except Exception as e:
        print(f"[{WORKER_ID}] Error loading image: {e}")
    return None


def process_entity(entity, entity_type='employee'):
    """Generate embedding for an employee or visitor and store in GridFS"""
    entity_id = entity['_id']
    company_id = entity.get('companyId')
    
    # Select correct fields and collections based on entity type
    if entity_type == 'employee':
        collection = employees_collection
        images_field = 'employeeImages'
        embeddings_field = 'employeeEmbeddings'
        image_fs = employee_image_fs
        embedding_fs = employee_embedding_fs
        identifier = entity.get('employeeId', str(entity_id))
    else:
        collection = visitors_collection
        images_field = 'visitorImages'
        embeddings_field = 'visitorEmbeddings'
        image_fs = visitor_image_fs
        embedding_fs = visitor_embedding_fs
        identifier = entity.get('phone', str(entity_id))
    
    print(f"[{WORKER_ID}] Processing {entity_type} {entity_id} (company: {company_id})")
    
    # Mark as processing
    collection.update_one(
        {'_id': entity_id},
        {'$set': {
            f'{embeddings_field}.buffalo_l.status': 'started',
            f'{embeddings_field}.buffalo_l.startedAt': datetime.now(timezone.utc),
            f'{embeddings_field}.buffalo_l.workerId': WORKER_ID
        }}
    )
    
    # ========== MULTI-POSE EMBEDDING FOR HIGHER ACCURACY ==========
    entity_images = entity.get(images_field, {})
    images_loaded = []
    
    # Load all available pose images from GridFS
    if entity_images:
        for pose in ['center', 'front', 'left', 'right']:
            if pose in entity_images:
                image_id = entity_images[pose]
                try:
                    grid_file = image_fs.get(ObjectId(image_id) if not isinstance(image_id, ObjectId) else image_id)
                    img_bytes = grid_file.read()
                    img_array = np.frombuffer(img_bytes, np.uint8)
                    image = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                    if image is not None:
                        images_loaded.append({'pose': pose, 'image': image, 'size': len(img_bytes)})
                        print(f"[{WORKER_ID}] Loaded {pose} photo ({len(img_bytes)} bytes)")
                except Exception as e:
                    print(f"[{WORKER_ID}] Failed to load {pose}: {e}")
    
    # Fallback to photo attribute (base64)
    if not images_loaded:
        photo = entity.get('photo') or entity.get('photoUrl') or entity.get('image')
        if photo:
            image = download_image(photo)
            if image is not None:
                images_loaded.append({'pose': 'attributes', 'image': image, 'size': 0})
    
    if not images_loaded:
        print(f"[{WORKER_ID}] No photos found for {entity_type} {entity_id}")
        collection.update_one(
            {'_id': entity_id},
            {'$set': {
                f'{embeddings_field}.buffalo_l.status': 'failed',
                f'{embeddings_field}.buffalo_l.error': 'No photos found',
                f'{embeddings_field}.buffalo_l.finishedAt': datetime.now(timezone.utc)
            }}
        )
        return False
    
    print(f"[{WORKER_ID}] Loaded {len(images_loaded)} image(s) for {entity_type} {entity_id}")
    
    # ========== EXTRACT EMBEDDINGS FROM ALL IMAGES ==========
    embeddings = []
    poses_used = []
    
    for img_data in images_loaded:
        pose = img_data['pose']
        image = img_data['image']
        
        faces = face_detector.get(image)
        
        if not faces:
            print(f"[{WORKER_ID}] No face detected in {pose} image, skipping")
            continue
        
        # Get embedding from largest face if multiple detected
        if len(faces) > 1:
            face_areas = [(f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]) for f in faces]
            largest_idx = face_areas.index(max(face_areas))
            emb = faces[largest_idx].normed_embedding
        else:
            emb = faces[0].normed_embedding
        
        embeddings.append(emb)
        poses_used.append(pose)
        print(f"[{WORKER_ID}] Extracted embedding from {pose}")
    
    if not embeddings:
        print(f"[{WORKER_ID}] No faces detected in any images for {entity_type} {entity_id}")
        collection.update_one(
            {'_id': entity_id},
            {'$set': {
                f'{embeddings_field}.buffalo_l.status': 'failed',
                f'{embeddings_field}.buffalo_l.error': 'No face detected in any images',
                f'{embeddings_field}.buffalo_l.finishedAt': datetime.now(timezone.utc)
            }}
        )
        return False
    
    # ========== AVERAGE EMBEDDINGS FOR HIGHER ACCURACY ==========
    if len(embeddings) > 1:
        avg_embedding = np.mean(embeddings, axis=0)
        embedding = avg_embedding / np.linalg.norm(avg_embedding)  # Re-normalize
        print(f"[{WORKER_ID}] Averaged {len(embeddings)} embeddings ({', '.join(poses_used)})")
    else:
        embedding = embeddings[0]
        print(f"[{WORKER_ID}] Single embedding from {poses_used[0]}")
    
    # Check for duplicates
    is_dup, dup_id = is_duplicate_face(embedding, company_id, entity_type)
    if is_dup:
        print(f"[{WORKER_ID}] Duplicate face found! Matches {entity_type}: {dup_id}")
        collection.update_one(
            {'_id': entity_id},
            {'$set': {
                f'{embeddings_field}.buffalo_l.status': 'duplicate',
                f'{embeddings_field}.buffalo_l.duplicateOf': dup_id,
                f'{embeddings_field}.buffalo_l.finishedAt': datetime.now(timezone.utc)
            }}
        )
        return False
    
    # Store embedding in GridFS
    embedding_filename = f"{company_id}_{identifier}_{entity_type}_buffalo_l.pkl"
    embedding_metadata = {
        'companyId': str(company_id),
        'entityId': str(entity_id),
        'entityType': entity_type,
        'model': MODEL_NAME,
        'type': 'embedding',
        'timestamp': datetime.now(timezone.utc)
    }
    
    embedding_bytes = pickle.dumps(embedding)
    embedding_id = embedding_fs.put(
        embedding_bytes, 
        filename=embedding_filename, 
        metadata=embedding_metadata
    )
    
    # Build download URL using VMS URL
    download_url = f"{VMS_URL}/api/{entity_type}s/embeddings/{embedding_id}"
    
    emb_entry = {
        'embeddingId': embedding_id,
        'downloadUrl': download_url,
        'model': MODEL_NAME,
        'dimensions': len(embedding),
        'posesUsed': poses_used,
        'poseCount': len(poses_used),
        'createdAt': datetime.now(timezone.utc),
        'updatedAt': datetime.now(timezone.utc),
        'status': 'done',
        'finishedAt': datetime.now(timezone.utc),
        'corrupt': False
    }
    
    collection.update_one(
        {'_id': entity_id},
        {'$set': {
            f'{embeddings_field}.buffalo_l': emb_entry,
            'hasBiometric': True
        }}
    )
    
    print(f"[{WORKER_ID}] ✅ Generated embedding for {entity_type} {entity_id}")
    return True


def mark_pending_entities():
    """Mark employees/visitors with photos that need embedding processing"""
    total_marked = 0
    
    # Mark employees
    result = employees_collection.update_many(
        {
            '$or': [
                {'employeeImages': {'$exists': True, '$ne': {}}},
                {'photo': {'$exists': True, '$ne': None}}
            ],
            'employeeEmbeddings.buffalo_l': {'$exists': False},
            'status': {'$nin': ['archived', 'deleted']}
        },
        {'$set': {'employeeEmbeddings.buffalo_l.status': 'queued'}}
    )
    if result.modified_count > 0:
        print(f"[{WORKER_ID}] Marked {result.modified_count} employees for processing")
    total_marked += result.modified_count
    
    # Mark visitors
    result = visitors_collection.update_many(
        {
            '$or': [
                {'visitorImages': {'$exists': True, '$ne': {}}},
                {'photo': {'$exists': True, '$ne': None}}
            ],
            'visitorEmbeddings.buffalo_l': {'$exists': False},
            'status': {'$nin': ['archived', 'deleted']}
        },
        {'$set': {'visitorEmbeddings.buffalo_l.status': 'queued'}}
    )
    if result.modified_count > 0:
        print(f"[{WORKER_ID}] Marked {result.modified_count} visitors for processing")
    total_marked += result.modified_count
    
    return total_marked


def reset_stuck_jobs(timeout_minutes=30):
    """Reset jobs stuck in processing state"""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
    
    # Reset employees
    result = employees_collection.update_many(
        {
            'employeeEmbeddings.buffalo_l.status': 'started',
            'employeeEmbeddings.buffalo_l.startedAt': {'$lt': cutoff}
        },
        {'$set': {'employeeEmbeddings.buffalo_l.status': 'queued'}}
    )
    if result.modified_count > 0:
        print(f"[{WORKER_ID}] Reset {result.modified_count} stuck employee jobs")
    
    # Reset visitors
    result = visitors_collection.update_many(
        {
            'visitorEmbeddings.buffalo_l.status': 'started',
            'visitorEmbeddings.buffalo_l.startedAt': {'$lt': cutoff}
        },
        {'$set': {'visitorEmbeddings.buffalo_l.status': 'queued'}}
    )
    if result.modified_count > 0:
        print(f"[{WORKER_ID}] Reset {result.modified_count} stuck visitor jobs")


def worker_loop():
    """Main worker loop"""
    print(f"[{WORKER_ID}] Starting VMS embedding worker loop...")
    
    # ========== STARTUP INITIALIZATION ==========
    print(f"[{WORKER_ID}] Running startup initialization...")
    
    marked = mark_pending_entities()
    print(f"[{WORKER_ID}] Startup: Marked {marked} entities for processing")
    
    reset_stuck_jobs()
    
    # Count pending jobs
    emp_pending = employees_collection.count_documents({
        'employeeEmbeddings.buffalo_l.status': 'queued',
        'status': {'$nin': ['archived', 'deleted']}
    })
    vis_pending = visitors_collection.count_documents({
        'visitorEmbeddings.buffalo_l.status': 'queued',
        'status': {'$nin': ['archived', 'deleted']}
    })
    print(f"[{WORKER_ID}] Startup: Found {emp_pending} employees, {vis_pending} visitors pending")
    print(f"[{WORKER_ID}] ========== Ready to process jobs ==========")
    
    last_check = datetime.now(timezone.utc)
    
    while True:
        try:
            # Periodic maintenance (every 5 minutes)
            if (datetime.now(timezone.utc) - last_check).seconds > 300:
                mark_pending_entities()
                reset_stuck_jobs()
                last_check = datetime.now(timezone.utc)
            
            # Process employees first
            pending = employees_collection.find_one_and_update(
                {
                    'employeeEmbeddings.buffalo_l.status': 'queued',
                    'status': {'$nin': ['archived', 'deleted']}
                },
                {'$set': {
                    'employeeEmbeddings.buffalo_l.status': 'started',
                    'employeeEmbeddings.buffalo_l.startedAt': datetime.now(timezone.utc)
                }},
                sort=[('createdAt', 1)]
            )
            
            if pending:
                try:
                    process_entity(pending, 'employee')
                except Exception as e:
                    print(f"[{WORKER_ID}] Error processing employee {pending['_id']}: {e}")
                    employees_collection.update_one(
                        {'_id': pending['_id']},
                        {'$set': {
                            'employeeEmbeddings.buffalo_l.status': 'failed',
                            'employeeEmbeddings.buffalo_l.error': str(e),
                            'employeeEmbeddings.buffalo_l.finishedAt': datetime.now(timezone.utc)
                        }}
                    )
                continue  # Check for more jobs immediately
            
            # Then process visitors
            pending = visitors_collection.find_one_and_update(
                {
                    'visitorEmbeddings.buffalo_l.status': 'queued',
                    'status': {'$nin': ['archived', 'deleted']}
                },
                {'$set': {
                    'visitorEmbeddings.buffalo_l.status': 'started',
                    'visitorEmbeddings.buffalo_l.startedAt': datetime.now(timezone.utc)
                }},
                sort=[('createdAt', 1)]
            )
            
            if pending:
                try:
                    process_entity(pending, 'visitor')
                except Exception as e:
                    print(f"[{WORKER_ID}] Error processing visitor {pending['_id']}: {e}")
                    visitors_collection.update_one(
                        {'_id': pending['_id']},
                        {'$set': {
                            'visitorEmbeddings.buffalo_l.status': 'failed',
                            'visitorEmbeddings.buffalo_l.error': str(e),
                            'visitorEmbeddings.buffalo_l.finishedAt': datetime.now(timezone.utc)
                        }}
                    )
                continue
            
            # No pending jobs, sleep
            time.sleep(POLL_INTERVAL)
                
        except Exception as e:
            print(f"[{WORKER_ID}] Worker loop error: {e}")
            time.sleep(POLL_INTERVAL)


def run_once():
    """Process all pending entities once (for testing)"""
    print(f"[{WORKER_ID}] Running single pass...")
    
    mark_pending_entities()
    
    processed = 0
    failed = 0
    
    # Process employees
    for emp in employees_collection.find({
        'employeeEmbeddings.buffalo_l.status': 'queued',
        'status': {'$nin': ['archived', 'deleted']}
    }).limit(20):
        try:
            if process_entity(emp, 'employee'):
                processed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[{WORKER_ID}] Error: {e}")
            failed += 1
    
    # Process visitors
    for vis in visitors_collection.find({
        'visitorEmbeddings.buffalo_l.status': 'queued',
        'status': {'$nin': ['archived', 'deleted']}
    }).limit(20):
        try:
            if process_entity(vis, 'visitor'):
                processed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[{WORKER_ID}] Error: {e}")
            failed += 1
    
    print(f"[{WORKER_ID}] Processed: {processed}, Failed: {failed}")
    return processed, failed


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='VMS Embedding Worker')
    parser.add_argument('--once', action='store_true', help='Run once and exit')
    args = parser.parse_args()
    
    if args.once:
        run_once()
    else:
        worker_loop()
