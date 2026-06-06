#!/bin/bash
# Full-stack startup: Redis + Flask + RQ worker
# Usage (from project root in WSL): bash start.sh

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

source env/bin/activate

# Start Redis if not already running
if ! redis-cli ping > /dev/null 2>&1; then
    echo "[start] Starting Redis..."
    redis-server --daemonize yes --logfile /tmp/redis-ada.log
else
    echo "[start] Redis already running."
fi

# Start Flask in background
echo "[start] Starting Flask (app.py)..."
python app.py &
FLASK_PID=$!

# Start RQ worker in background
echo "[start] Starting RQ worker..."
REDIS_URL=redis://localhost:6379 env/bin/python workers/run_worker.py &
WORKER_PID=$!

echo ""
echo "  Flask  PID: $FLASK_PID"
echo "  Worker PID: $WORKER_PID"
echo ""
echo "  Open http://localhost:5000"
echo "  Press Ctrl+C to stop both."
echo ""

# Wait and forward Ctrl+C to both processes
trap "echo ''; echo '[start] Stopping...'; kill $FLASK_PID $WORKER_PID 2>/dev/null; exit 0" INT TERM
wait $FLASK_PID $WORKER_PID
