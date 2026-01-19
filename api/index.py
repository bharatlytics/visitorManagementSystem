"""
Vercel Serverless Function Entry Point
Exports the Flask app for Vercel's Python runtime
"""
import sys
import os

# Add project root to path so we can import 'app' module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app

# Vercel expects a WSGI app exported as 'app'
app = create_app()
