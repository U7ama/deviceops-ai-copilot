#!/usr/bin/env bash
set -euo pipefail

BACKUP="${1:?Usage: scripts/restore.sh BACKUP_FILE [TARGET_DB]}"
TARGET_DB="${2:-deviceops_restore}"

test -f "$BACKUP"
case "$TARGET_DB" in
  deviceops|postgres|template0|template1) echo "Refusing to restore over protected database: $TARGET_DB" >&2; exit 1 ;;
esac

docker compose exec -T postgres dropdb \
  -U "${POSTGRES_USER:-postgres}" \
  --if-exists "$TARGET_DB"
docker compose exec -T postgres createdb \
  -U "${POSTGRES_USER:-postgres}" \
  "$TARGET_DB"
cat "$BACKUP" | docker compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-postgres}" \
  -d "$TARGET_DB" \
  --no-owner \
  --exit-on-error

printf 'Restore completed into disposable database: %s\n' "$TARGET_DB"
