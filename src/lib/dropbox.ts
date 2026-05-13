const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_API_URL = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_URL = "https://content.dropboxapi.com/2";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

  if (!appKey || !appSecret || !refreshToken) {
    throw new Error(
      "Missing Dropbox credentials (DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN)"
    );
  }

  const res = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function apiHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const rootNs = process.env.DROPBOX_ROOT_NAMESPACE_ID;
  if (rootNs) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "root",
      root: rootNs,
    });
  }
  return headers;
}

export type DropboxEntry = {
  tag: "file" | "folder";
  name: string;
  pathLower: string;
  pathDisplay: string;
  serverModified?: string;
  size?: number;
};

type ListBody =
  | { path: string; recursive: boolean }
  | { path: ""; shared_link: { url: string }; recursive: boolean };

async function listOnce(body: ListBody): Promise<{ entries: DropboxEntry[]; cursor: string; has_more: boolean }> {
  const headers = await apiHeaders();
  const res = await fetch(`${DROPBOX_API_URL}/files/list_folder`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`list_folder failed (${res.status}): ${text}`);
  }
  return parseEntries(await res.json());
}

async function listContinue(cursor: string): Promise<{ entries: DropboxEntry[]; cursor: string; has_more: boolean }> {
  const headers = await apiHeaders();
  const res = await fetch(`${DROPBOX_API_URL}/files/list_folder/continue`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ cursor }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`list_folder/continue failed (${res.status}): ${text}`);
  }
  return parseEntries(await res.json());
}

type RawEntry = {
  ".tag": "file" | "folder";
  name: string;
  path_lower?: string;
  path_display?: string;
  server_modified?: string;
  size?: number;
};

function parseEntries(data: { entries: RawEntry[]; cursor: string; has_more: boolean }): {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
} {
  const entries: DropboxEntry[] = data.entries
    .filter((e) => e[".tag"] === "file" || e[".tag"] === "folder")
    .map((e) => ({
      tag: e[".tag"],
      name: e.name,
      pathLower: e.path_lower ?? "",
      pathDisplay: e.path_display ?? "",
      serverModified: e.server_modified,
      size: e.size,
    }));
  return { entries, cursor: data.cursor, has_more: data.has_more };
}

export async function listFolderByPath(path: string, recursive = false): Promise<DropboxEntry[]> {
  let { entries, cursor, has_more } = await listOnce({ path, recursive });
  while (has_more) {
    const next = await listContinue(cursor);
    entries = entries.concat(next.entries);
    cursor = next.cursor;
    has_more = next.has_more;
  }
  return entries;
}

export async function listSharedFolder(url: string, recursive = false): Promise<DropboxEntry[]> {
  let { entries, cursor, has_more } = await listOnce({
    path: "",
    shared_link: { url },
    recursive,
  });
  while (has_more) {
    const next = await listContinue(cursor);
    entries = entries.concat(next.entries);
    cursor = next.cursor;
    has_more = next.has_more;
  }
  return entries;
}

export async function getTemporaryLink(dropboxPath: string): Promise<string> {
  const headers = await apiHeaders();
  const res = await fetch(`${DROPBOX_API_URL}/files/get_temporary_link`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ path: dropboxPath }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`get_temporary_link failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { link: string };
  return data.link;
}

export async function getThumbnail(
  resource: { tag: "path"; path: string } | { tag: "link"; url: string },
  size = "w256h256"
): Promise<{ buffer: Buffer; contentType: string }> {
  const headers = await apiHeaders();
  const arg =
    resource.tag === "path"
      ? { resource: { ".tag": "path", path: resource.path }, format: "jpeg", size }
      : { resource: { ".tag": "link", url: resource.url }, format: "jpeg", size };
  const res = await fetch(`${DROPBOX_CONTENT_URL}/files/get_thumbnail_v2`, {
    method: "POST",
    headers: {
      ...headers,
      "Dropbox-API-Arg": JSON.stringify(arg),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`get_thumbnail failed (${res.status}): ${text}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: "image/jpeg" };
}

const FOLDER_URL_RE = /https?:\/\/(www\.)?dropbox\.com\/(scl\/fo|sh)\//i;

export function isDropboxFolderUrl(url: string): boolean {
  return FOLDER_URL_RE.test(url.trim());
}

const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "tiff", "svg",
]);

export function isImageName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTS.has(ext) : false;
}
