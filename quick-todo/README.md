# Quick Todo

Tiny native macOS menu-bar app that fires the `/api/capture/todo` endpoint.

A standalone Swift binary (single file, no dependencies beyond AppKit / Carbon / UserNotifications) that:

- Registers a global hotkey (default: **⌃Space**) via the Carbon HotKey API — immune to userland conflicts that break Apple Shortcuts.
- Pops a centered HUD-style text input.
- Posts the typed title to `https://personal-os-two-gold.vercel.app/api/capture/todo` with the bearer `CAPTURE_TOKEN`.
- Shows a system notification on success / failure.
- Sits in the menu bar with a tray icon; right-click to open the web app or quit.

## Build & install

```bash
./build.sh
```

This compiles `main.swift` with `xcrun swiftc`, bundles the binary + `Info.plist` + `AppIcon.icns` into `/Applications/Quick Todo.app`, and ad-hoc signs it so Gatekeeper allows it.

## Run at login

A LaunchAgent plist at `~/Library/LaunchAgents/com.eddie.quicktodo.plist` keeps the menu-bar agent running. Reload after a rebuild:

```bash
launchctl unload ~/Library/LaunchAgents/com.eddie.quicktodo.plist
launchctl load -w ~/Library/LaunchAgents/com.eddie.quicktodo.plist
```

## Configuration

API URL and bearer token are hardcoded constants at the top of `main.swift`. Single-user local app — keep both in source.

To change the hotkey, edit `HotKeyManager.register()` in `main.swift` and rebuild.
