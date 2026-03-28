"""Shared maintenance-mode sentinel path.

The sentinel file is checked by MaintenanceMiddleware (in main.py) to block
financial API routes while rotation or admin-initiated downtime is active.
It is NOT checked by Caddy — Caddy uses a separate full_maintenance sentinel
only during deploys (when the app container is stopped).
"""
import os
from pathlib import Path

SENTINEL_PATH = Path(os.getenv("MAINTENANCE_SENTINEL_PATH", "/app/data/maintenance"))
