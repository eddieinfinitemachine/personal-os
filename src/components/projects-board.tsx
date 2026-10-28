"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Mail,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import {
  bucketCards,
  evidenceCounts,
  type BoardCard,
  type ProjectsBoard,
  type Visibility,
} from "@/lib/projects/board-model";
import { EVIDENCE_KINDS, type EvidenceKind, type StoredEvidence } from "@/lib/projects/signals/types";

const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]";
const CHIP_BUTTON =
  "pressable inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-accent)] disabled:opacity-50";

const KIND_ICON: Record<EvidenceKind, typeof Mail> = {
  meeting: CalendarDays,
  email: Mail,
  todo: CheckSquare,
  note: FileText,
};
const KIND_NOUN: Record<EvidenceKind, [string, string]> = {
  meeting: ["meeting", "meetings"],
  email: ["email", "emails"],
  todo: ["todo", "todos"],
  note: ["note", "notes"],
};

/** "now" / "5m" / "2d" / "Oct 3" for past times; "in 3h" / "in 2d" for upcoming ones (timeAgo says "now"). */
export function whenLabel(at: string, now = Date.now()): string {
  const ms = Date.parse(at) - now;
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return timeAgo(at);
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h`;
  return `in ${Math.floor(hr / 24)}d`;
}

/** "3 meetings · 9 emails · 2 todos" */
export function countsLabel(evidence: StoredEvidence[]): string {
  const counts = evidenceCounts(evidence);
  return EVIDENCE_KINDS.filter((k) => counts[k])
    .map((k) => `${counts[k]} ${KIND_NOUN[k][counts[k] === 1 ? 0 : 1]}`)
    .join(" · ");
}

const shortDate = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "Synced now" / "Synced 12m ago" / "Synced Oct 17" (timeAgo gives a date after a week). */
export function syncedLabel(syncedAt: string | null): string {
  if (!syncedAt) return "Never synced";
  const ago = timeAgo(syncedAt);
  // timeAgo says "0m" for 45–59 s.
  if (ago === "now" || ago === "0m") return "Synced now";
  return /^\d+[mhd]$/.test(ago) ? `Synced ${ago} ago` : `Synced ${ago}`;
}

/** "Last refresh failed · showing 3h ago" */
export function failedLabel(syncedAt: string | null): string {
  if (!syncedAt) return "Last refresh failed";
  const ago = timeAgo(syncedAt);
  const when = ago === "now" || ago === "0m" ? "just now" : /^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago;
  return `Last refresh failed · showing ${when}`;
}

/** "Synced 12m ago" + Refresh (founder only): runs the inference now. */
export function ProjectsSyncStatus({ syncedAt, refreshFailed }: { syncedAt: string | null; refreshFailed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/sync", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Refresh failed (${res.status})`);
      }
      // A failed run is recorded on the board too, so refresh either way.
      router.refresh();
    } catch {
      setError("Refresh failed: network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span
          className={cn("text-right text-xs", refreshFailed ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]")}
          suppressHydrationWarning
        >
          {refreshFailed ? failedLabel(syncedAt) : syncedLabel(syncedAt)}
        </span>
        <button type="button" onClick={refresh} disabled={busy} className={CHIP_BUTTON}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {busy ? "Refreshing… about a minute" : "Refresh"}
        </button>
      </div>
      {error ? <span className="text-xs text-[var(--color-destructive)]">{error}</span> : null}
    </div>
  );
}

export function ProjectsBoardView({ board }: { board: ProjectsBoard }) {
  const router = useRouter();
  // Optimistic pin / hide until the refreshed server model lands.
  const [overrides, setOverrides] = useState<Map<string, Visibility>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // A refreshed model already carries the change: drop the overrides when it
  // lands (reset during render, not in an effect).
  const [overridesFor, setOverridesFor] = useState(board);
  if (overridesFor !== board) {
    setOverridesFor(board);
    setOverrides(new Map());
  }

  const allCards = useMemo(() => [...board.cards, ...board.hidden], [board]);
  const { cards, hidden } = useMemo(
    () => bucketCards(allCards.map((c) => (overrides.has(c.id) ? { ...c, visibility: overrides.get(c.id)! } : c))),
    [allCards, overrides],
  );

  async function setVisibility(card: BoardCard, visibility: Visibility) {
    const previous = overrides.get(card.id);
    setError(null);
    setOverrides((m) => new Map(m).set(card.id, visibility));
    let ok = false;
    try {
      const res = await fetch(`/api/projects/sources/${card.sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: visibility }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setOverrides((m) => {
        const next = new Map(m);
        if (previous) next.set(card.id, previous);
        else next.delete(card.id);
        return next;
      });
      setError(`Couldn't update ${card.name}. Try again.`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {cards.length ? (
        <CardGrid cards={cards} onVisibility={setVisibility} />
      ) : (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-sm text-[var(--color-muted-foreground)]">
          No projects inferred yet.
        </p>
      )}

      {hidden.length ? (
        <Collapsible label={`Hidden · ${hidden.length}`}>
          <CardGrid cards={hidden} onVisibility={setVisibility} />
        </Collapsible>
      ) : null}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className={cn(SECTION_LABEL, "mb-2 flex cursor-pointer list-none items-center gap-1 select-none")}>
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      {children}
    </details>
  );
}

function CardGrid({ cards, onVisibility }: { cards: BoardCard[]; onVisibility: (card: BoardCard, v: Visibility) => void }) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <ProjectCard key={c.id} card={c} onVisibility={onVisibility} />
      ))}
    </div>
  );
}

function EvidenceRow({ item }: { item: StoredEvidence }) {
  const Icon = KIND_ICON[item.kind];
  const external = !!item.url && /^https?:/.test(item.url);
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-label={item.kind} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="shrink-0 pl-1 text-xs text-[var(--color-muted-foreground)] tabular-nums" suppressHydrationWarning>
        {whenLabel(item.at)}
      </span>
    </>
  );
  return (
    <li className="min-w-0">
      {item.url ? (
        <a
          href={item.url}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          className="flex min-w-0 items-center gap-1.5 hover:underline"
        >
          {body}
        </a>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">{body}</div>
      )}
    </li>
  );
}

function ProjectCard({ card, onVisibility }: { card: BoardCard; onVisibility: (card: BoardCard, v: Visibility) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const pinned = card.visibility === "pinned";
  const hiddenCard = card.visibility === "hidden";

  const choose = (v: Visibility) => {
    setMenuOpen(false);
    onVisibility(card, v);
  };

  return (
    <article
      data-card-id={card.id}
      className="flex min-w-0 flex-col gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{card.name}</h3>
          <div className="text-xs text-[var(--color-muted-foreground)]">{card.company}</div>
        </div>
        {pinned ? <Pin className="mt-0.5 size-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-label="Pinned" /> : null}
        {card.lastActivityAt ? (
          <span className="mt-0.5 shrink-0 text-xs text-[var(--color-muted-foreground)] tabular-nums" suppressHydrationWarning>
            {timeAgo(card.lastActivityAt)}
          </span>
        ) : null}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`More actions for ${card.name}`}
            className="pressable -mr-1 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close menu"
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                {hiddenCard ? (
                  <MenuItem onClick={() => choose("auto")} icon={<Eye className="size-3.5" />} label="Unhide" />
                ) : (
                  <>
                    {pinned ? (
                      <MenuItem onClick={() => choose("auto")} icon={<PinOff className="size-3.5" />} label="Unpin" />
                    ) : (
                      <MenuItem onClick={() => choose("pinned")} icon={<Pin className="size-3.5" />} label="Pin" />
                    )}
                    <MenuItem onClick={() => choose("hidden")} icon={<EyeOff className="size-3.5" />} label="Not a project" />
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {card.status ? <p className="text-sm">{card.status}</p> : null}
      {card.next ? (
        <p className="text-sm text-[var(--color-label-secondary)]">
          <span className="font-medium text-[var(--color-foreground)]">Next:</span> {card.next}
        </p>
      ) : null}
      {card.stale && card.lastActivityAt ? (
        <p className="text-xs text-[var(--color-muted-foreground)]" suppressHydrationWarning>
          No activity since {shortDate(card.lastActivityAt)}
        </p>
      ) : null}

      {card.evidence.length ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="pressable -mx-1 inline-flex items-center gap-1 rounded px-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {countsLabel(card.evidence)}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open ? (
            <ul className="mt-1.5 space-y-1 text-sm">
              {card.evidence.map((item) => (
                <EvidenceRow key={item.ref} item={item} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function MenuItem({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-accent)]"
    >
      {icon} {label}
    </button>
  );
}
