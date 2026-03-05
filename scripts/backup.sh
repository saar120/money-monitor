#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${1:-$PROJECT_ROOT/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="$BACKUP_DIR/money-monitor-backup-$TIMESTAMP.tar.gz"

DB_FILE="data/money-monitor.db"
DB_SNAPSHOT="data/money-monitor-backup.db"
FILES=()
cd "$PROJECT_ROOT"

# Create a consistent SQLite snapshot (safe even with WAL mode / active connections)
if [ -f "$DB_FILE" ]; then
  sqlite3 "$DB_FILE" ".backup '$DB_SNAPSHOT'"
  FILES+=("$DB_SNAPSHOT")
else
  echo "Warning: $DB_FILE not found, skipping"
fi

for f in data/credentials.enc .env; do
  if [ -f "$f" ]; then
    FILES+=("$f")
  else
    echo "Warning: $f not found, skipping"
  fi
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No files to back up"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
tar -czf "$ARCHIVE" "${FILES[@]}"
rm -f "$DB_SNAPSHOT"
echo "Backup created: $ARCHIVE (${FILES[*]})"
