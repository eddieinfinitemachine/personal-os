"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STORAGE_KEY, TEMPLATES, type SidebarTemplate, type TemplateSlug } from "@/lib/templates";
import {
  applySubsetOrder,
  decideInitialSync,
  moveSlug,
  orderedTemplates,
  parseTrackerSlugs,
  sameOrder,
  sortByTemplateOrder,
} from "@/lib/tracker-order";

const ENABLED_EVENT = "personalos:enabled-templates-changed";
const SYNC_URL = "/api/settings/trackers";
// Re-check the server when the tab comes back, at most this often, so a
// reorder on the laptop shows up on the phone without a reload.
const RESYNC_MS = 30_000;

// Enabled trackers in sidebar order. localStorage is the instant cache; the
// server copy (User.sidebarTrackers) is the cross-device source of truth.
export function readEnabledOrder(): TemplateSlug[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseTrackerSlugs(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

// Membership view of the same cache, for callers that only ask "is X on?".
export function readEnabled(): Set<TemplateSlug> {
  return new Set(readEnabledOrder());
}

// Present once the cache holds a deliberate order (see sortByTemplateOrder).
const ORDERED_KEY = `${STORAGE_KEY}:ordered`;

function writeLocal(next: TemplateSlug[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.localStorage.setItem(ORDERED_KEY, "1");
  } catch {}
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT));
}

function migrateLegacyOrder() {
  try {
    if (window.localStorage.getItem(ORDERED_KEY)) return;
    if (window.localStorage.getItem(STORAGE_KEY) === null) return;
  } catch {
    return;
  }
  writeLocal(sortByTemplateOrder(readEnabledOrder()));
}

// Module-level sync state, shared by every hook instance (sidebar + drawer)
// so they don't each hit the server.
let syncInFlight: Promise<void> | null = null;
let lastSyncAt = 0;
let localWrites = 0;
let putChain: Promise<void> = Promise.resolve();

async function putTrackers(slugs: TemplateSlug[]) {
  try {
    const res = await fetch(SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackers: slugs }),
    });
    if (!res.ok) console.warn(`[trackers] save failed: HTTP ${res.status}`);
  } catch (err) {
    console.warn("[trackers] save failed:", err instanceof Error ? err.name : "error");
  }
}

// PUTs are serialized and each sends the cache as it is when its turn comes,
// so a burst of reorders can't land out of order.
function pushToServer() {
  putChain = putChain.then(() => putTrackers(readEnabledOrder()));
}

function setEnabledOrder(next: TemplateSlug[]) {
  localWrites++;
  writeLocal(next);
  pushToServer();
}

function syncFromServer(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  if (Date.now() - lastSyncAt < RESYNC_MS) return Promise.resolve();
  lastSyncAt = Date.now();
  const writesAtStart = localWrites;
  syncInFlight = (async () => {
    try {
      const res = await fetch(SYNC_URL, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[trackers] load failed: HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { trackers?: unknown };
      // A local change made while the GET was in flight is newer than
      // whatever the server returned; its own PUT will reconcile.
      if (localWrites !== writesAtStart) return;
      const server = Array.isArray(body.trackers) ? parseTrackerSlugs(body.trackers) : null;
      const decision = decideInitialSync(server, readEnabledOrder());
      if (decision.kind === "upload") pushToServer();
      else if (decision.kind === "adopt") writeLocal(decision.slugs);
    } catch (err) {
      console.warn("[trackers] load failed:", err instanceof Error ? err.name : "error");
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

// Hook: enabled templates (filtered by isPrivate, in the user's order) plus
// add/remove/reorder. Reactive across sidebar/drawer instances within the tab
// via a custom event, across tabs via the storage event, and across devices
// via the server sync above.
export function useEnabledTemplates(isPrivate: boolean): {
  enabled: SidebarTemplate[];
  available: SidebarTemplate[];
  add: (slug: TemplateSlug) => void;
  remove: (slug: TemplateSlug) => void;
  reorder: (slugs: TemplateSlug[]) => void;
  move: (slug: TemplateSlug, toIndex: number) => void;
} {
  const [order, setOrder] = useState<TemplateSlug[]>([]);

  useEffect(() => {
    const refresh = () =>
      setOrder((prev) => {
        const next = readEnabledOrder();
        return sameOrder(prev, next) ? prev : next;
      });
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    migrateLegacyOrder();
    refresh();
    window.addEventListener(ENABLED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    void syncFromServer();
    return () => {
      window.removeEventListener(ENABLED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const visible = TEMPLATES.filter((t) => (t.privateOnly ? isPrivate : true));
  const enabled = orderedTemplates(order, visible);
  const enabledSet = new Set(order);
  const available = visible.filter((t) => !enabledSet.has(t.slug));

  // Mutations read the cache rather than this instance's state so two
  // surfaces editing in quick succession never overwrite each other.
  const add = (slug: TemplateSlug) => {
    const cur = readEnabledOrder();
    if (!cur.includes(slug)) setEnabledOrder([...cur, slug]);
  };
  const remove = (slug: TemplateSlug) => {
    const cur = readEnabledOrder();
    if (cur.includes(slug)) setEnabledOrder(cur.filter((s) => s !== slug));
  };
  // `slugs` is the new order of whatever subset the caller shows; slugs it
  // doesn't show keep their slots.
  const reorder = (slugs: TemplateSlug[]) => {
    const cur = readEnabledOrder();
    const next = applySubsetOrder(cur, slugs);
    if (!sameOrder(cur, next)) setEnabledOrder(next);
  };
  // Move within the visible enabled list (`enabled` indices).
  const move = (slug: TemplateSlug, toIndex: number) => {
    const shown = enabled.map((t) => t.slug);
    reorder(moveSlug(shown, slug, toIndex));
  };

  return { enabled, available, add, remove, reorder, move };
}

export function AddTemplateButton({
  available,
  onAdd,
  variant = "sidebar",
}: {
  available: SidebarTemplate[];
  onAdd: (slug: TemplateSlug) => void;
  variant?: "sidebar" | "drawer";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (available.length === 0 && !open) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
          "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
          variant === "drawer" && "gap-3 px-3 py-2.5",
        )}
      >
        <span className="text-[var(--color-muted-foreground)]">
          <Plus className="size-4" />
        </span>
        <span className="flex-1 text-left truncate">Add tracker</span>
      </button>
      {open ? (
        <div
          role="dialog"
          className={cn(
            "mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg",
            variant === "sidebar" ? "p-1" : "p-1.5",
          )}
        >
          {available.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              All trackers added.
            </div>
          ) : (
            <ul className="space-y-0.5 max-h-[60vh] overflow-y-auto">
              {available.map((t) => (
                <li key={t.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(t.slug);
                      if (available.length === 1) setOpen(false);
                    }}
                    className="w-full flex items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] text-[var(--color-muted-foreground)] transition"
                  >
                    <t.Icon className="size-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--color-foreground)] truncate">{t.label}</div>
                      <div className="text-[11px] leading-snug text-[var(--color-muted-foreground)] mt-0.5">
                        {t.description}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
