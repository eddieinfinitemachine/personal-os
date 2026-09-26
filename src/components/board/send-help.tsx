"use client";

import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";

export function SendHelp({ onClose }: { onClose: () => void }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const endpoint = `${origin}/api/board`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--color-elevated)] p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ways to send</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-fill)]" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <Section title="Right here">
          Press <Kbd>⌘V</Kbd> anywhere on the board to paste a link, image, or text. Drag images from Finder or
          from another tab. On your phone, tap <b>Add</b>.
        </Section>

        <Section title="iPhone share sheet (one-time setup, ~2 min)">
          <p className="mb-2">
            Build a Shortcut called <b>Save to Board</b>. After that, it sits in the share sheet of every app:
            YouTube, Spotify, Instagram, Safari, Photos, Amazon.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Shortcuts app → <b>+</b> → name it <b>Save to Board</b>. Tap <b>ⓘ</b> and turn on <b>Show in Share Sheet</b>{" "}
              (input: <b>Any</b>).
            </li>
            <li>
              Add <b>Get URLs from Input</b>, then <b>If</b> <i>URLs</i> <b>has any value</b>.
            </li>
            <li>
              Inside <b>If</b>: <b>Get Contents of URL</b> with the settings below, Request Body <b>JSON</b>, one Text
              field named <code>input</code> = <i>Shortcut Input</i>.
            </li>
            <li>
              Under <b>Otherwise</b>: the same <b>Get Contents of URL</b>, but Request Body <b>File</b> ={" "}
              <i>Shortcut Input</i>. That covers photos and screenshots (HEIC is fine) and plain text.
            </li>
          </ol>
          <div className="mt-3 rounded-lg bg-[var(--color-fill)] p-3 text-[13px] space-y-1.5">
            <Row label="URL" value={endpoint} />
            <Row label="Method" value="POST" />
            <Row label="Header" value="Authorization: Bearer <your capture token>" copy={false} />
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
            Same token as your Read Later Shortcut. Optional: end with <b>Show Notification</b> so you see “Saved to board”.
          </p>
        </Section>

        <Section title="Chrome">
          Update the Kaizen Capture extension (reload it at chrome://extensions). Right-click any image →{" "}
          <b>Save image to Board</b>, or any page or link → <b>Save to Board</b>. Shortcut: <Kbd>⌘⇧Y</Kbd>.
        </Section>

        <Section title="Android / desktop app">
          Install Kaizen as an app (Chrome → Install). It then shows up in the system share sheet as a target.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--color-separator)] py-4 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      <div className="text-sm leading-relaxed text-[var(--color-label-secondary)]">{children}</div>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-fill)] px-1 py-px text-xs font-sans">{children}</kbd>;
}

function Row({ label, value, copy = true }: { label: string; value: string; copy?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[var(--color-muted-foreground)]">{label}</span>
      <code className="flex-1 min-w-0 truncate">{value}</code>
      {copy && (
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          }}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          aria-label={`Copy ${label}`}
        >
          {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
