import React from "react";

// Trailing punctuation stripped from matches so "foo.com." doesn't include
// the sentence period in the link.
const URL_REGEX = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/;

function stripTrailing(raw: string): { url: string; trailing: string } {
  const m = raw.match(TRAILING_PUNCT_RE);
  if (!m) return { url: raw, trailing: "" };
  return { url: raw.slice(0, raw.length - m[0].length), trailing: m[0] };
}

function toHref(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`;
}

// Every URL in `text`, normalised to an absolute href (www. → https://www.),
// in order of appearance, de-duplicated.
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const match of text.matchAll(URL_REGEX)) {
    const { url } = stripTrailing(match[0]);
    if (!url) continue;
    const href = toHref(url);
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

export function linkify(
  text: string | null | undefined,
  onLinkClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void,
): React.ReactNode[] {
  if (!text) return [];
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const { url, trailing } = stripTrailing(match[0]);
    const start = match.index ?? 0;
    if (start > lastIndex) out.push(text.slice(lastIndex, start));
    out.push(
      <a
        key={`l-${key++}`}
        href={toHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onLinkClick}
        // Links sit inside draggable todo rows; a drag starting on a link
        // should select text, not drag the URL or the row.
        draggable={false}
        className="text-[var(--color-tint)] underline decoration-[var(--color-tint)]/30 underline-offset-2 hover:decoration-[var(--color-tint)]"
      >
        {url}
      </a>,
    );
    if (trailing) out.push(trailing);
    lastIndex = start + url.length + trailing.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length ? out : [text];
}
