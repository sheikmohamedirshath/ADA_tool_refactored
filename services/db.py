"""
MSSQL persistence for ADA scan history.
Requires: pyodbc, ODBC Driver 18 for SQL Server, env MSSQL_CONN_STR.

If MSSQL_CONN_STR is set, the app will automatically create the database and
ScanHistory table on startup (when running on Azure, AWS, or locally). No manual setup needed.
"""
import json
import logging
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)


def _load_local_env() -> None:
    """Load simple KEY=VALUE pairs from a local .env file if present."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_local_env()

_CONNECTION_STRING = (os.getenv("MSSQL_CONN_STR") or "").strip()
_DATABASE = os.getenv("MSSQL_DATABASE", "ADA_DB")
_INIT_DONE = False
_INIT_ERROR = ""


def _validate_database_name(name: str) -> None:
    if not re.match(r"^[a-zA-Z0-9_]+$", name):
        raise ValueError(f"Invalid MSSQL_DATABASE: {name!r}")


def _connection_string_to_master() -> str | None:
    """Build a connection string that targets the master database so we can create ADA_DB."""
    if not _CONNECTION_STRING:
        return None
    s = _CONNECTION_STRING
    # Replace Database=... or Initial Catalog=... with master (case-insensitive)
    s = re.sub(r"Database=[^;]*", "Database=master", s, flags=re.IGNORECASE)
    s = re.sub(r"Initial Catalog=[^;]*", "Initial Catalog=master", s, flags=re.IGNORECASE)
    if "Database=" not in s and "Initial Catalog=" not in s:
        s = s.rstrip(";") + ";Database=master"
    return s


def _app_connection_string() -> str:
    """Connection string for the app database (e.g. ADA_DB). Ensures Database= is set."""
    if not _CONNECTION_STRING:
        raise RuntimeError("MSSQL_CONN_STR environment variable is not set")
    s = _CONNECTION_STRING
    _validate_database_name(_DATABASE)
    if "Database=" in s or "Initial Catalog=" in s:
        s = re.sub(r"Database=[^;]*", f"Database={_DATABASE}", s, flags=re.IGNORECASE)
        s = re.sub(r"Initial Catalog=[^;]*", f"Initial Catalog={_DATABASE}", s, flags=re.IGNORECASE)
    else:
        s = s.rstrip(";") + f";Database={_DATABASE}"
    return s


def _conn():
    import pyodbc
    return pyodbc.connect(_app_connection_string())


def is_enabled() -> bool:
    """Return True when scan history persistence is configured."""
    return bool(_CONNECTION_STRING)


def init_error() -> str:
    """Return the last database initialization error, if any."""
    return _INIT_ERROR


def is_ready() -> bool:
    """Return True when persistence is configured and startup init succeeded."""
    return is_enabled() and not _INIT_ERROR


def _ensure_database() -> None:
    """Create the database if it does not exist (connects to master)."""
    master_cs = _connection_string_to_master()
    if not master_cs:
        return
    import pyodbc
    _validate_database_name(_DATABASE)
    conn = pyodbc.connect(master_cs)
    try:
        conn.autocommit = True  # CREATE DATABASE requires autocommit
        cur = conn.cursor()
        # Database name cannot be parameterized in T-SQL; we validated _DATABASE above
        cur.execute(f"IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = N'{_DATABASE}') CREATE DATABASE [{_DATABASE}]")
    finally:
        conn.close()


def _ensure_table() -> None:
    """Create required persistence tables and add missing columns."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = N'ScanHistory')
            CREATE TABLE dbo.ScanHistory (
                Id             INT IDENTITY(1,1) PRIMARY KEY,
                Url            NVARCHAR(2048) NOT NULL,
                TimestampUtc   DATETIME2(3)   NOT NULL,
                Passes         INT            NOT NULL,
                Violations     INT            NOT NULL,
                PassRate       INT            NOT NULL,
                UsedFallback   BIT            NOT NULL,
                IncludeBestPractices BIT      NOT NULL DEFAULT 0,
                ResultPayload  NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'ScanJobs')
            CREATE TABLE dbo.ScanJobs (
                JobId           NVARCHAR(100) PRIMARY KEY,
                Url             NVARCHAR(2048) NOT NULL,
                Status          NVARCHAR(50)  NOT NULL,
                WorkerName      NVARCHAR(128) NULL,
                Attempt         INT            NOT NULL DEFAULT 0,
                CreatedAt       DATETIME2(3)   NOT NULL,
                StartedAt       DATETIME2(3)   NULL,
                EndedAt         DATETIME2(3)   NULL,
                DurationSeconds FLOAT          NULL,
                FailureReason   NVARCHAR(MAX)  NULL,
                ResultPayload   NVARCHAR(MAX)  NULL,
                Metadata        NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        # Ensure schema evolution for ScanHistory
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'ResultPayload'
            )
            ALTER TABLE dbo.ScanHistory ADD ResultPayload NVARCHAR(MAX) NULL
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'IncludeBestPractices'
            )
            ALTER TABLE dbo.ScanHistory ADD IncludeBestPractices BIT NOT NULL CONSTRAINT DF_ScanHistory_IncludeBestPractices DEFAULT 0
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'IX_ScanHistory_TimestampUtc'
            )
            CREATE INDEX IX_ScanHistory_TimestampUtc ON dbo.ScanHistory(TimestampUtc DESC)
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.ScanJobs') AND name = N'IX_ScanJobs_Status'
            )
            CREATE INDEX IX_ScanJobs_Status ON dbo.ScanJobs(Status)
        """)
        conn.commit()
        # ── Crawler tables ────────────────────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'CrawlJob')
            CREATE TABLE dbo.CrawlJob (
                CrawlId         NVARCHAR(100)  PRIMARY KEY,
                RQJobId         NVARCHAR(100)  NULL,
                RootUrl         NVARCHAR(2048) NOT NULL,
                Status          NVARCHAR(50)   NOT NULL,
                MaxDepth        INT            NOT NULL DEFAULT 3,
                MaxPages        INT            NOT NULL DEFAULT 50,
                TotalDiscovered INT            NOT NULL DEFAULT 0,
                TotalScanned    INT            NOT NULL DEFAULT 0,
                TotalFailed     INT            NOT NULL DEFAULT 0,
                CreatedAt       DATETIME2(3)   NOT NULL,
                StartedAt       DATETIME2(3)   NULL,
                EndedAt         DATETIME2(3)   NULL,
                DurationSeconds FLOAT          NULL,
                FailureReason   NVARCHAR(MAX)  NULL,
                Metadata        NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'CrawlPage')
            CREATE TABLE dbo.CrawlPage (
                Id              INT IDENTITY(1,1) PRIMARY KEY,
                CrawlId         NVARCHAR(100)  NOT NULL,
                Url             NVARCHAR(2048) NOT NULL,
                NormalizedUrl   NVARCHAR(2048) NOT NULL,
                ParentUrl       NVARCHAR(2048) NULL,
                Depth           INT            NOT NULL DEFAULT 0,
                Status          NVARCHAR(50)   NOT NULL,
                ScanHistoryId   INT            NULL,
                Passes          INT            NULL,
                Violations      INT            NULL,
                PassRate        INT            NULL,
                DiscoveredAt    DATETIME2(3)   NOT NULL,
                ScannedAt       DATETIME2(3)   NULL,
                FailureReason   NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.CrawlJob') AND name = N'IX_CrawlJob_Status'
            )
            CREATE INDEX IX_CrawlJob_Status ON dbo.CrawlJob(Status)
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.CrawlPage') AND name = N'IX_CrawlPage_CrawlId'
            )
            CREATE INDEX IX_CrawlPage_CrawlId ON dbo.CrawlPage(CrawlId)
        """)
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """
    Create the database and ScanHistory table if they do not exist.
    Call this at app startup. Safe to call multiple times.
    """
    global _INIT_DONE, _INIT_ERROR
    if not _CONNECTION_STRING:
        _INIT_ERROR = "MSSQL_CONN_STR is not set"
        logger.warning("MSSQL_CONN_STR not set — scan history will not be persisted. Set it to create ADA_DB and table automatically.")
        return
    if _INIT_DONE:
        return
    try:
        logger.info("Creating database and table if needed...")
        try:
            # Preferred path for existing deployments: connect directly to ADA_DB
            # and create only the table if it is missing.
            _ensure_table()
        except Exception:
            # Fallback for fresh environments where the database itself does not exist yet.
            _ensure_database()
            _ensure_table()
        _INIT_DONE = True
        _INIT_ERROR = ""
        logger.info("Database and table ready.")
        reset_orphaned_jobs()
    except Exception as e:
        _INIT_ERROR = str(e)
        logger.exception("Database initialization failed: %s", e)
        _INIT_DONE = True  # Avoid repeated log spam


def reset_orphaned_jobs(stale_seconds: int = 600) -> int:
    """
    Mark ScanJobs rows stuck in 'running' for longer than stale_seconds as 'failed'.
    Protects against jobs that were running when the worker process crashed.
    Safe to call multiple times; only affects rows genuinely past the stale window.
    Returns the number of rows updated.
    """
    if not is_enabled() or _INIT_ERROR:
        return 0
    try:
        conn = _conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE dbo.ScanJobs
                    SET    Status        = 'failed',
                           FailureReason = 'Worker process crashed or restarted before job completed',
                           EndedAt       = GETUTCDATE()
                    WHERE  Status = 'running'
                      AND  StartedAt < DATEADD(SECOND, ?, GETUTCDATE())
                    """,
                    (-stale_seconds,),
                )
                count = cur.rowcount
            conn.commit()
            if count:
                logger.warning("Reset %d orphaned 'running' job(s) to 'failed'", count)
            return count
        finally:
            conn.close()
    except Exception:
        logger.exception("Failed to reset orphaned jobs")
        return 0


def _row_to_dict(row):
    if row is None:
        return None
    return {
        "job_id": row.JobId,
        "url": row.Url,
        "status": row.Status,
        "worker_name": row.WorkerName,
        "attempt": row.Attempt,
        "created_at": row.CreatedAt.isoformat() if row.CreatedAt else None,
        "started_at": row.StartedAt.isoformat() if row.StartedAt else None,
        "ended_at": row.EndedAt.isoformat() if row.EndedAt else None,
        "duration_seconds": row.DurationSeconds,
        "failure_reason": row.FailureReason,
        "result_payload": json.loads(row.ResultPayload) if row.ResultPayload else None,
        "metadata": json.loads(row.Metadata) if row.Metadata else None,
    }


def save_scan_job(
    job_id: str,
    url: str,
    metadata: dict | None = None,
    status: str = "pending",
    created_at: str | None = None,
    attempt: int = 0,
    worker_name: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    metadata_json = json.dumps(metadata or {})
    created_at = created_at or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                IF EXISTS (SELECT 1 FROM dbo.ScanJobs WHERE JobId = ?)
                UPDATE dbo.ScanJobs
                SET Url = ?, Status = ?, WorkerName = ?, Attempt = ?, CreatedAt = ?, Metadata = ?
                WHERE JobId = ?
                ELSE
                INSERT INTO dbo.ScanJobs (JobId, Url, Status, WorkerName, Attempt, CreatedAt, Metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, url, status, worker_name, attempt, created_at, metadata_json, job_id, job_id, url, status, worker_name, attempt, created_at, metadata_json),
            )
        conn.commit()
    finally:
        conn.close()


def update_scan_job_status(
    job_id: str,
    status: str,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration_seconds: float | None = None,
    failure_reason: str | None = None,
    result_payload: dict | None = None,
    worker_name: str | None = None,
    attempt: int | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates = ["Status = ?"]
    params = [status]
    if started_at is not None:
        updates.append("StartedAt = ?")
        params.append(started_at)
    if ended_at is not None:
        updates.append("EndedAt = ?")
        params.append(ended_at)
    if duration_seconds is not None:
        updates.append("DurationSeconds = ?")
        params.append(duration_seconds)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    if result_payload is not None:
        updates.append("ResultPayload = ?")
        params.append(json.dumps(result_payload))
    if worker_name is not None:
        updates.append("WorkerName = ?")
        params.append(worker_name)
    if attempt is not None:
        updates.append("Attempt = ?")
        params.append(attempt)

    params.append(job_id)
    sql = f"UPDATE dbo.ScanJobs SET {', '.join(updates)} WHERE JobId = ?"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def get_scan_job(job_id: str) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM dbo.ScanJobs WHERE JobId = ?",
                (job_id,),
            )
            row = cur.fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def save_scan_history(result: dict, limit: int = 500) -> int | None:
    """
    Insert one row into dbo.ScanHistory with full result JSON for later retrieval.
    Returns the auto-assigned Id of the inserted row (used by the crawler to link
    CrawlPage.ScanHistoryId). Returns None if persistence is disabled or insert fails.
    result: dict from process_url() with keys axeResult, url, usedFallback.
    """
    axe = (result or {}).get("axeResult") or {}
    passes = len(axe.get("passes") or [])
    violations = len(axe.get("violations") or [])
    total = passes + violations
    pass_rate = round(passes / total * 100) if total else 0
    timestamp = axe.get("timestamp") or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    url = (axe.get("url") or result.get("url") or "").strip()
    used_fallback = bool(result.get("usedFallback"))
    include_best_practices = bool(result.get("includeBestPractices"))
    payload_json = json.dumps(result) if result else None

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.ScanHistory
                    (Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback, IncludeBestPractices, ResultPayload)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (url, timestamp, passes, violations, pass_rate,
                 1 if used_fallback else 0, 1 if include_best_practices else 0, payload_json),
            )
            row = cur.fetchone()
            new_id = int(row[0]) if row and row[0] is not None else None
        conn.commit()
        return new_id
    finally:
        conn.close()


def get_scan_result(scan_id: int) -> dict | None:
    """
    Return the full stored result for a scan (same shape as process_url output).
    Returns None if scan_id not found or ResultPayload is null/empty.
    """
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ResultPayload FROM dbo.ScanHistory WHERE Id = ?",
                (scan_id,),
            )
            row = cur.fetchone()
        if not row or not row.ResultPayload:
            return None
        return json.loads(row.ResultPayload)
    except (json.JSONDecodeError, TypeError):
        return None
    finally:
        conn.close()


def get_scan_history(limit: int = 500):
    """
    Return list of scan summary dicts from dbo.ScanHistory, newest first.
    Each dict: id, url, timestamp, passes, violations, passRate, usedFallback.
    """
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) Id, Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback, IncludeBestPractices
                FROM dbo.ScanHistory
                ORDER BY TimestampUtc DESC
                """,
                (limit,),
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            ts = r.TimestampUtc
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            out.append({
                "id": f"SCAN-{r.Id}",
                "url": r.Url or "",
                "timestamp": ts,
                "passes": r.Passes,
                "violations": r.Violations,
                "passRate": r.PassRate,
                "usedFallback": bool(r.UsedFallback),
                "includeBestPractices": bool(getattr(r, "IncludeBestPractices", 0)),
            })
        return out
    finally:
        conn.close()


# ── Trend aggregation ─────────────────────────────────────────────────────────

_TREND_SQL: dict[str, str] = {
    "daily": """
        SELECT
            CAST(TimestampUtc AS DATE)                   AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY CAST(TimestampUtc AS DATE)
        ORDER BY BucketDate ASC
    """,
    "weekly": """
        SELECT
            MIN(CAST(TimestampUtc AS DATE))               AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY YEAR(TimestampUtc), DATEPART(week, TimestampUtc)
        ORDER BY MIN(CAST(TimestampUtc AS DATE)) ASC
    """,
    "monthly": """
        SELECT
            CAST(DATEFROMPARTS(YEAR(TimestampUtc), MONTH(TimestampUtc), 1) AS DATE) AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY YEAR(TimestampUtc), MONTH(TimestampUtc)
        ORDER BY YEAR(TimestampUtc) ASC, MONTH(TimestampUtc) ASC
    """,
}

_SUMMARY_SQL = """
    SELECT
        COUNT(*)                      AS TotalScans,
        AVG(CAST(PassRate AS FLOAT))  AS AvgPassRate,
        SUM(Violations)               AS TotalViolations,
        SUM(Passes)                   AS TotalPasses
    FROM dbo.ScanHistory
    WHERE TimestampUtc >= ? AND TimestampUtc < ?
"""


def get_scan_trends(
    granularity: str = "daily",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """
    Return time-bucketed scan aggregates for the trends dashboard.

    granularity: 'daily' | 'weekly' | 'monthly'
    start_date:  YYYY-MM-DD, inclusive (default: 30 days ago)
    end_date:    YYYY-MM-DD, inclusive (default: today)

    Returns {"data": [...], "summary": {...} | None}
    Each data item: date, scan_count, avg_pass_rate, total_violations, total_passes
    """
    if not is_enabled() or _INIT_ERROR:
        return {"data": [], "summary": None}
    if granularity not in _TREND_SQL:
        granularity = "daily"

    today = date.today()

    try:
        start = date.fromisoformat(start_date) if start_date else today - timedelta(days=30)
    except ValueError:
        start = today - timedelta(days=30)

    try:
        # end_date is inclusive from the caller's perspective; SQL uses strict <
        end = (date.fromisoformat(end_date) + timedelta(days=1)) if end_date else (today + timedelta(days=1))
    except ValueError:
        end = today + timedelta(days=1)

    start_str = start.isoformat()
    end_str = end.isoformat()

    conn = _conn()
    try:
        data: list[dict] = []
        with conn.cursor() as cur:
            cur.execute(_TREND_SQL[granularity], (start_str, end_str))
            for r in cur.fetchall():
                bucket = r[0]
                data.append({
                    "date": bucket.isoformat() if hasattr(bucket, "isoformat") else str(bucket),
                    "scan_count": int(r[1] or 0),
                    "avg_pass_rate": round(float(r[2] or 0), 1),
                    "total_violations": int(r[3] or 0),
                    "total_passes": int(r[4] or 0),
                })

        summary = None
        with conn.cursor() as cur:
            cur.execute(_SUMMARY_SQL, (start_str, end_str))
            row = cur.fetchone()
        if row and row[0]:
            summary = {
                "total_scans": int(row[0] or 0),
                "avg_pass_rate": round(float(row[1] or 0), 1),
                "total_violations": int(row[2] or 0),
                "total_passes": int(row[3] or 0),
            }

        return {"data": data, "summary": summary}
    finally:
        conn.close()


# ── Crawler persistence ────────────────────────────────────────────────────────

def _ts(value) -> str | None:
    """Convert a datetime to ISO string or return None."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def save_crawl_job(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
    rq_job_id: str | None = None,
    status: str = "pending",
    created_at: str | None = None,
    metadata: dict | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    created_at = created_at or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.CrawlJob
                    (CrawlId, RQJobId, RootUrl, Status, MaxDepth, MaxPages, CreatedAt, Metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (crawl_id, rq_job_id, root_url, status, max_depth, max_pages,
                 created_at, json.dumps(metadata or {})),
            )
        conn.commit()
    finally:
        conn.close()


def update_crawl_job_status(
    crawl_id: str,
    status: str,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration_seconds: float | None = None,
    failure_reason: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates = ["Status = ?"]
    params: list = [status]
    if started_at is not None:
        updates.append("StartedAt = ?")
        params.append(started_at)
    if ended_at is not None:
        updates.append("EndedAt = ?")
        params.append(ended_at)
    if duration_seconds is not None:
        updates.append("DurationSeconds = ?")
        params.append(duration_seconds)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    params.append(crawl_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlJob SET {', '.join(updates)} WHERE CrawlId = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def update_crawl_job_progress(
    crawl_id: str,
    total_discovered: int | None = None,
    total_scanned: int | None = None,
    total_failed: int | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates: list[str] = []
    params: list = []
    if total_discovered is not None:
        updates.append("TotalDiscovered = ?")
        params.append(total_discovered)
    if total_scanned is not None:
        updates.append("TotalScanned = ?")
        params.append(total_scanned)
    if total_failed is not None:
        updates.append("TotalFailed = ?")
        params.append(total_failed)
    if not updates:
        return
    params.append(crawl_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlJob SET {', '.join(updates)} WHERE CrawlId = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def get_crawl_job(crawl_id: str) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM dbo.CrawlJob WHERE CrawlId = ?",
                (crawl_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        return {
            "crawl_id": row.CrawlId,
            "rq_job_id": row.RQJobId,
            "root_url": row.RootUrl,
            "status": row.Status,
            "max_depth": row.MaxDepth,
            "max_pages": row.MaxPages,
            "total_discovered": row.TotalDiscovered,
            "total_scanned": row.TotalScanned,
            "total_failed": row.TotalFailed,
            "created_at": _ts(row.CreatedAt),
            "started_at": _ts(row.StartedAt),
            "ended_at": _ts(row.EndedAt),
            "duration_seconds": row.DurationSeconds,
            "failure_reason": row.FailureReason,
        }
    finally:
        conn.close()


def save_crawl_page(
    crawl_id: str,
    url: str,
    normalized_url: str,
    parent_url: str | None,
    depth: int,
    status: str = "running",
) -> int:
    """Insert a CrawlPage row and return its auto-increment Id (-1 if disabled)."""
    if not is_enabled() or _INIT_ERROR:
        return -1
    discovered_at = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.CrawlPage
                    (CrawlId, Url, NormalizedUrl, ParentUrl, Depth, Status, DiscoveredAt)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (crawl_id, url[:2048], normalized_url[:2048],
                 parent_url[:2048] if parent_url else None,
                 depth, status, discovered_at),
            )
            row = cur.fetchone()
            page_id = int(row[0]) if row and row[0] is not None else -1
        conn.commit()
        return page_id
    finally:
        conn.close()


def update_crawl_page(
    page_id: int,
    status: str,
    passes: int | None = None,
    violations: int | None = None,
    pass_rate: int | None = None,
    scan_history_id: int | None = None,
    scanned_at: str | None = None,
    failure_reason: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR or page_id < 0:
        return
    updates = ["Status = ?"]
    params: list = [status]
    if passes is not None:
        updates.append("Passes = ?")
        params.append(passes)
    if violations is not None:
        updates.append("Violations = ?")
        params.append(violations)
    if pass_rate is not None:
        updates.append("PassRate = ?")
        params.append(pass_rate)
    if scan_history_id is not None:
        updates.append("ScanHistoryId = ?")
        params.append(scan_history_id)
    if scanned_at is not None:
        updates.append("ScannedAt = ?")
        params.append(scanned_at)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    params.append(page_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlPage SET {', '.join(updates)} WHERE Id = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def get_crawl_pages(crawl_id: str) -> list[dict]:
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT Id, CrawlId, Url, NormalizedUrl, ParentUrl, Depth, Status,
                       ScanHistoryId, Passes, Violations, PassRate,
                       DiscoveredAt, ScannedAt, FailureReason
                FROM dbo.CrawlPage
                WHERE CrawlId = ?
                ORDER BY Id ASC
                """,
                (crawl_id,),
            )
            rows = cur.fetchall()
        return [
            {
                "id": r.Id,
                "crawl_id": r.CrawlId,
                "url": r.Url,
                "normalized_url": r.NormalizedUrl,
                "parent_url": r.ParentUrl,
                "depth": r.Depth,
                "status": r.Status,
                "scan_history_id": f"SCAN-{r.ScanHistoryId}" if r.ScanHistoryId else None,
                "passes": r.Passes,
                "violations": r.Violations,
                "pass_rate": r.PassRate,
                "discovered_at": _ts(r.DiscoveredAt),
                "scanned_at": _ts(r.ScannedAt),
                "failure_reason": r.FailureReason,
            }
            for r in rows
        ]
    finally:
        conn.close()
