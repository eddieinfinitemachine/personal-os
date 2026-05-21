# Kaizen Capture (Chrome extension)

Send the current tab to your Kaizen smart-capture inbox. Auto-classifies as
bookmark / todo / person / place / etc. via the `/api/capture/smart/auto`
endpoint.

## Install (dev / unpacked)

1. Open `chrome://extensions/` in Chrome (or any Chromium browser — Arc,
   Brave, Edge).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and point at this folder (`chrome-extension/`).
4. Click the puzzle-piece icon in the toolbar → pin **Kaizen Capture** so
   it lives in the toolbar permanently.
5. Right-click the toolbar icon → **Options**. Enter:
   - **Endpoint**: `https://internal.eddiecohen.com` (default)
   - **Capture token**: the same `CAPTURE_TOKEN` your Mac Quick Todo app uses.
     Find it via `vercel env pull --environment production` or in the
     Vercel dashboard.
   - Click **Save**.

## Use

- **Click the toolbar icon** → popup with the current URL pre-filled. Type
  an optional note ("read this", "want to try"), hit **Send** or `⌘↵`.
- **Keyboard ⌘⇧J** (Ctrl+Shift+J on Linux/Win) → quick-send the current
  tab without showing the popup. Fastest way to bookmark an article.
- **Keyboard ⌘⇧L** (Ctrl+Shift+K) → open the popup. Use when you want to
  add a note before sending.
- **Right-click selected text** → *"Send to Kaizen"* sends the selection
  + the current URL.
- **Right-click a page** (or link) → *"Send this page to Kaizen"* sends
  the URL + page title.

Claude classifies the capture, so the same text-rules from the Mac app and
⌘K palette apply: an article URL → Asset(media, to-read) + a "Read: …"
todo on the Later list. A name + role → Person. A todo-like sentence → a
Todo on To Do. Etc.

## How it works

- `manifest.json` declares the action, background service worker, options
  page, and two keyboard commands.
- `background.js` reads the saved endpoint + token from
  `chrome.storage.local`, POSTs to `/api/capture/smart/auto`, and shows
  a system notification ("Capturing…" → "Added · `<type>`") via
  `chrome.notifications`.
- `popup.{html,js}` is the optional UI for adding a note before sending.
- `options.{html,js}` stores the endpoint + token.

Permissions used:
- `activeTab` — read the URL + title of the tab the user explicitly invoked
  the extension on.
- `storage` — save settings.
- `contextMenus` — right-click "Send to Kaizen".
- `notifications` — toast on success / failure.
- `scripting` — declared but unused today (reserved for content scripts).

Host permissions are scoped to your three Kaizen URLs only — the
extension doesn't request access to other sites.
