# EC Capture (Chrome extension)

Send the current tab to your EC smart-capture inbox. Auto-classifies as
bookmark / todo / person / place / etc. via the `/api/capture/smart/auto`
endpoint.

## Install (dev / unpacked)

1. Open `chrome://extensions/` in Chrome (or any Chromium browser — Arc,
   Brave, Edge).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and point at this folder (`chrome-extension/`).
4. Click the puzzle-piece icon in the toolbar → pin **EC Capture** so
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
- **Right-click selected text** → *"Send to EC"* sends the selection
  + the current URL.
- **Right-click a page** (or link) → *"Send this page to EC"* sends
  the URL + page title.

Claude classifies the capture, so the same text-rules from the Mac app and
⌘K palette apply: an article URL → Asset(media, to-read) + a "Read: …"
todo on the Later list. A name + role → Person. A todo-like sentence → a
Todo on To Do. Etc.

## Read Later

The **Save to Read Later** command saves the current page with
`Ctrl+Shift+U` (`Cmd+Shift+U` on Mac).

You can save content in any of these ways:

- Press `Ctrl+Shift+U` (`Cmd+Shift+U` on Mac) to save the current page.
- Right-click a page → **Save page to Read Later**.
- Right-click a link → **Save link to Read Later**.
- Click **Read later** in the popup, or press `Ctrl+Shift+Enter` while the
  popup textarea is focused.

Page captures include the page's rendered HTML, with scripts, styles, and
iframes removed for privacy and size. If the resulting HTML is larger than
4 MB, or Chrome does not allow the page to be scripted (for example, Chrome
Web Store pages or PDFs), the extension sends only the URL. Link captures
always send only the URL.

The server runs Readability on captured HTML. Kindle delivery is optional
and depends on the server's Read Later settings.

Customize keyboard shortcuts at `chrome://extensions/shortcuts`. After
updating the extension, reload it at `chrome://extensions/`.

## Board

Save anything you like to the mood board at `/board`:

- Right-click an image → **Save image to Board** (the server re-hosts it).
- Right-click a page, link, video, or audio → **Save to Board**.
- **⌘⇧Y** / **Ctrl+Shift+Y** saves the current tab.
- The popup's **Board** button saves the tab with your note.

Posts to `/api/board` with the same capture token.

## How it works

- `manifest.json` declares the action, background service worker, options
  page, three keyboard commands, context menus, and the `scripting`
  permission used for HTML capture.
- `background.js` reads the saved endpoint + token from
  `chrome.storage.local`, POSTs to `/api/capture/smart/auto`, and shows
  a system notification ("Capturing…" → "Added · `<type>`") via
  `chrome.notifications`.
- `background.js` also provides `saveReadLater()`, which captures sanitized
  rendered HTML when possible and POSTs the page or link to `/api/reader`.
- The context menu includes **Save page to Read Later** and
  **Save link to Read Later** entries.
- `popup.{html,js}` is the optional UI for adding a note before sending or
  saving the current page to Read Later.
- `options.{html,js}` stores the endpoint + token.

Permissions used:
- `activeTab` — read the URL + title of the tab the user explicitly invoked
  the extension on.
- `storage` — save settings.
- `contextMenus` — right-click capture and Read Later entries.
- `notifications` — toast on success / failure.
- `scripting` — capture and sanitize rendered page HTML for Read Later.

Host permissions are scoped to your three EC URLs only — the
extension doesn't request access to other sites.
