import logging
import traceback
from datetime import datetime
from services import db
from services.url_processor import process_url

logger = logging.getLogger(__name__)


def _set_job_meta(job, **fields):
    if not job:
        return
    meta = getattr(job, "meta", {}) or {}
    meta.update(fields)
    job.meta = meta
    try:
        job.save_meta()
    except Exception:
        logger.warning("Unable to save job meta for %s", getattr(job, "id", "<unknown>"), exc_info=True)


def _persist_job_status(job_id: str, status: str, **fields):
    if not db.is_ready():
        return
    try:
        db.update_scan_job_status(
            job_id=job_id,
            status=status,
            started_at=fields.get("started_at"),
            ended_at=fields.get("ended_at"),
            duration_seconds=fields.get("duration_seconds"),
            failure_reason=fields.get("failure_reason"),
            result_payload=fields.get("result_payload"),
            worker_name=fields.get("worker_name"),
            attempt=fields.get("attempt"),
        )
    except Exception:
        logger.exception("Failed to persist job status for %s", job_id)


def perform_scan(url: str, include_best_practices: bool = False, job_id: str | None = None):
    job = None
    try:
        from rq import get_current_job

        job = get_current_job()
        if job is not None and not job_id:
            job_id = str(job.id)
    except Exception:
        logger.warning("Unable to determine current RQ job id", exc_info=True)

    started_at = datetime.utcnow().isoformat() + "Z"
    request_fields = {"job_id": job_id, "scan_url": url, "source": "worker_tasks"}
    logger.info("Starting scan job", extra=request_fields)

    _set_job_meta(job, status="running", started_at=started_at, scan_url=url)
    retries_left = getattr(job, "retries_left", None)
    attempt = None if retries_left is None else (2 - retries_left + 1)
    _persist_job_status(job_id, "running", started_at=started_at, worker_name=getattr(job, "origin", None), attempt=attempt)

    try:
        result = process_url(url, include_best_practices=include_best_practices, write_output=False)
        completed_at = datetime.utcnow().isoformat() + "Z"
        duration = None
        try:
            duration = (datetime.fromisoformat(completed_at.replace("Z", "+00:00")) - datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds()
        except Exception:
            duration = None

        _set_job_meta(
            job,
            status="completed",
            ended_at=completed_at,
            duration_seconds=duration,
            result_payload=result,
        )
        _persist_job_status(
            job_id,
            "completed",
            ended_at=completed_at,
            duration_seconds=duration,
            result_payload=result,
            worker_name=getattr(job, "origin", None),
            attempt=attempt,
        )

        if db.is_ready():
            db.save_scan_history(result)

        logger.info("Completed scan job", extra={**request_fields, "duration": duration, "worker_status": "completed"})
        return {
            "job_id": job_id,
            "scan_url": url,
            "scan_result": result,
            "completed_at": completed_at,
        }
    except Exception as exc:
        failed_at = datetime.utcnow().isoformat() + "Z"
        failure_reason = str(exc)
        error_trace = traceback.format_exc()
        _set_job_meta(
            job,
            status="failed",
            ended_at=failed_at,
            failure_reason=failure_reason,
            error_trace=error_trace,
        )
        _persist_job_status(
            job_id,
            "failed",
            ended_at=failed_at,
            failure_reason=failure_reason,
            worker_name=getattr(job, "origin", None),
            attempt=attempt,
        )
        logger.error("Scan job failed", extra={**request_fields, "failure_reason": failure_reason, "worker_status": "failed"}, exc_info=exc)
        raise
