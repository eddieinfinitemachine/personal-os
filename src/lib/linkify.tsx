import React from "react";

// Trailing punctuation stripped from matches so "foo.com." doesn't include
// the sentence period in the link.
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

  for (const match of text.matchAll(URL_REGEX)) {
    let url = match[0];
    let trailing = "";
    const m = url.match(TRAILING_PUNCT_RE);
    if (m) {
      trailing = m[0];
      url = url.slice(0, url.length - trailing.length);
    }
    const start = match.index ?? 0;
    if (start > lastIndex) out.push(text.slice(lastIndex, start));
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
    lastIndex = start + url.length + trailing.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length ? out : [text];
}
