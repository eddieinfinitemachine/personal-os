#!/bin/bash
# Generate the Xcode project from project.yml and open it.
#
#   DEVELOPMENT_TEAM=ABCDE12345 ./build.sh
#
# Find your team id in Xcode > Settings > Accounts, or on
# developer.apple.com/account under Membership details. Without it, set the
# team in Xcode's Signing & Capabilities tab after the project opens.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
    echo "xcodegen not found. Install with: brew install xcodegen" >&2
    exit 1
fi

export DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
if [ -z "$DEVELOPMENT_TEAM" ]; then
    echo "⚠ DEVELOPMENT_TEAM not set; pick a team in Xcode before running on a device."
fi

echo "→ Generating StepCounter.xcodeproj..."
xcodegen generate

if [ "${1:-}" = "--no-open" ]; then
    exit 0
fi
echo "→ Opening in Xcode..."
open StepCounter.xcodeproj
