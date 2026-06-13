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
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
import bcrypt
import jwt
from flask import Flask, Response, jsonify, g, request, send_from_directory
from config import Config
from services.url_processor import (
    run_keyboard_assisted_test,
    run_color_contrast_assisted_test,
    run_page_structure_assisted_test,
)
from services import db
from backend.services import create_scan_job, get_scan_status
from backend.services.scan_service import get_queue_service
from backend.services.auth_utils import generate_verify_token
from backend.services.email_service import send_verification_email
from backend.services.crawl_service import (
    create_crawl_job,
    get_crawl_status,
    get_crawl_pages,
    cancel_crawl_job,
)

# Create database and table automatically if MSSQL_CONN_STR is set (Azure, AWS, or local)
db.init_db()

# Phase 3: start background crawl scheduler (daemon thread, no-op if disabled)
from backend.services.scheduler_service import start_scheduler as _start_scheduler
_start_scheduler()

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


@app.before_request
def handle_preflight():
    """Answer OPTIONS preflight requests from the browser extension."""
    if request.method != "OPTIONS":
        return
    origin = request.headers.get("Origin", "")
    if _is_allowed_origin(origin):
        resp = Response()
        _set_cors_headers(resp, origin)
        return resp, 204


@app.after_request
def add_request_id_header(response: Response):
    response.headers["X-Request-ID"] = _get_request_id()
    # Attach CORS headers to every response so the extension popup can read them.
    origin = request.headers.get("Origin", "")
    if _is_allowed_origin(origin):
        _set_cors_headers(response, origin)
    return response


# ── CORS helpers ────────────────────────────────────────────────────────
# Allow the Vite dev server and any Chrome extension origin.
# In production, restrict _ALLOWED_ORIGINS to your deployed domain.
_ALLOWED_ORIGINS: set[str] = {
    "http://localhost:5173",   # Vite dev server (web app)
    "http://localhost:5000",   # Flask dev server (same-origin API calls)
}


def _is_allowed_origin(origin: str) -> bool:
    return origin in _ALLOWED_ORIGINS or origin.startswith("chrome-extension://")


def _set_cors_headers(response: Response, origin: str) -> None:
    response.headers["Access-Control-Allow-Origin"]      = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"]     = (
        "Content-Type, Authorization, X-Request-ID"
    )
    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    )


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


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _make_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=Config.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm="HS256")


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"ok": False, "error": "missing_token"}), 401
        token = auth_header[7:].strip()
        try:
            payload = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"ok": False, "error": "token_expired"}), 401
        except jwt.InvalidTokenError as exc:
            logging.warning("JWT decode failed | error=%s | token_prefix=%s", exc, token[:30])
            return jsonify({"ok": False, "error": "invalid_token"}), 401
        g.current_user_id = int(payload["sub"])
        g.current_user_email = payload["email"]
        return f(*args, **kwargs)
    return decorated


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    data = request.get_json(silent=True) or {}
    first_name = (data.get("firstName") or "").strip()
    last_name  = (data.get("lastName") or "").strip()
    email      = (data.get("email") or "").strip().lower()
    password   = data.get("password") or ""

    if not first_name or not last_name:
        return jsonify({"ok": False, "error": "First name and last name are required"}), 400
    if not email or "@" not in email:
        return jsonify({"ok": False, "error": "A valid email address is required"}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        user = db.create_user(first_name, last_name, email, password_hash)
    except ValueError as e:
        if "email_already_registered" in str(e):
            return jsonify({"ok": False, "error": "An account with this email already exists"}), 409
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Registration failed: %s", e)
        return jsonify({"ok": False, "error": "Registration failed"}), 500

    # Generate and store verification token
    verify_token  = generate_verify_token()
    expiry_hours  = Config.EMAIL_VERIFY_EXPIRE_HOURS
    expiry_utc    = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    db.set_verify_token(user["id"], verify_token, expiry_utc)
    send_verification_email(user, verify_token, expiry_hours)

    return jsonify({"ok": True, "requiresVerification": True}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"ok": False, "error": "Email and password are required"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    user = db.get_user_by_email(email)
    if not user:
        return jsonify({"ok": False, "error": "Invalid email or password"}), 401
    if not user["isActive"]:
        return jsonify({"ok": False, "error": "Account is inactive"}), 403
    if not bcrypt.checkpw(password.encode(), user["passwordHash"].encode()):
        return jsonify({"ok": False, "error": "Invalid email or password"}), 401
    if not user["emailVerified"]:
        return jsonify({"ok": False, "error": "email_not_verified"}), 403

    token = _make_token(user["id"], user["email"])
    return jsonify({"ok": True, "token": token, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "emailVerified": True,
    }})


@app.route("/api/auth/verify-email", methods=["GET"])
def api_auth_verify_email():
    token = (request.args.get("token") or "").strip()
    if not token:
        return jsonify({"ok": False, "error": "token_invalid"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    user = db.get_user_by_verify_token(token)
    if not user:
        return jsonify({"ok": False, "error": "token_invalid"}), 400

    db.mark_email_verified(user["id"])
    jwt_token = _make_token(user["id"], user["email"])
    return jsonify({"ok": True, "token": jwt_token, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "emailVerified": True,
    }})


@app.route("/api/auth/resend-verification", methods=["POST"])
def api_auth_resend_verification():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    # Always return success to prevent email enumeration
    _GENERIC_OK = jsonify({"ok": True, "message": "If that address is registered, a new verification link has been sent."})

    if not email or "@" not in email:
        return _GENERIC_OK

    if not db.is_ready():
        return _GENERIC_OK

    user = db.get_user_by_email(email)
    if not user or not user["isActive"] or user["emailVerified"]:
        return _GENERIC_OK

    # Rate-limit: reject if a token was issued less than 60 seconds ago
    existing_expiry = db.get_verify_token_issued_at(user["id"])
    if existing_expiry:
        issued_at_estimate = existing_expiry - timedelta(hours=Config.EMAIL_VERIFY_EXPIRE_HOURS)
        if (datetime.now(timezone.utc) - issued_at_estimate.replace(tzinfo=timezone.utc)).total_seconds() < 60:
            return _GENERIC_OK

    verify_token = generate_verify_token()
    expiry_hours = Config.EMAIL_VERIFY_EXPIRE_HOURS
    expiry_utc   = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    db.set_verify_token(user["id"], verify_token, expiry_utc)
    send_verification_email(user, verify_token, expiry_hours)
    return _GENERIC_OK


@app.route("/api/auth/me", methods=["GET"])
@require_auth
def api_auth_me():
    user = db.get_user_by_id(g.current_user_id)
    if not user:
        return jsonify({"ok": False, "error": "User not found"}), 404
    return jsonify({"ok": True, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
    }})


@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def api_auth_logout():
    # Stateless JWT — client drops the token; server just acknowledges.
    return jsonify({"ok": True})


# ── Protected API routes start here ───────────────────────────────────────────

@app.route("/api/scan", methods=["POST"])
@require_auth
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
@require_auth
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
@require_auth
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
@require_auth
def api_history_result(scan_id):
    """Return the full stored result for a scan."""
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


@app.route("/api/history/prev-scan", methods=["GET"])
@require_auth
def api_history_prev_scan():
    """Return the most recent previous scan summary for a given URL."""
    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "url parameter required"}), 400
    if not db.is_ready():
        return jsonify({"ok": True, "scan": None})
    try:
        scan = db.get_prev_scan_summary_for_url(url)
        return jsonify({"ok": True, "scan": scan})
    except Exception as e:
        logging.exception("[DB] Failed to get prev scan for url: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/keyboard", methods=["POST"])
@require_auth
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
        if db.is_ready():
            try:
                db.save_assistive_scan("keyboard", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist keyboard scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/color-contrast", methods=["POST"])
@require_auth
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
        if db.is_ready():
            try:
                db.save_assistive_scan("contrast", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist contrast scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/page-structure", methods=["POST"])
@require_auth
def api_assisted_page_structure():
    """Run page structure checks (headings + landmarks) for a URL."""
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
        result = run_page_structure_assisted_test(url)
        if db.is_ready():
            try:
                db.save_assistive_scan("page-structure", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist page-structure scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assistive-history", methods=["GET"])
@require_auth
def api_assistive_history():
    """Return assistive scan history (keyboard + contrast) from the database."""
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "items": [],
            "message": "Assistive scan history is unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        scan_type = (request.args.get("scan_type") or "").strip() or None
        url_filter = (request.args.get("url") or "").strip() or None
        from_date = (request.args.get("from") or "").strip() or None
        to_date = (request.args.get("to") or "").strip() or None
        limit = request.args.get("limit", type=int) or 200
        items = db.get_assistive_scans(
            scan_type=scan_type,
            url=url_filter,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get assistive history: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/trends", methods=["GET"])
@require_auth
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
@require_auth
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
    logging.info("Crawl API received | keys=%s notifyEmail=%r", list(data.keys()), data.get("notifyEmail"))
    options = {
        "max_depth": data.get("maxDepth"),
        "max_pages": data.get("maxPages"),
        "full_site": bool(data.get("fullSite", False)),
        "notify_email": (data.get("notifyEmail") or "").strip() or None,
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
@require_auth
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


@app.route("/api/crawl/<string:crawl_id>/stop", methods=["POST"])
@require_auth
def api_crawl_stop(crawl_id):
    """Cancel a running or pending crawl job."""
    try:
        found = cancel_crawl_job(crawl_id)
    except Exception as e:
        logging.exception("Error stopping crawl: %s", e)
        return jsonify({"ok": False, "error": "Unable to stop crawl"}), 500
    if not found:
        return jsonify({"ok": False, "error": "Crawl job not found"}), 404
    return jsonify({"ok": True, "crawl_id": crawl_id, "status": "cancelled"})


@app.route("/api/crawl/<string:crawl_id>/pages", methods=["GET"])
@require_auth
def api_crawl_pages(crawl_id):
    """Return all scanned pages for a crawl job."""
    try:
        pages = get_crawl_pages(crawl_id)
    except Exception as e:
        logging.exception("Error fetching crawl pages: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve crawl pages"}), 500
    return jsonify({"ok": True, "crawl_id": crawl_id, "pages": pages, "count": len(pages)})


@app.route("/api/crawls", methods=["GET"])
@require_auth
def api_crawls_list():
    """Return recent crawl jobs from the database, ordered newest first."""
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "items": [],
            "message": "Crawl history unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        limit = request.args.get("limit", type=int) or 25
        items = db.get_all_crawl_jobs(limit=limit)
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get crawl jobs: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl/<string:crawl_id>/intelligence", methods=["GET"])
@require_auth
def api_crawl_intelligence(crawl_id):
    """WCAG breakdown, severity distribution, and top issue types for a specific crawl."""
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        intel = db.get_crawl_violation_intel(crawl_id)
        return jsonify({"ok": True, "available": True, **intel})
    except Exception as e:
        logging.exception("Error getting crawl intelligence: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl/<string:crawl_id>/regressions", methods=["GET"])
@require_auth
def api_crawl_regressions(crawl_id):
    """Compare crawl_id pages against the previous completed crawl for the same root URL."""
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        data = db.get_crawl_regressions(crawl_id)
        return jsonify({"ok": True, **data})
    except Exception as e:
        logging.exception("Error getting crawl regressions: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawls/compare", methods=["GET"])
@require_auth
def api_crawls_compare():
    """Side-by-side comparison of two crawls. Query params: a=<crawl_id>&b=<crawl_id>"""
    crawl_id_a = (request.args.get("a") or "").strip()
    crawl_id_b = (request.args.get("b") or "").strip()
    if not crawl_id_a or not crawl_id_b:
        return jsonify({"ok": False, "error": "Query params 'a' and 'b' are required"}), 400
    if crawl_id_a == crawl_id_b:
        return jsonify({"ok": False, "error": "Cannot compare a crawl with itself"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        result = db.compare_crawls(crawl_id_a, crawl_id_b)
        if result is None:
            return jsonify({"ok": False, "error": "One or both crawl IDs not found"}), 404
        return jsonify({"ok": True, **result})
    except Exception as e:
        logging.exception("Error comparing crawls: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawls/timeline", methods=["GET"])
@require_auth
def api_crawls_timeline():
    """Score history for all completed crawls of a root URL. Query param: url=<root_url>"""
    root_url = (request.args.get("url") or "").strip()
    if not root_url:
        return jsonify({"ok": False, "error": "Query param 'url' is required"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "available": False, "data": [],
                        "message": "Database not configured"}), 200
    try:
        limit = request.args.get("limit", type=int) or 20
        data = db.get_crawl_score_timeline(root_url, limit=limit)
        return jsonify({"ok": True, "url": root_url, "data": data, "count": len(data)})
    except Exception as e:
        logging.exception("Error getting crawl timeline: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Phase 3: Crawl Schedules (Feature 1) ──────────────────────────────────────

@app.route("/api/crawl-schedules", methods=["GET"])
@require_auth
def api_crawl_schedules_list():
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": [],
                        "message": "Database not configured"}), 200
    try:
        items = db.get_crawl_schedules()
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        logging.exception("Failed to list crawl schedules: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules", methods=["POST"])
@require_auth
def api_crawl_schedules_create():
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    frequency = (data.get("frequency") or "weekly").strip().lower()
    if not url:
        return jsonify({"ok": False, "error": "Missing 'url'"}), 400
    if frequency not in ("daily", "weekly", "monthly"):
        frequency = "weekly"
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    try:
        sched = db.create_crawl_schedule(url, frequency)
        return jsonify({"ok": True, "schedule": sched}), 201
    except Exception as e:
        logging.exception("Failed to create crawl schedule: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules/<int:schedule_id>", methods=["PATCH"])
@require_auth
def api_crawl_schedules_update(schedule_id):
    data = request.get_json(silent=True) or {}
    kwargs = {}
    if "enabled" in data:
        kwargs["enabled"] = bool(data["enabled"])
    if "frequency" in data:
        kwargs["frequency"] = str(data["frequency"])
    if not kwargs:
        return jsonify({"ok": False, "error": "Nothing to update"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.update_crawl_schedule(schedule_id, **kwargs)
    return jsonify({"ok": ok})


@app.route("/api/crawl-schedules/<int:schedule_id>", methods=["DELETE"])
@require_auth
def api_crawl_schedules_delete(schedule_id):
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.delete_crawl_schedule(schedule_id)
    return jsonify({"ok": ok})


# ── Phase 3: AI Summary (Feature 2) ───────────────────────────────────────────

@app.route("/api/crawl/<string:crawl_id>/summary", methods=["GET"])
@require_auth
def api_crawl_ai_summary(crawl_id):
    if not db.is_ready():
        return jsonify({"ok": False, "available": False, "message": "Database not configured"}), 200
    import json as _json
    raw = db.get_crawl_ai_summary(crawl_id)
    if raw is None:
        # Trigger generation on demand if API key is present
        from backend.services.ai_summary_service import generate_and_store_summary
        try:
            generate_and_store_summary(crawl_id)
            raw = db.get_crawl_ai_summary(crawl_id)
        except Exception as e:
            logging.warning("On-demand AI summary failed: %s", e)
    if raw is None:
        return jsonify({"ok": True, "available": False, "summary": None})
    try:
        summary = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        summary = {"overall_health": raw}
    return jsonify({"ok": True, "available": True, "summary": summary})


# ── Phase 3: Alerts (Feature 3) ────────────────────────────────────────────────

@app.route("/api/alerts", methods=["GET"])
@require_auth
def api_alerts_list():
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": [],
                        "message": "Database not configured"}), 200
    try:
        status_filter = request.args.get("status") or None
        limit = request.args.get("limit", type=int) or 50
        items = db.get_alerts(status=status_filter, limit=limit)
        unread = db.get_unacknowledged_alert_count()
        return jsonify({"ok": True, "items": items, "unread_count": unread})
    except Exception as e:
        logging.exception("Failed to list alerts: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/alerts/<int:alert_id>/acknowledge", methods=["PATCH"])
@require_auth
def api_alerts_acknowledge(alert_id):
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.acknowledge_alert(alert_id)
    return jsonify({"ok": ok})


@app.route("/api/alerts/unread-count", methods=["GET"])
@require_auth
def api_alerts_unread_count():
    if not db.is_ready():
        return jsonify({"ok": True, "count": 0})
    return jsonify({"ok": True, "count": db.get_unacknowledged_alert_count()})


# ── Phase 3: Digest (Feature 4) ────────────────────────────────────────────────

@app.route("/api/digests", methods=["GET"])
@require_auth
def api_digests_list():
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": [],
                        "message": "Database not configured"}), 200
    try:
        limit = request.args.get("limit", type=int) or 12
        items = db.get_digests(limit=limit)
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        logging.exception("Failed to list digests: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/digests/trigger", methods=["POST"])
@require_auth
def api_digests_trigger():
    """Manually trigger digest generation (for testing / on-demand use)."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    try:
        from backend.services.digest_service import generate_weekly_digest
        data = request.get_json(silent=True) or {}
        send = bool(data.get("send_email", True))
        digest = generate_weekly_digest(send_email=send)
        if digest is None:
            return jsonify({"ok": False, "error": "No crawl data found for the past 7 days"})
        return jsonify({"ok": True, "digest": digest})
    except Exception as e:
        logging.exception("Digest trigger failed: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Phase 3: Page Trends (Feature 6) ──────────────────────────────────────────

@app.route("/api/crawl/<string:crawl_id>/page-trends", methods=["GET"])
@require_auth
def api_crawl_page_trends(crawl_id):
    if not db.is_ready():
        return jsonify({"ok": True, "has_comparison": False}), 200
    try:
        data = db.get_page_trends(crawl_id)
        return jsonify({"ok": True, **data})
    except Exception as e:
        logging.exception("Error getting page trends: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/violations/summary", methods=["GET"])
@require_auth
def api_violations_summary():
    """Aggregate violation intelligence from recent scan payloads.

    Architecture note: regression detection uses only the Violations integer
    column (no JSON parsing), so it is fast regardless of payload size.
    Payload parsing is bounded by the limit param (default 100 rows).
    """
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "severity_breakdown": {"critical": 0, "serious": 0, "moderate": 0, "minor": 0},
            "top_issue_types": [],
            "wcag_breakdown": [],
            "needs_attention": [],
            "message": "Violation summary unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        limit = request.args.get("limit", type=int) or 100
        intel = db.get_violation_intel(limit=limit)
        regressions = db.get_regression_candidates()
        return jsonify({
            "ok": True,
            "available": True,
            **intel,
            "needs_attention": regressions,
        })
    except Exception as e:
        logging.exception("[DB] Failed to get violation summary: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/ai-fix", methods=["POST"])
@require_auth
def api_ai_fix():
    """Generate an AI-powered accessibility fix using Claude API."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400

    violation = data.get("violation") or {}
    framework = (data.get("framework") or "html").strip().lower()

    if not violation or not violation.get("id"):
        return jsonify({"ok": False, "error": "Missing violation data"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        # Return structured mock response when no key configured
        return jsonify({
            "ok": True,
            "explanation": f"This violation ({violation.get('id')}) was detected. Configure ANTHROPIC_API_KEY in .env to get AI-powered fixes.",
            "wcagCriterion": violation.get("helpUrl", "https://www.w3.org/WAI/WCAG21/"),
            "before": "<!-- Original code with accessibility issue -->\n<input type=\"email\" placeholder=\"Work email\" />",
            "after": "<!-- Fixed code -->\n<label for=\"email\">Work email</label>\n<input id=\"email\" type=\"email\" autocomplete=\"email\" />",
        })

    # Build prompt
    rule_id = violation.get("id", "unknown")
    description = violation.get("description", "")
    impact = violation.get("impact", "serious")
    help_text = violation.get("help", "")
    help_url = violation.get("helpUrl", "")
    nodes = violation.get("nodes", [])
    node_html = nodes[0].get("html", "") if nodes else ""

    framework_note = {
        "react": "Use React/JSX syntax (htmlFor instead of for, className instead of class, camelCase attributes)",
        "vue": "Use Vue 3 template syntax with proper accessibility attributes",
        "html": "Use standard HTML5 with ARIA attributes where needed",
    }.get(framework, "Use standard HTML5")

    prompt = f"""You are an expert web accessibility engineer specializing in WCAG 2.1 compliance.

A website accessibility scanner detected this violation:
- Rule ID: {rule_id}
- Impact: {impact}
- Description: {description}
- Help: {help_text}
- WCAG Reference: {help_url}
- Example HTML with issue: {node_html}

Framework: {framework_note}

Provide a structured fix in this EXACT JSON format (no other text, valid JSON only):
{{
  "explanation": "Plain English explanation of WHY this is an accessibility problem and WHO it affects",
  "wcagCriterion": "WCAG 2.1 Success Criterion X.X.X - Criterion Name (Level A/AA/AAA)",
  "before": "The problematic code snippet (2-10 lines max)",
  "after": "The corrected code snippet with proper accessibility attributes (2-10 lines max)"
}}"""

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 800,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())

        text = result["content"][0]["text"].strip()
        # Parse JSON from Claude response
        fix_data = json.loads(text)
        return jsonify({"ok": True, **fix_data})

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logging.error("Claude API error: %s %s", e.code, body)
        return jsonify({"ok": False, "error": f"AI service error: {e.code}"}), 502
    except json.JSONDecodeError as e:
        logging.error("Failed to parse Claude JSON response: %s", e)
        return jsonify({"ok": False, "error": "AI response parsing failed"}), 502
    except Exception as e:
        logging.exception("AI fix endpoint error: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


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
