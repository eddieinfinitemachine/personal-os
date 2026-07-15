"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ExternalLink,
  Highlighter,
  Trash2,
  X,
} from "lucide-react";
import { haptic } from "@/lib/haptic";

// Reader view with persistent highlights. Select text → a floating pill saves
// it; saved highlights are re-applied on load by walking the article's text
// nodes (cross-paragraph selections fall back to appearing only in the
// highlight list below the article).

type Item = {
  id: string;
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  contentHtml: string;
  wordCount: number;
  readAt: string | null;
  archivedAt: string | null;
  savedAt: string;
};
type HL = { id: string; text: string; note: string | null };

export function ArticleReader({
  item,
  initialHighlights,
}: {
  item: Item;
  initialHighlights: HL[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<HL[]>(initialHighlights);
  const [pill, setPill] = useState<{ x: number; y: number; text: string } | null>(null);
  const [archived, setArchived] = useState(!!item.archivedAt);
  const [confirming, setConfirming] = useState(false);

  // Opening the article marks it read (once).
  useEffect(() => {
    if (item.readAt) return;
    fetch(`/api/reader/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Highlight application ─────────────────────────────────────────────
  const applyHighlights = useCallback((list: HL[]) => {
    const root = containerRef.current;
    if (!root) return;
    // Clear previous marks.
    for (const mark of Array.from(root.querySelectorAll("mark[data-hl]"))) {
      const parent = mark.parentNode!;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
    for (const hl of list) {
      markFirstOccurrence(root, hl.text, hl.id);
    }
  }, []);

  useEffect(() => {
    applyHighlights(highlights);
  }, [highlights, applyHighlights]);

  // ── Selection → pill ──────────────────────────────────────────────────
  useEffect(() => {
    function onSelectionEnd() {
      const sel = window.getSelection();
      const root = containerRef.current;
      if (!sel || sel.isCollapsed || !root) {
        setPill(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 3 || text.length > 2000) {
        setPill(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setPill(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPill({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
        text,
      });
    }
    document.addEventListener("mouseup", onSelectionEnd);
    document.addEventListener("touchend", onSelectionEnd);
    return () => {
      document.removeEventListener("mouseup", onSelectionEnd);
      document.removeEventListener("touchend", onSelectionEnd);
    };
  }, []);

  async function saveHighlight() {
    if (!pill) return;
    const text = pill.text;
    setPill(null);
    window.getSelection()?.removeAllRanges();
    const res = await fetch(`/api/reader/${item.id}/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const { highlight } = (await res.json()) as { highlight: HL };
      setHighlights((h) => [...h, highlight]);
      haptic("success");
    }
  }

  async function removeHighlight(id: string) {
    await fetch(`/api/reader/${item.id}/highlights`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlightId: id }),
    });
    setHighlights((h) => h.filter((x) => x.id !== id));
  }

  // Tapping an existing mark offers removal.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    function onClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement).closest?.("mark[data-hl]");
      if (!mark) return;
      const id = mark.getAttribute("data-hl")!;
      if (confirm("Remove this highlight?")) void removeHighlight(id);
    }
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleArchive() {
    const next = !archived;
    setArchived(next);
    await fetch(`/api/reader/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: next }),
    });
    if (next) router.push("/reader");
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 2500);
      return;
    }
    await fetch(`/api/reader/${item.id}`, { method: "DELETE" });
    router.push("/reader");
  }

  const minutes = Math.max(1, Math.round(item.wordCount / 230));

  return (
    <div className="px-4 py-4 sm:px-6 md:py-6 pb-24">
      {/* Top bar */}
      <div className="mx-auto max-w-2xl flex items-center justify-between gap-2 mb-6">
        <Link
          href="/reader"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="size-4" /> Read later
        </Link>
        <div className="flex items-center gap-0.5">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            title="Open original"
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            onClick={toggleArchive}
            className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            title={archived ? "Unarchive" : "Archive"}
          >
            {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          </button>
          <button
            onClick={remove}
            className={
              confirming
                ? "rounded p-1.5 bg-rose-500 text-white"
                : "rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-rose-500/10 hover:text-rose-500"
            }
            title={confirming ? "Tap again to delete" : "Delete"}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight leading-tight [text-wrap:balance]">
          {item.title}
        </h1>
        <div className="mt-2 mb-8 text-sm text-[var(--color-muted-foreground)]">
          {[item.byline, item.siteName, item.wordCount ? `${minutes} min` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>

        {item.contentHtml ? (
          <div
            ref={containerRef}
            className="reader-prose select-text"
            dangerouslySetInnerHTML={{ __html: item.contentHtml }}
          />
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No reader view for this link —{" "}
            <a className="underline" href={item.url} target="_blank" rel="noreferrer">
              open the original
            </a>
            .
          </p>
        )}

        {highlights.length > 0 ? (
          <section className="mt-12 border-t border-[var(--color-border)] pt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] inline-flex items-center gap-1.5">
              <Highlighter className="size-3.5" /> Highlights
            </h2>
            <ul className="space-y-3">
              {highlights.map((h) => (
                <li key={h.id} className="group flex items-start gap-2">
                  <blockquote className="flex-1 border-l-2 border-[var(--color-foreground)]/30 pl-3 text-sm">
                    {h.text}
                  </blockquote>
                  <button
                    onClick={() => removeHighlight(h.id)}
                    className="rounded p-1 text-[var(--color-muted-foreground)] opacity-0 group-hover:opacity-100 hover:text-rose-500"
                    title="Remove highlight"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>

      {/* Floating highlight pill */}
      {pill ? (
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            void saveHighlight();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            void saveHighlight();
          }}
          style={{
            position: "fixed",
            left: Math.min(Math.max(pill.x, 70), window.innerWidth - 70),
            top: Math.min(pill.y, window.innerHeight - 60),
            transform: "translateX(-50%)",
            zIndex: 60,
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-xs font-medium shadow-lg"
        >
          <Highlighter className="size-3.5" /> Highlight
        </button>
      ) : null}
    </div>
  );
}

// ── text matching ────────────────────────────────────────────────────────
// Wrap the first occurrence of `needle` (whitespace-normalized match) in
// <mark data-hl>. Handles matches spanning multiple text nodes by wrapping
// each intersecting text-node segment.
function markFirstOccurrence(root: HTMLElement, needle: string, hlId: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("mark[data-hl]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  let full = "";
  const offsets: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    offsets.push(full.length);
    full += (n as Text).data;
  }

  const normNeedle = needle.replace(/\s+/g, " ").trim();
  // Build a normalized haystack with an index map back to raw offsets.
  let norm = "";
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < full.length; i++) {
    const ch = full[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        norm += " ";
        map.push(i);
        lastWasSpace = true;
      }
    } else {
      norm += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  const at = norm.indexOf(normNeedle);
  if (at === -1) return;
  const rawStart = map[at];
  const rawEnd = map[at + normNeedle.length - 1] + 1;

  // Collect (node, startInNode, endInNode) segments intersecting the range.
  const segments: { node: Text; start: number; end: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = nodeStart + nodes[i].data.length;
    if (nodeEnd <= rawStart || nodeStart >= rawEnd) continue;
    segments.push({
      node: nodes[i],
      start: Math.max(0, rawStart - nodeStart),
      end: Math.min(nodes[i].data.length, rawEnd - nodeStart),
    });
  }
  // Wrap segments (in reverse so offsets stay valid).
  for (const seg of segments.reverse()) {
    const { node, start, end } = seg;
    if (start >= end) continue;
    const target = node.splitText(start);
    target.splitText(end - start);
    const mark = document.createElement("mark");
    mark.setAttribute("data-hl", hlId);
    target.parentNode!.replaceChild(mark, target);
    mark.appendChild(target);
  }
}
