"""
Crawl service: create crawl jobs, poll status, list pages.
"""
import logging
import uuid
from datetime import datetime, timezone

from config import Config
from services import db
from backend.services.scan_service import get_queue_service

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def create_crawl_job(root_url: str, options: dict | None = None) -> dict:
    """
    Persist a CrawlJob row then enqueue the crawl task.
    The DB row is written first so the worker never races against a missing row.
    """
    from backend.services.crawl_task import crawl_site_task

    options = options or {}
    full_site = bool(options.get("full_site", False))
    if full_site:
        max_depth = Config.CRAWL_MAX_DEPTH_FULL
        max_pages = Config.CRAWL_MAX_PAGES_FULL
    else:
        max_depth = max(1, min(int(options.get("max_depth") or Config.CRAWL_MAX_DEPTH), 10))
        max_pages = max(1, min(int(options.get("max_pages") or Config.CRAWL_MAX_PAGES), 500))
    crawl_id = f"CRAWL-{uuid.uuid4().hex[:12].upper()}"
    created_at = _utcnow_iso()

    db.save_crawl_job(
        crawl_id=crawl_id,
        root_url=root_url,
        max_depth=max_depth,
        max_pages=max_pages,
        status="pending",
        created_at=created_at,
    )

    qs = get_queue_service()
    job = qs.enqueue_crawl(
        crawl_site_task,
        crawl_id=crawl_id,
        root_url=root_url,
        max_depth=max_depth,
        max_pages=max_pages,
    )
    rq_job_id = str(getattr(job, "id", "")) or None

    logger.info(
        "Crawl job created | crawl_id=%s url=%s rq_job_id=%s",
        crawl_id, root_url, rq_job_id,
    )
    return {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "max_depth": max_depth,
        "max_pages": max_pages,
        "status": "pending",
        "rq_job_id": rq_job_id,
        "created_at": created_at,
    }


def get_crawl_status(crawl_id: str) -> dict | None:
    return db.get_crawl_job(crawl_id)


def get_crawl_pages(crawl_id: str) -> list[dict]:
    return db.get_crawl_pages(crawl_id)
