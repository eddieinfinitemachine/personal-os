const $endpoint = document.getElementById("endpoint");
const $token = document.getElementById("token");
const $save = document.getElementById("save");
const $status = document.getElementById("status");

const DEFAULT_ENDPOINT = "https://internal.eddiecohen.com";

async function load() {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  $endpoint.value = endpoint || DEFAULT_ENDPOINT;
  $token.value = token || "";
}

async function save() {
  const endpoint = ($endpoint.value || DEFAULT_ENDPOINT).trim().replace(/\/$/, "");
  const token = $token.value.trim();
  await chrome.storage.local.set({ endpoint, token });
  $status.textContent = "Saved";
  setTimeout(() => ($status.textContent = ""), 1500);
}

$save.addEventListener("click", save);
$endpoint.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});
$token.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});

load();
