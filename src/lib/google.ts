// Gmail read-only access for the booking-import scanner. Mirrors the
// env-token OAuth-refresh pattern in lib/dropbox.ts: a single founder-owned
// refresh token is exchanged for short-lived access tokens, cached in-module
// with a 60s expiry skew. No per-user OAuth — this is founder-only.

import { JSDOM } from "jsdom";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)"
    );
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

export type GmailEmail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  text: string;
};

export async function searchMessageIds(q: string, maxResults: number): Promise<string[]> {
  const token = await getAccessToken();
  const res = await fetch(
    `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail search failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { messages?: { id: string }[] };
  return (json.messages ?? []).map((m) => m.id);
}

export async function fetchEmail(id: string, charCap: number): Promise<GmailEmail | null> {
  // Any failure here (transport error or non-2xx) drops the single message
  // rather than aborting the whole scan — one bad email shouldn't sink a batch.
  try {
    const token = await getAccessToken();
    const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { payload?: GmailPart };
    const payload = json.payload;
    if (!payload) return null;

    const header = (name: string): string => {
      const hit = (payload.headers ?? []).find(
        (h) => h.name.toLowerCase() === name.toLowerCase()
      );
      return hit?.value ?? "";
    };

    let text = extractTextFromPayload(payload);
    if (text.length > charCap) {
      text = text.slice(0, charCap) + "…[truncated]";
    }

    return {
      id,
      subject: header("Subject"),
      from: header("From"),
      date: header("Date"),
      text,
    };
  } catch {
    return null;
  }
}

export function extractTextFromPayload(payload: GmailPart): string {
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: GmailPart): void => {
    // Attachments (named files or attachment-id bodies) are never itinerary text.
    if (part.filename || part.body?.attachmentId) return;

    const data = part.body?.data;
    if (data) {
      const decoded = Buffer.from(data, "base64url").toString("utf8");
      if (part.mimeType === "text/plain") plain.push(decoded);
      else if (part.mimeType === "text/html") html.push(decoded);
    }

    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  if (plain.length) return plain.join("\n");
  if (html.length) return htmlToText(html.join("\n"));
  return "";
}

// Convert a booking-confirmation HTML email to readable text. The td→" | " /
// tr→"\n" pre-pass preserves itinerary table structure before stripping tags.
function htmlToText(html: string): string {
  const pre = html
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n");
  const doc = new JSDOM(pre).window.document;
  doc.querySelectorAll("script, style, head").forEach((n) => n.remove());
  return (doc.body?.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
