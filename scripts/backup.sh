#!/usr/bin/env bash
set -euo pipefail

# Create a PostgreSQL custom-format backup without requiring psql/pg_dump on the host.
OUT_DIR="${1:-.data/backups}"
mkdir -p "$OUT_DIR"
BACKUP="$OUT_DIR/deviceops-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-deviceops}" \
  --format=custom \
  --no-owner \
  > "$BACKUP"

chmod 600 "$BACKUP"
printf 'Backup created: %s\n' "$BACKUP"
