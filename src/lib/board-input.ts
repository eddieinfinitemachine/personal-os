import { sniffImage } from "@/lib/board-sniff";

// Shortcuts, the Chrome extension, the PWA share target and the in-app paste
// box all post to the board in different shapes. Normalize every one of them
// into { image?, imageSrc?, url?, text?, note?, via }.

export type BoardInput = {
  /** Raw image bytes (uploaded file or raw image body). */
  image?: Buffer;
  /** Remote image to re-host (extension "Save image"). */
  imageSrc?: string;
  url?: string;
  /** Shared text that wasn't a URL, e.g. a caption or a quote. */
  text?: string;
  /** Your own words, from an explicit `note` field. */
  note?: string;
  title?: string;
  via: string;
};

const VIAS = new Set(["app", "shortcut", "extension", "share", "rec"]);
const URL_RE = /https?:\/\/[^\s<>"']+/i;

function decodeMaybe(s: string): string {
  try {
    return /^https?%3A/i.test(s) ? decodeURIComponent(s) : s;
  } catch {
    return s;
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Pull the first URL out of a pile of text; whatever else is left is text.
export function splitUrlAndText(pile: string[]): { url?: string; text?: string } {
  const joined = pile
    .map((s) => decodeMaybe(s.trim()))
    .filter(Boolean)
    // Drop exact duplicates (share targets often send the URL as both url and text).
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .join("\n");
  const match = joined.match(URL_RE);
  const url = match ? match[0].replace(/[).,;!?\]]+$/, "") : undefined;
  let text = joined;
  if (url) text = text.split(match![0]).join(" ");
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { url, text: text || undefined };
}

// Apps wrap a shared link in stock copy ("Check out this item on Amazon",
// "Listen to X on Spotify", "Shared via TikTok"). Keep a real caption as the
// note; drop the boilerplate, and anything that only repeats the title.
const SHARE_BOILERPLATE = [
  /\bcheck (?:it|this) out\b[:!.]?/gi,
  /\bcheck out (?:this|my|these)\b[^\n:!.]{0,60}?\b(?:on|at|from)\s+[\w.' ]{2,30}?(?=[:!.\n]|$)[:!.]?/gi,
  /\b(?:listen to|watch|shop|buy|see)\b[^\n]{0,120}?\bon (?:spotify|youtube|apple music|amazon|etsy|tiktok|instagram|soundcloud|pinterest|x|twitter)\b[:!.]?/gi,
  /\b(?:shared|sent) (?:via|from|with) [\w.' ]{2,30}/gi,
  /\bi (?:found|saw) this on [\w.' ]{2,30}[:!.]?/gi,
];

export function shareCaption(text: string | undefined, title: string | null): string | undefined {
  if (!text) return undefined;
  let rest = text;
  for (const re of SHARE_BOILERPLATE) rest = rest.replace(re, " ");
  if (title) {
    const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) rest = rest.replace(new RegExp(escaped, "gi"), " ");
  }
  rest = rest.replace(/^[\s:|\-–—"'“”.,!]+|[\s:|\-–—"'“”,]+$/g, "").replace(/[ \t]+/g, " ").trim();
  return (rest.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3 ? rest : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export async function parseBoardInput(request: Request, maxImageBytes: number): Promise<BoardInput> {
  const params = new URL(request.url).searchParams;
  const pile: string[] = [];
  const out: BoardInput = { via: "app" };
  const take = (key: string, v: unknown) => {
    const s = str(v);
    if (!s) return;
    if (key === "note") out.note = s;
    else if (key === "title") out.title = s;
    else if (key === "via") out.via = VIAS.has(s) ? s : out.via;
    else if (key === "imageUrl" || key === "srcUrl" || key === "image") {
      if (isHttpUrl(s)) out.imageSrc = s;
    } else pile.push(s);
  };

  for (const [k, v] of params) if (k !== "token") take(k, v);

  if (request.method === "POST") {
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      for (const [k, v] of form) {
        if (typeof v === "string") take(k, v);
        else if (v.size > 0) {
          if (v.size > maxImageBytes) throw new InputError("Image too large.", 413);
          const buf = Buffer.from(await v.arrayBuffer());
          if (v.type.startsWith("image/") || sniffImage(buf)) out.image ??= buf;
          // Shortcuts sometimes wraps a shared URL or text as a small file.
          else if (buf.length < 256 * 1024) pile.push(buf.toString("utf8"));
        }
      }
    } else {
      // Raw body: an image (whatever the Content-Type says), JSON, a form, or text.
      const buf = Buffer.from(await request.arrayBuffer());
      if (type.startsWith("image/") || sniffImage(buf)) {
        if (buf.length > maxImageBytes) throw new InputError("Image too large.", 413);
        if (buf.length) out.image = buf;
      }
      const text = out.image ? "" : buf.toString("utf8");
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON; treat as plain text below.
      }
      // Real form posts; a JSON body mislabelled as a form (curl's default,
      // some Shortcut setups) was already caught by the JSON.parse above.
      const isForm = type.startsWith("application/x-www-form-urlencoded") && parsed === undefined;
      if (isForm) {
        for (const [k, v] of new URLSearchParams(text)) take(k, v);
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(v)) v.forEach((x) => take(k, x));
          else take(k, v);
        }
      } else if (Array.isArray(parsed)) {
        parsed.forEach((x) => take("text", x));
      } else if (typeof parsed === "string") {
        take("text", parsed);
      } else if (text.trim()) {
        take("text", text);
      }
    }
  }

  const { url, text } = splitUrlAndText(pile);
  if (url) out.url = url;
  if (text) out.text = text;
  return out;
}

export class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
