// Pre-fill URL + title for the active tab, then send to background on Send.

const $url = document.getElementById("url");
const $note = document.getElementById("note");
const $send = document.getElementById("send");
const $cancel = document.getElementById("cancel");
const $readLater = document.getElementById("readLater");
const $board = document.getElementById("board");
const $status = document.getElementById("status");
const $settings = document.getElementById("settings");

let activeTab = null;
let pendingAction = null;
let sending = false;

function actionId(kind) {
  if (!pendingAction || pendingAction.kind !== kind) {
    pendingAction = { kind, id: crypto.randomUUID() };
  }
  return pendingAction.id;
}

function setBusy(value) {
  sending = value;
  for (const button of [$send, $cancel, $readLater, $board]) button.disabled = value;
}

$note.addEventListener("input", () => { pendingAction = null; });

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  if (activeTab?.url) {
    $url.textContent = activeTab.url;
  }
  $note.focus();
}

function setStatus(text, kind) {
  $status.textContent = text;
  $status.className = "status" + (kind ? " " + kind : "");
}

async function send() {
  if (sending) return;
  if (!activeTab) {
    setStatus("No active tab.", "error");
    return;
  }
  setBusy(true);
  setStatus("Sending…");

  const payload = {
    text: $note.value.trim() || activeTab.title || "read this",
    url: activeTab.url,
    requestId: actionId("capture"),
  };

  try {
    const res = await chrome.runtime.sendMessage({
      type: "ec.capture",
      payload,
    });
    if (res?.ok) {
      pendingAction = null;
      const label =
        res.type === "asset" && res.assetKind ? res.assetKind : res.type || "saved";
      setStatus(`Added · ${label}`, "ok");
      setTimeout(() => window.close(), 700);
    } else {
      setStatus(res?.error || "Failed", "error");
      setBusy(false);
    }
  } catch (e) {
    setStatus(e?.message || "Failed", "error");
    setBusy(false);
  }
}

async function readLater() {
  if (sending) return;
  if (!activeTab) {
    setStatus("No active tab.", "error");
    return;
  }

  setBusy(true);
  setStatus("Saving…");

  try {
    const res = await chrome.runtime.sendMessage({ type: "ec.readLater", requestId: actionId("reader") });
    if (res?.ok) {
      pendingAction = null;
      setStatus(res.message, "ok");
      setTimeout(() => window.close(), 900);
    } else {
      setStatus(res?.error || "Failed", "error");
      setBusy(false);
    }
  } catch (e) {
    setStatus(e?.message || "Failed", "error");
    setBusy(false);
  }
}

async function board() {
  if (sending) return;
  if (!activeTab) {
    setStatus("No active tab.", "error");
    return;
  }
  setBusy(true);
  setStatus("Saving…");
  try {
    const res = await chrome.runtime.sendMessage({
      type: "ec.board",
      note: $note.value,
      requestId: actionId("board"),
    });
    if (res?.ok) {
      pendingAction = null;
      setStatus(res.message || "Saved to Board", "ok");
      setTimeout(() => window.close(), 900);
      return;
    }
    setStatus(res?.error || "Failed", "error");
  } catch (e) {
    setStatus(e?.message || "Failed", "error");
  }
  setBusy(false);
}

$send.addEventListener("click", send);
$board.addEventListener("click", board);
$cancel.addEventListener("click", () => window.close());
$readLater.addEventListener("click", readLater);
$settings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ⌘↵/Ctrl+Enter sends; adding Shift saves for later.
$note.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (e.shiftKey) {
      readLater();
    } else {
      send();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
});

init();
