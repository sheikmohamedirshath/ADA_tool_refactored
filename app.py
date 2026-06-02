"""
Flask app: serves the built React UI and provides API routes.
ADA check runs in-process using axe-playwright-python (Playwright + axe-core).

- Local:    python app.py              (Flask dev server, port 5000)
- Production (e.g. Azure): gunicorn app:app   (Gunicorn runs this Flask app)

Setup: pip install -r requirements.txt  # includes axe-playwright-python
       python -m playwright install chromium
Run:   npm run build && python app.py
"""
import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from flask import Flask, Response, jsonify, g, request, send_from_directory
from services.url_processor import (
    run_keyboard_assisted_test,
    run_color_contrast_assisted_test,
)
from services import db
from backend.services import create_scan_job, get_scan_status
from backend.services.scan_service import get_queue_service
from backend.services.crawl_service import (
    create_crawl_job,
    get_crawl_status,
    get_crawl_pages,
)

# Create database and table automatically if MSSQL_CONN_STR is set (Azure, AWS, or local)
db.init_db()

logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder=None)

# Directory containing the built React app (npm run build)
DIST = Path(__file__).resolve().parent / "dist"

# Minimum seconds between scan submissions from the same IP.
# NOTE: In-process only — not shared across Gunicorn workers, which is
# acceptable for an internal tool.
SCAN_RATE_LIMIT_SECONDS = 15
_rate_limit_store: dict[str, float] = {}
_rate_limit_lock = threading.Lock()


def _check_scan_rate_limit(ip: str) -> tuple[bool, int]:
    """Return (is_limited, retry_after_seconds) for the given client IP.

    On the first call from an IP (or after the window expires) the timestamp
    is recorded and (False, 0) is returned.  Subsequent calls within the window
    return (True, seconds_remaining).
    """
    now = time.monotonic()
    with _rate_limit_lock:
        elapsed = now - _rate_limit_store.get(ip, 0.0)
        if elapsed < SCAN_RATE_LIMIT_SECONDS:
            return True, int(SCAN_RATE_LIMIT_SECONDS - elapsed) + 1
        _rate_limit_store[ip] = now
        # Lazy eviction: remove entries older than 2× the window
        cutoff = now - SCAN_RATE_LIMIT_SECONDS * 2
        expired = [k for k, v in _rate_limit_store.items() if v < cutoff]
        for k in expired:
            del _rate_limit_store[k]
        return False, 0


def _get_request_id() -> str:
    return getattr(g, "request_id", None) or uuid.uuid4().hex


@app.before_request
def attach_request_id():
    g.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex


@app.after_request
def add_request_id_header(response: Response):
    response.headers["X-Request-ID"] = _get_request_id()
    return response


def _queue_health() -> dict:
    try:
        queue = get_queue_service()
        return queue.health_check()
    except Exception as exc:
        logging.warning("Queue health check failed: %s", exc)
        return {
            "backend": "unavailable",
            "connected": False,
            "queue_name": None,
            "redis_url": None,
            "error": str(exc),
        }


def _history_unavailable_payload() -> dict:
    reason = db.init_error() or "Database persistence is not configured"
    return {
        "ok": True,
        "available": False,
        "items": [],
        "message": (
            "Scan history is unavailable until MSSQL is configured. "
            f"Reason: {reason}"
        ),
    }


@app.route("/api/process", methods=["POST"])
def api_process():
    """Deprecated synchronous endpoint. Enqueue a scan job instead to avoid blocking.

    Returns 202 with a `jobId` and a `pollUrl` where the client can check status.
    """
    limited, retry_after = _check_scan_rate_limit(request.remote_addr or "unknown")
    if limited:
        return jsonify({"ok": False, "error": f"Too many requests. Please wait {retry_after}s before starting another scan."}), 429, {"Retry-After": str(retry_after)}

    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    include_best_practices = bool(data.get("includeBestPractices"))
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400

    try:
        scan_job = create_scan_job(url, {"include_best_practices": include_best_practices})
        poll_url = f"/api/scan/{scan_job['job_id']}"
        headers = {"Location": poll_url, "Deprecation": "true"}
        return jsonify({"ok": True, "jobId": scan_job["job_id"], "pollUrl": poll_url}), 202, headers
    except ValueError as e:
        logging.warning("Invalid scan request: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Failed to enqueue scan via /api/process: %s", e)
        return jsonify({"ok": False, "error": "Unable to queue scan"}), 500


@app.route("/api/scan", methods=["POST"])
def api_scan():
    """Queue a scan job and return a job id so the client can poll status."""
    limited, retry_after = _check_scan_rate_limit(request.remote_addr or "unknown")
    if limited:
        return jsonify({"ok": False, "error": f"Too many requests. Please wait {retry_after}s before starting another scan."}), 429, {"Retry-After": str(retry_after)}

    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    include_best_practices = bool(data.get("includeBestPractices"))
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400

    try:
        scan_job = create_scan_job(url, {"include_best_practices": include_best_practices})
        return jsonify({"ok": True, "jobId": scan_job["job_id"], "status": scan_job["status"]}), 202
    except ValueError as e:
        logging.warning("Invalid scan request: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Failed to enqueue scan via /api/scan: %s", e)
        return jsonify({"ok": False, "error": "Unable to queue scan"}), 500


@app.route("/api/scan/<string:job_id>", methods=["GET"])
def api_scan_status(job_id):
    """Return the current status of a queued scan job."""
    try:
        job = get_scan_status(job_id)
    except Exception as e:
        logging.exception("Error fetching scan status: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve job status"}), 500

    if job is None:
        return jsonify({"ok": False, "error": "Scan job not found"}), 404

    # Normalize for the frontend: map RQ's 'finished' → 'completed' and unwrap scan_result
    if job.get("status") == "finished":
        job["status"] = "completed"
        raw = job.get("result")
        if isinstance(raw, dict) and "scan_result" in raw:
            job["result"] = raw["scan_result"]

    return jsonify({"ok": True, "job": job})


@app.route("/health/live", methods=["GET"])
def health_live():
    return jsonify({"status": "ok", "request_id": _get_request_id()})


@app.route("/health/ready", methods=["GET"])
def health_ready():
    queue_health = _queue_health()
    database_ready = db.is_ready()
    status = "ok" if queue_health.get("connected") and database_ready else "unavailable"
    code = 200 if status == "ok" else 503
    return (
        jsonify(
            {
                "status": status,
                "request_id": _get_request_id(),
                "queue": queue_health,
                "database": {"available": database_ready},
            }
        ),
        code,
    )


@app.route("/api/history", methods=["GET"])
def api_history():
    """Return scan history from the database (MSSQL)."""
    if not db.is_ready():
        return jsonify(_history_unavailable_payload())
    try:
        limit = request.args.get("limit", type=int) or 500
        items = db.get_scan_history(limit=limit)
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get scan history: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/history/<int:scan_id>", methods=["GET"])
def api_history_result(scan_id):
    """Return the full stored result for a scan (same shape as /api/process result)."""
    if not db.is_ready():
        return jsonify({
            "ok": False,
            "error": _history_unavailable_payload()["message"],
        }), 503
    try:
        result = db.get_scan_result(scan_id)
        if result is None:
            return jsonify({"ok": False, "error": "Scan not found or no result stored"}), 404
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        logging.exception("[DB] Failed to get scan result: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/keyboard", methods=["POST"])
def api_assisted_keyboard():
    """Run automated keyboard checks for a URL and return pass/fail details."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_keyboard_assisted_test(url)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/color-contrast", methods=["POST"])
def api_assisted_color_contrast():
    """Run automated color contrast checks for a URL and return pass/fail details."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_color_contrast_assisted_test(url)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/trends", methods=["GET"])
def api_trends():
    """
    Return time-bucketed scan aggregates for the trends dashboard.

    Query params:
      granularity  daily | weekly | monthly   (default: daily)
      days         integer convenience param  (default: 30)
      from         YYYY-MM-DD start date      (overrides days)
      to           YYYY-MM-DD end date        (default: today)
    """
    if not db.is_ready():
        return jsonify({
            "ok": False,
            "available": False,
            "data": [],
            "summary": None,
            "message": "Trend data unavailable: " + (db.init_error() or "database not configured"),
        })

    granularity = request.args.get("granularity", "daily").strip().lower()
    if granularity not in ("daily", "weekly", "monthly"):
        granularity = "daily"

    # Resolve date range
    from_param = (request.args.get("from") or "").strip()
    to_param = (request.args.get("to") or "").strip()

    if not from_param:
        try:
            days = max(1, min(int(request.args.get("days", 30)), 365))
        except (ValueError, TypeError):
            days = 30
        from datetime import date, timedelta
        from_param = (date.today() - timedelta(days=days - 1)).isoformat()

    try:
        result = db.get_scan_trends(
            granularity=granularity,
            start_date=from_param or None,
            end_date=to_param or None,
        )
        return jsonify({
            "ok": True,
            "available": True,
            "granularity": granularity,
            "period": {"from": from_param, "to": to_param or None},
            "data": result["data"],
            "summary": result["summary"],
        })
    except Exception as e:
        logging.exception("Failed to fetch trend data: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl", methods=["POST"])
def api_crawl_create():
    """Queue a multi-page site crawl job."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    options = {
        "max_depth": data.get("maxDepth"),
        "max_pages": data.get("maxPages"),
        "full_site": bool(data.get("fullSite", False)),
    }
    try:
        job = create_crawl_job(url, options)
        return jsonify({"ok": True, **job}), 202
    except ValueError as e:
        logging.warning("Invalid crawl request: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Failed to create crawl job: %s", e)
        return jsonify({"ok": False, "error": "Unable to start crawl"}), 500


@app.route("/api/crawl/<string:crawl_id>", methods=["GET"])
def api_crawl_status(crawl_id):
    """Return the status of a crawl job."""
    try:
        job = get_crawl_status(crawl_id)
    except Exception as e:
        logging.exception("Error fetching crawl status: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve crawl status"}), 500
    if job is None:
        return jsonify({"ok": False, "error": "Crawl job not found"}), 404
    return jsonify({"ok": True, "job": job})


@app.route("/api/crawl/<string:crawl_id>/pages", methods=["GET"])
def api_crawl_pages(crawl_id):
    """Return all scanned pages for a crawl job."""
    try:
        pages = get_crawl_pages(crawl_id)
    except Exception as e:
        logging.exception("Error fetching crawl pages: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve crawl pages"}), 500
    return jsonify({"ok": True, "crawl_id": crawl_id, "pages": pages, "count": len(pages)})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_ui(path):
    """Serve the React app: index.html for routes that are not static files."""
    if not DIST.is_dir():
        return (
            "<p>React app not built. Run: <code>npm run build</code></p>",
            503,
        )
    if path and (DIST / path).is_file():
        return send_from_directory(DIST, path)
    return send_from_directory(DIST, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
