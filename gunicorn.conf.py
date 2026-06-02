# Gunicorn configuration for the ADA Tool Flask app.
# Used by: Docker (CMD), and any direct `gunicorn app:app` invocation.
# Local development uses `python app.py` (Flask dev server) — this file is not used there.

# One worker: Playwright launches a subprocess per scan; multiple workers would
# each try to launch browsers concurrently and exhaust memory.
workers = 1

# Threads allow concurrent request handling within the single worker — needed
# so poll requests (GET /api/scan/<id>) are served while a scan runs in the
# background thread pool.
threads = 4

# Worker timeout in seconds. Must exceed the longest blocking request.
# Assisted test endpoints (/api/assisted/*) run Playwright synchronously and
# take up to 45 seconds. 120s gives a comfortable margin.
# Note: /api/scan itself is non-blocking (returns a job ID immediately).
timeout = 120
