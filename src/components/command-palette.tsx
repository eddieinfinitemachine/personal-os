"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCapture } from "@/lib/capture-store";
import {
  Calendar,
  Camera,
  Car,
  CheckCircle2,
  FileText,
  Folder,
  Home,
  Lightbulb,
  ListTodo,
  MapPin,
  Package,
  PawPrint,
  Plane,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import type { SearchResult, SearchResultType } from "@/app/api/search/route";

// Icon per universal-search result type (content search + ⌘K unified).
const RESULT_ICONS: Record<SearchResultType, React.ReactNode> = {
  todo: <CheckCircle2 className="size-4" />,
  project: <Folder className="size-4" />,
  list: <ListTodo className="size-4" />,
  note: <FileText className="size-4" />,
  person: <Users className="size-4" />,
  trip: <Plane className="size-4" />,
  vehicle: <Car className="size-4" />,
  asset: <Package className="size-4" />,
  recommendation: <Star className="size-4" />,
  pet: <PawPrint className="size-4" />,
};

// Global ⌘K (Mac) / ⌃K (others) command palette.
//
// Two modes:
//  1. Fuzzy nav — type to filter and jump to a page (Home, Calendar, Friends, etc.)
//  2. Inline dynamic capture — anything typed becomes the seed for a smart capture.
//     Hit ⌘↵ (or click the highlighted "Capture: …" row) to send it to /capture
//     with the text pre-filled. The parse fires immediately on landing.
//
// Mounted once at the root (layout.tsx); no UI is rendered until the user
// triggers it.

type NavCommand = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ReactNode;
};

// Order matches the sidebar so ⌘1–9 == top 9 sidebar entries.
const NAV_COMMANDS: NavCommand[] = [
  { id: "home", label: "Home", href: "/", icon: <Home className="size-4" /> },
  { id: "capture", label: "Capture", hint: "Photo + sentence → smart capture", href: "/capture", icon: <Camera className="size-4" /> },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: <Calendar className="size-4" /> },
  { id: "personal", label: "Personal", href: "/personal", icon: <User className="size-4" /> },
  { id: "friends", label: "Friends", href: "/friends", icon: <Users className="size-4" /> },
  { id: "vehicles", label: "Vehicles", href: "/vehicles", icon: <Folder className="size-4" /> },
  { id: "trips", label: "Trips", href: "/trips", icon: <Plane className="size-4" /> },
  { id: "investments", label: "Investments", href: "/investments", icon: <TrendingUp className="size-4" /> },
  { id: "inventory", label: "Inventory", href: "/inventory", icon: <Package className="size-4" /> },
  { id: "media", label: "Media", href: "/media", icon: <Lightbulb className="size-4" /> },
  { id: "places", label: "Places", href: "/places", icon: <MapPin className="size-4" /> },
  { id: "best-practices", label: "Best practices", href: "/best-practices", icon: <Lightbulb className="size-4" /> },
  { id: "settings", label: "Settings", href: "/settings", icon: <Settings className="size-4" /> },
];

function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (!n) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

export function CommandPalette() {
  const router = useRouter();
  const { enqueue } = useCapture();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchResult[]>([]);

  // Global hotkeys:
  //   ⌘K / ⌃K  → open/close palette
  //   ⌘1..⌘9 / ⌃1..⌃9 → jump straight to NAV_COMMANDS[0..8]
  // Skipped while a text input is focused so number keys still type normally.
  useEffect(() => {
    function inEditable(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      // ⌘K / ⌃K toggle palette.
      if (k === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      // ⌘1..⌘9 (Mac) / ⌃1..⌃9 (others) → jump to NAV_COMMANDS[n-1].
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        /^[1-9]$/.test(e.key) &&
        !inEditable() &&
        !open
      ) {
        const idx = parseInt(e.key, 10) - 1;
        const target = NAV_COMMANDS[idx];
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(0);
      // Focus the input after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Lets the mobile top-bar search pill open this same overlay.
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("command-palette:open", openHandler);
    return () => window.removeEventListener("command-palette:open", openHandler);
  }, []);

  const trimmed = query.trim();

  // Debounced universal content search (reminders, projects, notes, people…).
  // Abortable so stale responses never clobber the latest query.
  useEffect(() => {
    if (!open || trimmed.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [trimmed, open]);
  const looksLikeCapture = trimmed.split(/\s+/).length >= 2 || trimmed.length > 12;

  const filteredNav = useMemo(
    () =>
      NAV_COMMANDS.filter(
        (c) =>
          !trimmed ||
          fuzzyMatch(trimmed, c.label) ||
          fuzzyMatch(trimmed, c.hint ?? "") ||
          fuzzyMatch(trimmed, c.href),
      ),
    [trimmed],
  );

  // Capture command is always available when there's text; appears at the top
  // if the query looks like a sentence (multi-word or longer), at the bottom
  // otherwise.
  const captureCommand = trimmed
    ? {
        id: "capture-inline",
        label: looksLikeCapture
          ? `Capture: "${trimmed.length > 60 ? trimmed.slice(0, 60) + "…" : trimmed}"`
          : `Smart capture with this text`,
        hint: "Opens /capture and parses with Claude",
      }
    : null;

  // Content results first (most specific), then page nav, then the capture
  // fallback last — so "no match → capture this" always remains reachable.
  const items: Array<
    | { kind: "result"; result: SearchResult }
    | { kind: "nav"; cmd: NavCommand }
    | { kind: "capture"; label: string; hint: string }
  > = [
    ...results.map((result) => ({ kind: "result" as const, result })),
    ...filteredNav.map((c) => ({ kind: "nav" as const, cmd: c })),
    ...(captureCommand
      ? [{ kind: "capture" as const, label: captureCommand.label, hint: captureCommand.hint }]
      : []),
  ];

  // Clamp active index when the list shrinks.
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(0);
  }, [items.length, activeIdx]);

  function pick(idx: number) {
    const item = items[idx];
    if (!item) return;
    setOpen(false);
    if (item.kind === "nav") {
      router.push(item.cmd.href);
    } else if (item.kind === "result") {
      router.push(item.result.href);
    } else {
      // Background parse — no navigation. The inbox pill (top-right)
      // surfaces the in-flight + ready state.
      enqueue(trimmed);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // ⌘↵ always enqueues as a capture, even when the text doesn't
      // pass the "looks like a sentence" heuristic.
      if ((e.metaKey || e.ctrlKey) && trimmed) {
        enqueue(trimmed);
        setOpen(false);
        return;
      }
      pick(activeIdx);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] sm:items-center sm:pt-4 bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        data-overlay="scale"
        data-state="open"
        className="w-full max-w-xl rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-elevated)] shadow-modal overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Sparkles className="size-4 text-[var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Search everything, jump, or capture…"
            className="flex-1 bg-transparent text-base focus:outline-none placeholder:text-[var(--color-muted-foreground)]"
          />
          <div className="hidden sm:block text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            esc to close
          </div>
        </div>

        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--color-muted-foreground)]">
              No matches.
            </li>
          ) : (
            items.map((it, i) => {
              const key =
                it.kind === "nav"
                  ? it.cmd.id
                  : it.kind === "result"
                    ? `r-${it.result.type}-${it.result.id}`
                    : `cap-${i}`;
              const icon =
                it.kind === "nav"
                  ? it.cmd.icon
                  : it.kind === "result"
                    ? RESULT_ICONS[it.result.type]
                    : <Camera className="size-4 text-[var(--color-tint)]" />;
              const label =
                it.kind === "nav" ? it.cmd.label : it.kind === "result" ? it.result.label : it.label;
              const hint =
                it.kind === "nav"
                  ? it.cmd.hint ?? it.cmd.href
                  : it.kind === "result"
                    ? it.result.sublabel ?? ""
                    : it.hint;
              return (
                <li key={key}>
                  <button
                    onClick={() => pick(i)}
                    onMouseMove={() => setActiveIdx(i)}
                    className={
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm " +
                      (i === activeIdx
                        ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
                        : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60")
                    }
                  >
                    <span className="text-[var(--color-muted-foreground)] shrink-0">{icon}</span>
                    <span className="flex-1 truncate">{label}</span>
                    <span className="text-xs text-[var(--color-muted-foreground)] truncate max-w-[40%]">
                      {hint}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2 text-[11px] text-[var(--color-muted-foreground)] flex items-center justify-between gap-2">
          <span>
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono">↑↓</kbd>{" "}
            navigate ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono">↵</kbd>{" "}
            select ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono">⌘1–9</kbd>{" "}
            jump
          </span>
          <span>
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono">⌘↵</kbd>{" "}
            send as capture
          </span>
        </div>
      </div>
    </div>
  );
}
