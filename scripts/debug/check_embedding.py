from app.db import visitor_embedding_fs
from bson import ObjectId

embedding_id = '6881fcfbb80d7fe19da787cf'

try:
    file = visitor_embedding_fs.get(ObjectId(embedding_id))
    print(f'✅ Embedding found in VMS GridFS:')
    print(f'   Filename: {file.filename}')
    print(f'   Size: {file.length} bytes')
    print(f'   ID: {embedding_id}')
except Exception as e:
    print(f'❌ Embedding NOT found in VMS GridFS: {e}')
    print(f'   This means the embedding is likely on the Platform, not VMS')
