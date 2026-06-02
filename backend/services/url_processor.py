import logging
from datetime import datetime, timezone
from services.url_processor import process_url as execute_scan
from services import db

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _persist(job_id: str | None, **kwargs) -> None:
    """Persist a ScanJobs status update, logging but never raising on failure."""
    if not job_id or not db.is_ready():
        return
    try:
        db.update_scan_job_status(job_id=job_id, **kwargs)
    except Exception:
        logger.exception("Failed to persist job status for %s", job_id)


def run_ada_scan(scan_url: str, metadata: dict | None = None, timeout: int = 300) -> dict:
    """
    RQ task: run an ADA accessibility scan and return the structured result.
    Persists running/completed/failed state to ScanJobs when DB is available.
    Called both by the RQ Redis horse and the in-memory ThreadPoolExecutor fallback.
    """
    metadata = metadata or {}
    include_best_practices = metadata.get("include_best_practices", False)

    # Detect the current RQ job so we can update ScanJobs lifecycle state.
    # get_current_job() works inside the RQ horse process; returns None for in-memory.
    job_id: str | None = None
    try:
        from rq import get_current_job
        rq_job = get_current_job()
        if rq_job is not None:
            job_id = str(rq_job.id)
    except Exception:
        pass

    started_at = _utcnow_iso()
    logger.info(
        "Scan started | url=%s job_id=%s best_practices=%s",
        scan_url, job_id, include_best_practices,
    )

    _persist(job_id, status="running", started_at=started_at)

    try:
        result = execute_scan(
            scan_url,
            include_best_practices=include_best_practices,
            write_output=False,
        )
        completed_at = _utcnow_iso()

        try:
            duration = (
                datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                - datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            ).total_seconds()
        except Exception:
            duration = None

        _persist(
            job_id,
            status="completed",
            ended_at=completed_at,
            duration_seconds=duration,
            result_payload=result,
        )

        if db.is_ready():
            try:
                db.save_scan_history(result)
            except Exception:
                logger.exception("Failed to save scan history for %s", scan_url)

        logger.info(
            "Scan completed | url=%s job_id=%s duration=%.1fs",
            scan_url, job_id, duration or 0,
        )
        return {
            "scan_url": scan_url,
            "scan_result": result,
            "metadata": metadata,
            "created_at": completed_at,
        }

    except Exception as exc:
        failed_at = _utcnow_iso()
        failure_reason = str(exc)
        _persist(
            job_id,
            status="failed",
            ended_at=failed_at,
            failure_reason=failure_reason,
        )
        logger.error(
            "Scan failed | url=%s job_id=%s reason=%s",
            scan_url, job_id, failure_reason,
            exc_info=True,
        )
        raise
