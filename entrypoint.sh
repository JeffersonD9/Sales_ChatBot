#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
if npm run migrate; then
  echo "[entrypoint] Migrations applied."
else
  echo "[entrypoint] Warning: drizzle-kit migrate exited with error (tables may already exist — baseline pending). App will start."
fi
echo "[entrypoint] Starting app..."

exec "$@"
