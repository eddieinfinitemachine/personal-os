// Pre-fill URL + title for the active tab, then send to background on Send.

const $url = document.getElementById("url");
const $note = document.getElementById("note");
const $send = document.getElementById("send");
const $cancel = document.getElementById("cancel");
const $status = document.getElementById("status");
const $settings = document.getElementById("settings");

let activeTab = null;

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
  if (!activeTab) {
    setStatus("No active tab.", "error");
    return;
  }
  $send.disabled = true;
  $cancel.disabled = true;
  setStatus("Sending…");

  const payload = {
    text: $note.value.trim() || activeTab.title || "read this",
    url: activeTab.url,
  };

  try {
    const res = await chrome.runtime.sendMessage({
      type: "kaizen.capture",
      payload,
    });
    if (res?.ok) {
      const label =
        res.type === "asset" && res.assetKind ? res.assetKind : res.type || "saved";
      setStatus(`Added · ${label}`, "ok");
      setTimeout(() => window.close(), 700);
    } else {
      setStatus(res?.error || "Failed", "error");
      $send.disabled = false;
      $cancel.disabled = false;
    }
  } catch (e) {
    setStatus(e?.message || "Failed", "error");
    $send.disabled = false;
    $cancel.disabled = false;
  }
}

$send.addEventListener("click", send);
$cancel.addEventListener("click", () => window.close());
$settings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ⌘↵ in the textarea sends.
$note.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
});

init();
