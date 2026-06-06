"""Run an RQ worker for ADA scan jobs (RQ 2.x compatible).

Usage (in WSL, from the project root):
    REDIS_URL=redis://localhost:6379 env/bin/python workers/run_worker.py

The project root is added to sys.path so the forked horse process can import
task functions by dotted name (e.g. backend.services.url_processor.run_ada_scan).
"""
import logging
import os
import sys
from pathlib import Path

# Must happen before any project imports so every process that inherits this
# sys.path (including the RQ horse fork) can resolve backend.* and services.*
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import redis
from rq import Queue, Worker

from backend.utils.logging import configure_logging
from config import Config

configure_logging(Config.LOG_LEVEL)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL") or Config.REDIS_URL
QUEUE_NAME = os.getenv("SCAN_QUEUE_NAME") or Config.SCAN_QUEUE_NAME

if not REDIS_URL:
    logger.error(
        "REDIS_URL is not set. Cannot start worker. "
        "Example: REDIS_URL=redis://localhost:6379 env/bin/python workers/run_worker.py"
    )
    sys.exit(1)

try:
    redis_conn = redis.from_url(REDIS_URL, socket_connect_timeout=5)
    redis_conn.ping()
    logger.info("Redis connected | url=%s queue=%s", REDIS_URL, QUEUE_NAME)
except Exception as exc:
    logger.error("Redis connection failed | url=%s error=%s", REDIS_URL, exc)
    sys.exit(1)

q = Queue(QUEUE_NAME, connection=redis_conn)

if __name__ == "__main__":
    logger.info("ADA worker starting | queue=%s pid=%d", QUEUE_NAME, os.getpid())
    worker = Worker([q], connection=redis_conn)
    worker.work(with_scheduler=False)
