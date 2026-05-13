#!/bin/bash
# Build Quick Todo.app and install to /Applications.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Quick Todo"
APP_DIR="/Applications/${APP_NAME}.app"
EXEC_NAME="QuickTodo"

echo "→ Compiling..."
xcrun -sdk macosx swiftc \
    -O \
    -target arm64-apple-macos12.0 \
    -framework AppKit \
    -framework Carbon \
    -framework UserNotifications \
    -o "${EXEC_NAME}" \
    main.swift

echo "→ Building bundle at ${APP_DIR}..."
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"
cp Info.plist "${APP_DIR}/Contents/Info.plist"
mv "${EXEC_NAME}" "${APP_DIR}/Contents/MacOS/${EXEC_NAME}"
chmod +x "${APP_DIR}/Contents/MacOS/${EXEC_NAME}"

# Bundle the iridescent icon if present
if [ -f AppIcon.icns ]; then
    cp AppIcon.icns "${APP_DIR}/Contents/Resources/AppIcon.icns"
fi

echo "→ Ad-hoc signing (so Gatekeeper allows it)..."
codesign --force --deep --sign - "${APP_DIR}" 2>&1 | tail -5 || true

echo "✓ Installed: ${APP_DIR}"
