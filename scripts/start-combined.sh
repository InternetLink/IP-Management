#!/bin/sh
set -eu

backend_port="${BACKEND_PORT:-3001}"
frontend_port="${PORT:-3003}"
ready_attempts="${BACKEND_READY_ATTEMPTS:-60}"
ready_interval="${BACKEND_READY_INTERVAL_SECONDS:-1}"
backend_pid=""
frontend_pid=""

case "$ready_attempts" in
  ''|*[!0-9]*|0) echo "BACKEND_READY_ATTEMPTS must be a positive integer" >&2; exit 1 ;;
esac
case "$ready_interval" in
  ''|*[!0-9]*) echo "BACKEND_READY_INTERVAL_SECONDS must be a non-negative integer" >&2; exit 1 ;;
esac

stop_children() {
  trap - INT TERM EXIT
  if [ -n "$frontend_pid" ] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi
  [ -z "$frontend_pid" ] || wait "$frontend_pid" 2>/dev/null || true
  [ -z "$backend_pid" ] || wait "$backend_pid" 2>/dev/null || true
}

trap 'stop_children; exit 143' TERM
trap 'stop_children; exit 130' INT
trap stop_children EXIT

cd /app/backend
PORT="$backend_port" sh scripts/start-prod.sh &
backend_pid=$!

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:${backend_port}/api/health/ready" >/dev/null; do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    wait "$backend_pid" || backend_status=$?
    echo "Backend exited before readiness (status ${backend_status:-0})" >&2
    exit "${backend_status:-1}"
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$ready_attempts" ]; then
    echo "Backend readiness timed out" >&2
    exit 1
  fi
  sleep "$ready_interval"
done

cd /app/frontend
PORT="$frontend_port" node server.js &
frontend_pid=$!

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$backend_pid" 2>/dev/null; then
  wait "$backend_pid" || exit_status=$?
  echo "Backend process exited (status ${exit_status:-0})" >&2
else
  wait "$frontend_pid" || exit_status=$?
  echo "Frontend process exited (status ${exit_status:-0})" >&2
fi

exit "${exit_status:-0}"
