#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

WORKSPACE="./workspace"
HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_PORT="5173"
RELOAD="--reload"

usage() {
  echo "Usage: ./start.sh [options]"
  echo
  echo "Options:"
  echo "  --workspace FOLDER     Backend data folder (default: backend/workspace)"
  echo "  --host HOST            Bind address for both servers (default: 127.0.0.1)"
  echo "  --backend-port PORT    Backend port (default: 8000)"
  echo "  --frontend-port PORT   Frontend port (default: 5173)"
  echo "  --no-reload            Disable backend auto-reload"
  echo "  -h, --help             Show this help"
}

require_value() {
  if [[ $# -lt 2 || -z "$2" ]]; then
    echo "Missing value for $1" >&2
    usage >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      require_value "$@"
      WORKSPACE="$2"
      shift 2
      ;;
    --host)
      require_value "$@"
      HOST="$2"
      shift 2
      ;;
    --backend-port)
      require_value "$@"
      BACKEND_PORT="$2"
      shift 2
      ;;
    --frontend-port)
      require_value "$@"
      FRONTEND_PORT="$2"
      shift 2
      ;;
    --no-reload)
      RELOAD=""
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

find_backend_python() {
  local candidate
  for candidate in "$BACKEND_DIR/.venv/bin/python" "$BACKEND_DIR/.venv312/bin/python"; do
    if [[ -x "$candidate" ]] && "$candidate" -c "import fastapi, sqlalchemy, uvicorn" 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v python3 >/dev/null 2>&1 && python3 -c "import fastapi, sqlalchemy, uvicorn" 2>/dev/null; then
    command -v python3
    return 0
  fi

  return 1
}

BACKEND_PYTHON="$(find_backend_python)" || {
  echo "Backend dependencies are missing." >&2
  echo "Run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
}

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies are missing." >&2
  echo "Run: cd frontend && npm install" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to start the frontend." >&2
  exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping todo system..."
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && wait "$BACKEND_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting backend at http://$HOST:$BACKEND_PORT"
echo "Using workspace: $WORKSPACE"
(
  cd "$BACKEND_DIR" || exit 1
  "$BACKEND_PYTHON" -m app \
    --workspace "$WORKSPACE" \
    --host "$HOST" \
    --port "$BACKEND_PORT" \
    $RELOAD
) &
BACKEND_PID=$!

echo "Starting frontend at http://$HOST:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR" || exit 1
  npm run dev -- --host "$HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "Press Ctrl+C to stop both servers."

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

wait "$BACKEND_PID" 2>/dev/null || BACKEND_STATUS=$?
wait "$FRONTEND_PID" 2>/dev/null || FRONTEND_STATUS=$?
exit "${BACKEND_STATUS:-${FRONTEND_STATUS:-0}}"
