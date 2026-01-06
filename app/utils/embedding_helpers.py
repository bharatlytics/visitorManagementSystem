"""
Embedding Helper Utilities

Provides functions to generate embedding download URLs for API responses.
Frontend always receives VMS URLs regardless of residency mode.
Backend endpoints handle proxying to platform when needed.
"""
from flask import request


def generate_embedding_url(embedding_id, actor_type, base_url=None):
    """
    Generate embedding download URL - ALWAYS uses VMS backend.
    
    Args:
        embedding_id: GridFS file ID (string)
        actor_type: 'visitor' or 'employee'
        base_url: Request base URL (e.g., 'http://localhost:5001')
                  If None, will be extracted from current request
    
    Returns:
        VMS URL that will proxy to platform if needed
    """
    if not base_url:
        base_url = request.url_root.rstrip('/')
    
    # ALWAYS return VMS URL - backend handles proxying
    return f"{base_url}/api/{actor_type}s/embeddings/{embedding_id}"


def format_embedding_response(embeddings_dict, actor_type, base_url=None):
    """
    Format embeddings dictionary with download URLs.
    
    Args:
        embeddings_dict: Dictionary of embeddings {model: embedding_data}
        actor_type: 'visitor' or 'employee'
        base_url: Request base URL (optional)
    
    Returns:
        Formatted dictionary with downloadUrl added to each embedding
    """
    if not embeddings_dict:
        return {}
    
    formatted = {}
    for model, emb_data in embeddings_dict.items():
        if isinstance(emb_data, dict) and emb_data.get('embeddingId'):
            formatted[model] = {
                'status': emb_data.get('status', 'unknown'),
                'embeddingId': str(emb_data.get('embeddingId')),
                'downloadUrl': generate_embedding_url(
                    str(emb_data.get('embeddingId')), 
                    actor_type, 
                    base_url
                ),
                'createdAt': emb_data.get('createdAt'),
                'finishedAt': emb_data.get('finishedAt')
            }
        else:
            # Keep original data if not properly formatted
            formatted[model] = emb_data
    
    return formatted
