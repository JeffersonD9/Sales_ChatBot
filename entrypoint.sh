#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
npm run migrate
echo "[entrypoint] Migrations done. Starting app..."

exec "$@"
