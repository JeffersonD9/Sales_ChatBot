#!/bin/sh
set -e

echo "[entrypoint] Starting app without running database migrations..."
exec "$@"
