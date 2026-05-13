// Minimal markdown renderer for Claude responses (headings, bullets, bold).
// Avoids pulling in a full markdown lib for simple short responses.
import { Fragment } from "react";

export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];

  function flushList(key: number) {
    if (listBuf.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="list-disc pl-5 space-y-1 my-2">
        {listBuf.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>
    );
    listBuf = [];
  }

  lines.forEach((line, idx) => {
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (h2) {
      flushList(idx);
      blocks.push(
        <h4 key={`h2-${idx}`} className="font-semibold mt-3 mb-1.5 text-sm">
          {renderInline(h2[1])}
        </h4>
      );
    } else if (h3) {
      flushList(idx);
      blocks.push(
        <h5 key={`h3-${idx}`} className="font-medium mt-2 mb-1 text-sm">
          {renderInline(h3[1])}
        </h5>
      );
    } else if (bullet) {
      listBuf.push(bullet[1]);
    } else if (line.trim() === "") {
      flushList(idx);
    } else {
      flushList(idx);
      blocks.push(
        <p key={`p-${idx}`} className="text-sm leading-relaxed my-1">
          {renderInline(line)}
        </p>
      );
    }
  });
  flushList(lines.length);
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

function renderInline(s: string): React.ReactNode {
  // Bold (**...**) and inline code (`...`).
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(s)) !== null) {
    if (match.index > lastIndex) {
      parts.push(s.slice(lastIndex, match.index));
    }
    const tok = match[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-[var(--color-accent)] text-xs font-mono"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + tok.length;
  }
  if (lastIndex < s.length) parts.push(s.slice(lastIndex));
  return <Fragment>{parts}</Fragment>;
}
