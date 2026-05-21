// Kaizen Capture — background service worker.
//
// Two entry points:
//   1. Quick-capture command (⌘⇧J / Ctrl+Shift+J): send the current tab's
//      URL + title to /api/capture/smart/auto without showing the popup.
//   2. Context menu on selected text: send the selection + current URL.
//
// The toolbar button itself opens popup.html (a small note + send UI).

const DEFAULT_ENDPOINT = "https://internal.eddiecohen.com";
const STORAGE_KEYS = ["endpoint", "token"];

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    endpoint: (data.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, ""),
    token: data.token || "",
  };
}

async function sendCapture({ text, url, defaultText }) {
  const { endpoint, token } = await getSettings();
  if (!token) {
    notify(
      "Kaizen Capture — token missing",
      "Open the extension settings and paste your CAPTURE_TOKEN.",
    );
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "no-token" };
  }
  const body = {
    text: (text && text.trim()) || defaultText || "read this",
  };
  if (url) body.url = url;

  notify("Capturing…", body.text);

  try {
    const res = await fetch(`${endpoint}/api/capture/smart/auto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      notify(
        "Capture failed",
        json.error || `HTTP ${res.status}`,
      );
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    const typeLabel =
      json.type === "asset" && json.assetKind ? json.assetKind : json.type || "saved";
    notify(`Added · ${typeLabel}`, body.text);
    return { ok: true, ...json };
  } catch (e) {
    notify("Capture failed", e?.message || "network error");
    return { ok: false, error: e?.message || "network error" };
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message: message?.slice(0, 200) || "",
  });
}

// Quick-capture: send the active tab's URL + title with no popup.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "quick-capture") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await sendCapture({
    text: tab.title || "read this",
    url: tab.url,
  });
});

// Right-click → "Send selection to Kaizen" on highlighted text.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "kaizen-send-selection",
    title: "Send to Kaizen: \"%s\"",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "kaizen-send-page",
    title: "Send this page to Kaizen",
    contexts: ["page", "link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "kaizen-send-selection") {
    await sendCapture({
      text: info.selectionText || tab.title || "read this",
      url: tab.url,
    });
  } else if (info.menuItemId === "kaizen-send-page") {
    await sendCapture({
      text: tab.title || "read this",
      url: tab.url,
    });
  }
});

// Popup messages it to send.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "kaizen.capture") return;
  sendCapture(msg.payload).then(sendResponse);
  return true; // keep channel open for async sendResponse
});
