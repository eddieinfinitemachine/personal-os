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

async function saveReadLater({ tab, linkUrl }) {
  const { endpoint, token } = await getSettings();
  if (!token) {
    notify(
      "Kaizen Capture — token missing",
      "Open the extension settings and paste your CAPTURE_TOKEN.",
    );
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "no-token" };
  }

  const url = linkUrl || tab?.url;
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    // handled below
  }
  if (parsedUrl?.protocol !== "http:" && parsedUrl?.protocol !== "https:") {
    notify("Can't save this page", "Only web pages can be saved.");
    return { ok: false, error: "Only web pages can be saved." };
  }

  const body = { url };
  if (!linkUrl && tab?.id) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const clone = document.documentElement.cloneNode(true);
          clone
            .querySelectorAll(
              "script, style, noscript, svg, iframe, template, canvas, video, audio, object, embed, link[rel='stylesheet'], link[rel='preload']",
            )
            .forEach((element) => element.remove());
          return {
            html: "<!doctype html>" + clone.outerHTML,
            title: document.title,
          };
        },
      });
      if (result?.html?.length <= 4000000) {
        body.html = result.html;
        body.title = result.title;
      }
    } catch {
      // Some pages cannot be scripted; save the URL on its own instead.
    }
  }

  notify("Saving to Read Later...", url);
  try {
    const response = await fetch(`${endpoint}/api/reader`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.ok === true) {
      notify("Saved to Read Later", json.message || json.title || url);
      return json;
    }

    const error = json.error || "HTTP " + response.status;
    notify("Read Later save failed", error);
    return { ok: false, error };
  } catch (error) {
    const message = error?.message || "network error";
    notify("Read Later save failed", message);
    return { ok: false, error: message };
  }
}

// Mood board: pages, links, and images. Images are sent by URL; the server
// fetches and re-hosts them.
async function saveToBoard({ url, imageUrl, note }) {
  const { endpoint, token } = await getSettings();
  if (!token) {
    notify(
      "Kaizen Capture — token missing",
      "Open the extension settings and paste your CAPTURE_TOKEN.",
    );
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "no-token" };
  }
  const body = { via: "extension" };
  if (url && /^https?:/i.test(url)) body.url = url;
  if (imageUrl && /^https?:/i.test(imageUrl)) body.imageUrl = imageUrl;
  if (note && note.trim()) body.note = note.trim();
  if (!body.url && !body.imageUrl) {
    notify("Can't save this", "Only web pages and images can be saved.");
    return { ok: false, error: "Only web pages and images can be saved." };
  }

  notify("Saving to Board...", body.imageUrl || body.url);
  try {
    const response = await fetch(`${endpoint}/api/board`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.ok === true) {
      notify("Saved to Board", json.message || url);
      return json;
    }
    const error = json.error || "HTTP " + response.status;
    notify("Board save failed", error);
    return { ok: false, error };
  } catch (error) {
    const message = error?.message || "network error";
    notify("Board save failed", message);
    return { ok: false, error: message };
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
  if (command === "save-to-board") {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab) return;
    await saveToBoard({ url: activeTab.url });
    return;
  }
  if (command === "save-read-later") {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab) return;
    await saveReadLater({ tab: activeTab });
    return;
  }
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
  chrome.contextMenus.create({
    id: "kaizen-read-later-page",
    title: "Save page to Read Later",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "kaizen-read-later-link",
    title: "Save link to Read Later",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "kaizen-board-image",
    title: "Save image to Board",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "kaizen-board-page",
    title: "Save to Board",
    contexts: ["page", "link", "video", "audio"],
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
  } else if (info.menuItemId === "kaizen-read-later-page") {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab) return;
    await saveReadLater({ tab: activeTab });
  } else if (info.menuItemId === "kaizen-read-later-link") {
    await saveReadLater({ tab, linkUrl: info.linkUrl });
  } else if (info.menuItemId === "kaizen-board-image") {
    await saveToBoard({
      imageUrl: info.srcUrl,
      url: info.linkUrl || info.pageUrl || tab.url,
    });
  } else if (info.menuItemId === "kaizen-board-page") {
    await saveToBoard({ url: info.linkUrl || info.pageUrl || tab.url });
  }
});

// Popup messages it to send.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "kaizen.readLater") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) =>
        activeTab
          ? saveReadLater({ tab: activeTab })
          : { ok: false, error: "no-active-tab" },
      )
      .then(sendResponse);
    return true; // keep channel open for async sendResponse
  }
  if (msg?.type === "kaizen.board") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) =>
        activeTab
          ? saveToBoard({ url: activeTab.url, note: msg.note })
          : { ok: false, error: "no-active-tab" },
      )
      .then(sendResponse);
    return true;
  }
  if (msg?.type !== "kaizen.capture") return;
  sendCapture(msg.payload).then(sendResponse);
  return true; // keep channel open for async sendResponse
});
