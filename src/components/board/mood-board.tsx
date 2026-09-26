"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Search, Send, X } from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import { haptic } from "@/lib/haptic";
import { displayHost, type BoardKind } from "@/lib/board-embed";
import { BoardLightbox } from "./board-lightbox";
import { ForYou } from "./for-you";
import { KindGlyph } from "./kind-glyph";
import { SendHelp } from "./send-help";
import type { BoardCard } from "./types";

type Filter = "all" | BoardKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Video" },
  { key: "music", label: "Music" },
  { key: "product", label: "Products" },
  { key: "link", label: "Links" },
  { key: "note", label: "Notes" },
];

const GAP = 10;
// Vercel rejects request bodies over 4.5 MB before the route runs.
const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;

type Pending = { id: string; label: string; preview?: string };

function columnsFor(width: number): number {
  if (width < 520) return 2;
  if (width < 820) return 3;
  if (width < 1150) return 4;
  if (width < 1500) return 5;
  return 6;
}

// Height of a tile per unit of column width, used only to balance columns.
function relHeight(item: BoardCard): number {
  if (item.imageUrl) {
    if (item.imageWidth && item.imageHeight) {
      return Math.min(2.2, Math.max(0.4, item.imageHeight / item.imageWidth));
    }
    return 1;
  }
  if (item.kind === "note") return 0.35 + Math.min(1.4, (item.note?.length ?? 0) / 260);
  return 0.55;
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function MoodBoard({ initialItems }: { initialItems: BoardCard[] }) {
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState<"board" | "for-you">("board");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Deep link to picks (?view=for-you, used by the weekly push), and messages
  // from the PWA share target redirect (?saved= / ?error=).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "for-you") setView("for-you");
    const err = params.get("error");
    if (params.has("saved")) say("Saved to board");
    if (err) say(err, true);
    if (params.has("saved") || err) window.history.replaceState(null, "", "/board");
  }, [say]);

  const switchView = useCallback((next: "board" | "for-you") => {
    setView(next);
    window.history.replaceState(null, "", next === "for-you" ? "/board?view=for-you" : "/board");
  }, []);

  // Pick up things sent from the phone while this tab sat in the background.
  useEffect(() => {
    // focus and visibilitychange usually fire together; one fetch is enough.
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: BoardCard[] };
        setItems(data.items);
      } catch {
        // Offline; keep what we have.
      } finally {
        inFlight = false;
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
    // The grid unmounts while For you is showing; observe the new node.
  }, [view]);

  const send = useCallback(
    async (body: BodyInit, label: string, preview?: string, headers?: HeadersInit) => {
      const pid = Math.random().toString(36).slice(2);
      // Pasting or dropping while on For you: show it landing on the board.
      switchView("board");
      setPending((p) => [{ id: pid, label, preview }, ...p]);
      try {
        const res = await fetch("/api/board", { method: "POST", body, headers });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          item?: BoardCard;
          duplicate?: boolean;
          error?: string;
        };
        if (!res.ok || !data.item) throw new Error(data.error || `HTTP ${res.status}`);
        const item = data.item;
        setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
        haptic("success");
        if (data.duplicate) say("Already on your board, moved to the top");
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't save that", true);
      } finally {
        setPending((p) => p.filter((x) => x.id !== pid));
        if (preview) URL.revokeObjectURL(preview);
      }
    },
    [say, switchView],
  );

  const sendText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      void send(JSON.stringify({ text: t }), displayHost(t.match(/https?:\/\/\S+/)?.[0]) ?? "Note", undefined, {
        "Content-Type": "application/json",
      });
    },
    [send],
  );

  const sendFiles = useCallback(
    async (files: File[]) => {
      for (const file of files.filter((f) => f.type.startsWith("image/"))) {
        const preview = URL.createObjectURL(file);
        let upload = file;
        try {
          // GIFs keep their animation; everything else is shrunk client-side
          // to stay under the 4.5 MB function body limit.
          if (file.type !== "image/gif") upload = await compressImage(file);
        } catch {
          // Undecodable here (e.g. HEIC on Chrome); let the server try.
        }
        if (upload.size > MAX_UPLOAD_BYTES) {
          URL.revokeObjectURL(preview);
          say(`${file.name || "That image"} is over 4 MB. Try a smaller version.`, true);
          continue;
        }
        const form = new FormData();
        form.append("file", upload);
        void send(form, "Image", preview);
      }
    },
    [send, say],
  );

  // Paste anywhere on the page: images, links, or text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || openId) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void sendFiles(files);
        return;
      }
      const text = e.clipboardData?.getData("text/plain");
      if (text?.trim()) {
        e.preventDefault();
        sendText(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openId, sendFiles, sendText]);

  // Drag images from Finder or links/images from another tab.
  useEffect(() => {
    let depth = 0;
    // Drags that start on this page (a tile's own image) aren't new things.
    let internal = false;
    const start = () => {
      internal = true;
    };
    const end = () => {
      internal = false;
    };
    const accepts = (e: DragEvent) =>
      !internal &&
      Array.from(e.dataTransfer?.types ?? []).some((t) => t === "Files" || t === "text/uri-list" || t === "text/plain");
    const enter = (e: DragEvent) => {
      if (!accepts(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (accepts(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!accepts(e)) {
        internal = false;
        return;
      }
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files);
      if (files.length) {
        void sendFiles(files);
        return;
      }
      // An image dragged from a web page: prefer the image itself over the page link.
      const html = dt.getData("text/html");
      const src = html.match(/<img[^>]+src="(https?:[^"]+)"/i)?.[1];
      if (src) {
        void send(
          JSON.stringify({ imageUrl: src.replace(/&amp;/g, "&"), url: dt.getData("text/uri-list") || undefined }),
          "Image",
          undefined,
          { "Content-Type": "application/json" },
        );
        return;
      }
      sendText(dt.getData("text/uri-list") || dt.getData("text/plain"));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [send, sendFiles, sendText]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== "all" && i.kind !== filter) return false;
      if (!q) return true;
      return [i.title, i.note, i.siteName, i.url, i.price].some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, filter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);

  // Masonry: each tile goes to the currently shortest column, so reading
  // order stays roughly left-to-right, newest first.
  const nCols = width ? columnsFor(width) : 2;
  const columns = useMemo(() => {
    const cols: Array<Array<{ pending: Pending } | { item: BoardCard }>> = Array.from({ length: nCols }, () => []);
    const heights = new Array(nCols).fill(0);
    const place = (entry: { pending: Pending } | { item: BoardCard }, h: number) => {
      const i = heights.indexOf(Math.min(...heights));
      cols[i].push(entry);
      heights[i] += h + 0.08;
    };
    for (const p of pending) place({ pending: p }, 1);
    for (const item of visible) place({ item }, relHeight(item));
    return cols;
  }, [visible, pending, nCols]);

  const openIndex = openId ? visible.findIndex((i) => i.id === openId) : -1;

  async function remove(id: string) {
    const index = items.findIndex((i) => i.id === id);
    const removed = items[index];
    setItems((p) => p.filter((i) => i.id !== id));
    setOpenId(null);
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok && removed) {
      // Put it back where it was without dropping anything saved meanwhile.
      setItems((p) => (p.some((i) => i.id === id) ? p : [...p.slice(0, index), removed, ...p.slice(index)]));
      say("Couldn't delete that", true);
    }
  }

  // Start a "More like this" run and jump to For you, which polls for it.
  async function moreLikeThis(id: string) {
    setOpenId(null);
    const res = await fetch("/api/board/recs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedId: id }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      say(data?.error ?? "Couldn't start that", true);
      return;
    }
    const data = (await res.json()) as { alreadyRunning?: boolean };
    if (data.alreadyRunning) say("Already finding picks. Try this again once they arrive.");
    switchView("for-you");
  }

  async function update(id: string, patch: Partial<Pick<BoardCard, "note" | "title">>) {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const res = await fetch(`/api/board/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) say("Couldn't save that change", true);
  }

  return (
    <div className="px-3 py-4 sm:px-5 md:px-6 md:py-6 min-h-screen">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">Board</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {view === "board"
              ? "Everything you liked. Share, paste, or drop anything here."
              : "Picks found for you, based on everything you saved."}
          </p>
          <div className="mt-3 inline-flex rounded-lg bg-[var(--color-fill)] p-0.5 text-sm">
            {(["board", "for-you"] as const).map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                className={`rounded-md px-3 py-1 transition ${
                  view === v
                    ? "bg-[var(--color-elevated)] font-medium shadow-card"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {v === "board" ? "Board" : "For you"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelp(true)}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-fill)] hover:text-[var(--color-foreground)] pressable inline-flex items-center gap-1.5"
          >
            <Send className="size-3.5" />
            Ways to send
          </button>
          <button
            onClick={() => {
              switchView("board");
              setComposer((v) => !v);
            }}
            className="rounded-lg bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] hover:opacity-90 pressable inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            Add
          </button>
        </div>
      </header>

      {view === "for-you" ? (
        <ForYou onSaved={(item) => setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)])} say={say} />
      ) : (
        <>
      {composer && <Composer onText={sendText} onFiles={sendFiles} onClose={() => setComposer(false)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] -mx-1 px-1">
          {FILTERS.filter((f) => f.key === "all" || counts[f.key]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-[13px] transition ${
                filter === f.key
                  ? "bg-[var(--color-foreground)] text-[var(--color-background)] font-medium"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-fill)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-50 tabular-nums">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 rounded-full bg-[var(--color-fill)] px-3 py-1 text-[13px] w-full sm:w-56">
          <Search className="size-3.5 text-[var(--color-muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent outline-none placeholder:text-[var(--color-muted-foreground)]"
          />
        </label>
      </div>

      <div ref={gridRef}>
        {items.length === 0 && pending.length === 0 ? (
          <EmptyBoard onHelp={() => setHelp(true)} />
        ) : visible.length === 0 && pending.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--color-muted-foreground)]">Nothing matches.</p>
        ) : (
          <div className="flex items-start" style={{ gap: GAP }}>
            {columns.map((col, ci) => (
              <div key={ci} className="flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>
                {col.map((entry) =>
                  "pending" in entry ? (
                    <PendingTile key={entry.pending.id} p={entry.pending} />
                  ) : (
                    <Tile key={entry.item.id} item={entry.item} onOpen={() => setOpenId(entry.item.id)} />
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>

        </>
      )}

      {openIndex >= 0 && (
        <BoardLightbox
          item={visible[openIndex]}
          onClose={() => setOpenId(null)}
          onPrev={openIndex > 0 ? () => setOpenId(visible[openIndex - 1].id) : undefined}
          onNext={openIndex < visible.length - 1 ? () => setOpenId(visible[openIndex + 1].id) : undefined}
          onDelete={() => remove(visible[openIndex].id)}
          onUpdate={(patch) => update(visible[openIndex].id, patch)}
          onMoreLikeThis={() => moreLikeThis(visible[openIndex].id)}
        />
      )}

      {help && <SendHelp onClose={() => setHelp(false)} />}

      {dragging && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-[var(--color-background)]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[var(--color-foreground)]/40 px-10 py-8 text-lg font-medium">
            Drop to save to your board
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-50 rounded-full px-4 py-2 text-sm shadow-popover ${
            toast.error
              ? "bg-[var(--color-destructive)] text-white"
              : "bg-[var(--color-foreground)] text-[var(--color-background)]"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Tile({ item, onOpen }: { item: BoardCard; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const host = item.siteName ?? displayHost(item.url);
  const hasImage = item.imageUrl && !broken;

  if (!hasImage) {
    return (
      <button
        onClick={onOpen}
        className="group text-left rounded-xl bg-[var(--color-fill)] p-4 hover:bg-[var(--color-accent)] transition pressable"
      >
        {item.kind === "note" ? (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap line-clamp-[12] break-words">{item.note}</p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] mb-1.5">
              <KindGlyph kind={item.kind} className="size-3" />
              <span className="truncate">{host}</span>
            </div>
            <p className="text-[15px] font-medium leading-snug line-clamp-4 break-words">{item.title ?? titleFromUrl(item.url)}</p>
            {item.price && <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">{item.price}</p>}
          </>
        )}
      </button>
    );
  }

  const ratio = item.imageWidth && item.imageHeight ? `${item.imageWidth} / ${item.imageHeight}` : undefined;
  return (
    <button
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-xl text-left pressable"
      style={{ backgroundColor: item.color ?? "var(--color-fill)", aspectRatio: ratio }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageUrl!}
        alt={item.title ?? ""}
        loading="lazy"
        decoding="async"
        // Server-rendered images can finish loading before hydration attaches
        // onLoad, so also check on mount.
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={`block w-full ${ratio ? "h-full object-cover" : "h-auto"} transition-[opacity,transform] duration-500 group-hover:scale-[1.02] ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      {(item.kind === "video" || item.kind === "music") && (
        <span className="absolute left-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <KindGlyph kind={item.kind} className="size-3.5" />
        </span>
      )}
      {item.price && (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
          {item.price}
        </span>
      )}
      {(item.title || host) && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3 pb-2.5 pt-8 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          {item.title && <span className="block text-[13px] font-medium leading-snug line-clamp-2">{item.title}</span>}
          {host && <span className="block text-[11px] opacity-75 truncate">{host}</span>}
        </span>
      )}
    </button>
  );
}

// For pages that blocked the metadata fetch: "/products/aeron-chairs/" -> "aeron chairs".
function titleFromUrl(url: string | null): string {
  if (!url) return "Untitled";
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    const words = seg ? decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, "").replace(/[-_+]+/g, " ").trim() : "";
    return words || u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PendingTile({ p }: { p: Pending }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-fill)] animate-pulse">
      {p.preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.preview} alt="" className="absolute inset-0 size-full object-cover opacity-50" />
      )}
      <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        {!p.preview && <span className="truncate max-w-[70%]">{p.label}</span>}
      </div>
    </div>
  );
}

function Composer({
  onText,
  onFiles,
  onClose,
}: {
  onText: (t: string) => void;
  onFiles: (f: File[]) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (!value.trim()) return;
    onText(value);
    setValue("");
  };
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--color-fill)] p-1.5 pl-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Paste a link, or jot a note"
        className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--color-muted-foreground)]"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        title="Add images"
        className="rounded-lg p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] pressable"
      >
        <ImagePlus className="size-4" />
      </button>
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="rounded-lg bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-30 pressable"
      >
        Save
      </button>
      <button onClick={onClose} title="Close" className="rounded-lg p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] pressable">
        <X className="size-4" />
      </button>
    </div>
  );
}

function EmptyBoard({ onHelp }: { onHelp: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-lg font-medium">Your board is empty</p>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
        Paste a link or image anywhere on this page, drag something in, or share from your phone.
      </p>
      <button onClick={onHelp} className="mt-5 rounded-lg bg-[var(--color-fill)] px-3.5 py-2 text-sm font-medium pressable">
        Set up sending from your phone
      </button>
    </div>
  );
}
