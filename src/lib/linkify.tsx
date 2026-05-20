import React from "react";

// Detect URLs in a string and return a React fragment with the URLs rendered
// as <a target="_blank"> while the surrounding text is passed through.
// Used in todo titles and capture-text rendering to make pasted links
// clickable, Things-style.
//
// Matches http(s):// and www. prefixes. Tolerates trailing punctuation by
// stripping ., ,, ;, ), ], !, ? from the end of the match.

const URL_REGEX = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/;

export function linkify(
  text: string | null | undefined,
  onLinkClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void,
): React.ReactNode[] {
  if (!text) return [];
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Reset .lastIndex for the global regex on each call.
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    let url = match[0];
    let trailing = "";
    const m = url.match(TRAILING_PUNCT_RE);
    if (m) {
      trailing = m[0];
      url = url.slice(0, url.length - trailing.length);
    }
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    out.push(
      <a
        key={`l-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onLinkClick}
        className="text-[var(--color-tint)] underline decoration-[var(--color-tint)]/30 underline-offset-2 hover:decoration-[var(--color-tint)]"
      >
        {url}
      </a>,
    );
    if (trailing) out.push(trailing);
    lastIndex = match.index + url.length + trailing.length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out.length ? out : [text];
}
