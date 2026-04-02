#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Money Monitor — macOS Installer
#
# Double-click this file to install Money Monitor.
# It strips the macOS quarantine flag and moves the app to /Applications.
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Money Monitor.app"
APP_SRC="$SCRIPT_DIR/$APP_NAME"
APP_DEST="/Applications/$APP_NAME"

if [ ! -d "$APP_SRC" ]; then
  echo "Error: Could not find '$APP_NAME' next to this installer."
  echo "Make sure this script is in the same folder as the app."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "Installing Money Monitor..."

# Remove quarantine attribute (prevents Gatekeeper "unidentified developer" prompt)
xattr -cr "$APP_SRC"

# Move to /Applications (replace existing if present)
if [ -d "$APP_DEST" ]; then
  echo "Replacing existing installation..."
  rm -rf "$APP_DEST"
fi
cp -R "$APP_SRC" "$APP_DEST"

# Strip quarantine on installed copy too
xattr -cr "$APP_DEST"

echo ""
echo "Money Monitor has been installed to /Applications."
echo "Opening Money Monitor..."

open "$APP_DEST"
