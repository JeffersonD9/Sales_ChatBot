#!/bin/sh
set -eu

platform_db="${PLATFORM_DB_NAME:-platform}"
tenant_db="${TENANT_DB_NAME_DEFAULT:-tenant_shared_low}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
SELECT 'CREATE DATABASE ${platform_db}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${platform_db}')\gexec

SELECT 'CREATE DATABASE ${tenant_db}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${tenant_db}')\gexec
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$platform_db" -f /bootstrap/init.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$tenant_db" -f /bootstrap/tenant-init.sql
