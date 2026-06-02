import os


def _parse_int_list(value: str, default: str) -> list[int]:
    raw = os.getenv(value, default)
    return [int(item) for item in (raw or "").split(",") if item.strip().isdigit()]


class Config:
    REDIS_URL = os.getenv("REDIS_URL", "")
    MSSQL_CONN_STR = os.getenv("MSSQL_CONN_STR", "")
    SCAN_QUEUE_NAME = os.getenv("SCAN_QUEUE_NAME", "ada_scan_queue")
    SCAN_WORKER_MAX_WORKERS = int(os.getenv("SCAN_WORKER_MAX_WORKERS", "2"))
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    APP_ENV = os.getenv("APP_ENV", os.getenv("FLASK_ENV", "development"))
    IS_PRODUCTION = APP_ENV.lower() == "production"
    BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
    SCAN_TIMEOUT_SECONDS = int(os.getenv("SCAN_TIMEOUT_SECONDS", "300"))
    SCAN_JOB_RETRY_MAX = int(os.getenv("SCAN_JOB_RETRY_MAX", "2"))
    SCAN_JOB_RETRY_INTERVALS = _parse_int_list("SCAN_JOB_RETRY_INTERVALS", "15,30")
    SCAN_JOB_RESULT_TTL = int(os.getenv("SCAN_JOB_RESULT_TTL", "86400"))
    SCAN_JOB_FAILURE_TTL = int(os.getenv("SCAN_JOB_FAILURE_TTL", "604800"))
    ALLOW_LOCAL_QUEUE_FALLBACK = os.getenv(
        "ALLOW_LOCAL_QUEUE_FALLBACK",
        "true" if not IS_PRODUCTION else "false",
    ).lower() in ("1", "true", "yes")
    # Crawler defaults
    CRAWL_MAX_DEPTH = int(os.getenv("CRAWL_MAX_DEPTH", "3"))
    CRAWL_MAX_PAGES = int(os.getenv("CRAWL_MAX_PAGES", "50"))
    CRAWL_TIMEOUT_SECONDS = int(os.getenv("CRAWL_TIMEOUT_SECONDS", "1800"))
    # Full-site crawl ceilings (used when fullSite=true is sent from the UI)
    CRAWL_MAX_PAGES_FULL = int(os.getenv("CRAWL_MAX_PAGES_FULL", "10000"))
    CRAWL_MAX_DEPTH_FULL = int(os.getenv("CRAWL_MAX_DEPTH_FULL", "10"))
