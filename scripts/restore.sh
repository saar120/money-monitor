#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -eq 0 ]; then
  # No argument: find the latest backup
  BACKUP_DIR="$PROJECT_ROOT/backups"
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: No backups directory found and no archive specified"
    echo "Usage: $0 [path/to/backup.tar.gz]"
    exit 1
  fi
  ARCHIVE="$(ls -t "$BACKUP_DIR"/money-monitor-backup-*.tar.gz 2>/dev/null | head -1)"
  if [ -z "$ARCHIVE" ]; then
    echo "Error: No backup archives found in $BACKUP_DIR"
    exit 1
  fi
  echo "Using latest backup: $ARCHIVE"
else
  ARCHIVE="$1"
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "Error: Archive not found: $ARCHIVE"
  exit 1
fi

echo "Contents:"
tar -tzf "$ARCHIVE"
echo ""
read -p "Restore these files to $PROJECT_ROOT? This will overwrite existing files. [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  cd "$PROJECT_ROOT"
  mkdir -p data
  tar -xzf "$ARCHIVE"
  # Rename snapshot back to the expected database filename
  if [ -f data/money-monitor-backup.db ]; then
    mv data/money-monitor-backup.db data/money-monitor.db
  fi
  echo "Restored successfully"
else
  echo "Cancelled"
fi
