"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { useOverlayTransition } from "@/lib/use-overlay-transition";
import {
  IN_FLIGHT_STATUSES,
  MAX_REQUEST_CHARS,
  OPEN_IMPROVE_EVENT,
  type ImprovementContext,
  type ImprovementStatus,
  type ImprovementView,
} from "@/lib/improvements/request";

// "Improve" dialog: Eddie describes a change to the app, the Mac improve
// worker implements it with Claude Code and either ships it or stops at a PR
// for review. Opened from the sidebar / mobile drawer via OPEN_IMPROVE_EVENT.
// Mounted once in layout-overlays.tsx; renders nothing until opened.

export const POLL_MS = 15_000;
const RECENT_SHOWN = 10;

const PLACEHOLDER = "What should change? For example:\n• Focus the search box when I open Home\n• Show due dates on Board cards";

const isTemp = (i: ImprovementView) => i.id.startsWith("temp-");
const isInFlight = (i: ImprovementView) => IN_FLIGHT_STATUSES.includes(i.status);

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** What the worker gets to know about where the request came from. */
function pageContext(): ImprovementContext {
  return {
    path: window.location.pathname,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    userAgent: navigator.userAgent,
  };
}

/** The JSON body of a response, or {} when there was no response (offline) or no JSON. */
async function readJson<T>(res: Response | null): Promise<Partial<T> & { error?: string }> {
  if (!res) return {};
  return (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
}

export function ImproveDialog() {
  const [open, setOpen] = useState(false);
  const { mounted, state } = useOverlayTransition(open);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<ImprovementView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Bumped by every local write. A list GET that started before one landed is
  // dropped (it could resurrect a cancelled row or hide a just-sent one); the
  // next poll catches up.
  const generation = useRef(0);
  const titleId = useId();

  const recent = items.slice(0, RECENT_SHOWN);
  const polling = open && recent.some(isInFlight);

  const load = useCallback(async () => {
    const gen = generation.current;
    try {
      const res = await fetch("/api/improvements", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { improvements: ImprovementView[] };
      if (gen !== generation.current) return;
      // Keep optimistic rows whose POST hasn't come back yet.
      setItems((prev) => [...prev.filter(isTemp), ...data.improvements]);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    function onOpen() {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
    window.addEventListener(OPEN_IMPROVE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IMPROVE_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, []);

  // Refresh the list on every open.
  useEffect(() => {
    if (!open) return;
    setNote(null);
    setItemErrors({});
    void load();
  }, [open, load]);

  // The textarea exists once the overlay has mounted (one render after open).
  useEffect(() => {
    if (open && mounted) textareaRef.current?.focus();
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  async function send() {
    const request = text.trim();
    if (!request || sending) return;
    const temp: ImprovementView = {
      id: `temp-${Date.now()}`,
      request,
      context: null,
      status: "queued",
      summary: null,
      reviewReason: null,
      prUrl: null,
      previewUrl: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    setSending(true);
    setNote(null);
    setItems((prev) => [temp, ...prev]);
    setText("");
    const res = await fetch("/api/improvements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, context: pageContext() }),
    }).catch(() => null);
    const { improvement, error } = await readJson<{ improvement: ImprovementView }>(res);
    if (res?.ok && improvement) {
      generation.current++;
      // A poll that landed mid-POST may already list the saved row: keep one.
      setItems((prev) => prev.filter((i) => i.id !== improvement.id).map((i) => (i.id === temp.id ? improvement : i)));
    } else {
      setItems((prev) => prev.filter((i) => i.id !== temp.id));
      setText(text);
      setNote(error || "Couldn't send that request.");
    }
    setSending(false);
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setItemError(id: string, message: string | null) {
    setItemErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function approve(item: ImprovementView) {
    setBusy(item.id, true);
    setItemError(item.id, null);
    const res = await fetch(`/api/improvements/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }).catch(() => null);
    const { improvement, error } = await readJson<{ improvement: ImprovementView }>(res);
    if (res?.ok && improvement) {
      generation.current++;
      setItems((prev) => prev.map((i) => (i.id === item.id ? improvement : i)));
    } else {
      setItemError(item.id, error || "Couldn't ship that.");
      // 409: it moved on elsewhere (another tab, the worker); show where it is now.
      if (res?.status === 409) void load();
    }
    setBusy(item.id, false);
  }

  async function cancel(item: ImprovementView) {
    setBusy(item.id, true);
    setItemError(item.id, null);
    const res = await fetch(`/api/improvements/${item.id}`, { method: "DELETE" }).catch(() => null);
    // 404: already gone, which is what cancelling wanted.
    if (res && (res.ok || res.status === 404)) {
      generation.current++;
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      const { error } = await readJson<object>(res);
      setItemError(item.id, error || "Couldn't cancel that.");
      // 409: the worker picked it up meanwhile; show it as Working.
      if (res?.status === 409) void load();
    }
    setBusy(item.id, false);
  }

  if (!mounted) return null;

  return (
    <div
      data-overlay="backdrop"
      data-state={state}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm max-md:items-end max-md:p-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        data-overlay="modal"
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-elevated)] shadow-modal max-md:max-w-none max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <h2 id={titleId} className="text-base font-medium">
            Improve Personal OS
          </h2>
          <button
            type="button"
            onClick={close}
            className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={4}
            maxLength={MAX_REQUEST_CHARS}
            aria-label="What should change?"
            placeholder={PLACEHOLDER}
            className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
            An agent on your Mac implements it, tests it and ships it, then reports back below. Attaches this page, your
            window size and build. Waits while the Mac is asleep.
          </p>
          {note ? (
            <p role="alert" className="mt-2 text-xs text-rose-500">
              {note}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] min-h-[36px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-50 min-h-[36px]"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Recent
          </div>
          {recent.length > 0 ? (
            <ul className="space-y-2">
              {recent.map((item) => (
                <ImprovementItem
                  key={item.id}
                  item={item}
                  busy={busyIds.has(item.id)}
                  error={itemErrors[item.id] ?? null}
                  onApprove={() => void approve(item)}
                  onCancel={() => void cancel(item)}
                />
              ))}
            </ul>
          ) : !loaded ? (
            <div className="flex items-center gap-2 py-2 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <p className="py-2 text-sm text-[var(--color-muted-foreground)]">
              {loadError ? "Couldn't load recent requests." : "No requests yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ImprovementItem({
  item,
  busy,
  error,
  onApprove,
  onCancel,
}: {
  item: ImprovementView;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const link = "underline-offset-2 hover:text-[var(--color-foreground)] hover:underline";
  const action =
    "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-accent)] disabled:opacity-50";
  return (
    <li data-improvement={item.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm" title={item.request}>
        {item.request}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
        <StatusPill status={item.status} />
        <span>{formatDate(item.createdAt)}</span>
        {item.prUrl ? (
          <>
            <span aria-hidden>·</span>
            <a href={item.prUrl} target="_blank" rel="noreferrer" className={link}>
              PR
            </a>
          </>
        ) : null}
        {item.previewUrl ? (
          <>
            <span aria-hidden>·</span>
            <a href={item.previewUrl} target="_blank" rel="noreferrer" className={link}>
              Preview
            </a>
          </>
        ) : null}
      </div>
      {item.summary ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[var(--color-muted-foreground)]">{item.summary}</p>
      ) : null}
      {item.status === "needs_review" && item.reviewReason ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs">{item.reviewReason}</p>
      ) : null}
      {item.status === "failed" ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-rose-500">What went wrong</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-muted-foreground)]">
            {item.error || "No details were recorded."}
          </p>
        </details>
      ) : null}
      {item.status === "needs_review" ? (
        <div className="mt-2.5">
          <button type="button" onClick={onApprove} disabled={busy} className={action}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            Ship it
          </button>
        </div>
      ) : item.status === "queued" && !isTemp(item) ? (
        <div className="mt-2.5">
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel this request" className={action}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-rose-500">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const STATUS_LABELS: Record<ImprovementStatus, string> = {
  queued: "Queued",
  running: "Working",
  needs_review: "Needs review",
  approved: "Shipping",
  shipped: "Shipped",
  failed: "Failed",
};

function StatusPill({ status }: { status: ImprovementStatus }) {
  const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none";
  const label = STATUS_LABELS[status] ?? status;
  if (status === "failed") return <span className={`${pill} border-rose-500/40 text-rose-500`}>{label}</span>;
  return (
    <span className={`${pill} border-[var(--color-border)]`}>
      {status === "running" ? <Loader2 className="size-3 animate-spin" /> : null}
      {label}
    </span>
  );
}
