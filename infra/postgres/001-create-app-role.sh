#!/usr/bin/env bash
set -euo pipefail

: "${DEVICEOPS_APP_DB_PASSWORD:?DEVICEOPS_APP_DB_PASSWORD is required}"

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$DEVICEOPS_APP_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE deviceops_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deviceops_app')
\gexec

SELECT format(
  'ALTER ROLE deviceops_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_password'
)
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deviceops_app')
\gexec
SQL
