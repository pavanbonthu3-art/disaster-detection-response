# Vercel Python serverless entrypoint
# Vercel looks for `app` (WSGI callable) in api/index.py
import sys
import os

# Make sure the project root is on the path so app.py can be imported
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import app  # noqa: F401  — Vercel picks up `app` as the WSGI handler
