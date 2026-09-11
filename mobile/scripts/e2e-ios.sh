#!/usr/bin/env bash
set -euo pipefail

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro is required. Install it with: brew install mobile-dev-inc/tap/maestro" >&2
  exit 1
fi

npx expo prebuild --platform ios
npx expo run:ios --configuration Release --no-bundler
for flow in e2e/flows/*.yaml; do
  maestro test "$flow"
done
