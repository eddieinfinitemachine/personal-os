"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Github,
  Globe,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import {
  bucketCards,
  type ActivityLine,
  type BoardCard,
  type ProjectsBoard,
  type SuggestedTopic,
  type Visibility,
} from "@/lib/projects/board-model";

const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]";
const CHIP_BUTTON =
  "pressable inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-accent)] disabled:opacity-50";

/** "Synced now" / "Synced 12m ago" / "Synced Oct 17" (timeAgo gives a date after a week). */
export function syncedLabel(syncedAt: string | null): string {
  if (!syncedAt) return "Never synced";
  const ago = timeAgo(syncedAt);
  // timeAgo says "0m" for 45–59 s.
  if (ago === "now" || ago === "0m") return "Synced now";
  return /^\d+[mhd]$/.test(ago) ? `Synced ${ago} ago` : `Synced ${ago}`;
}

/** "Synced 12m ago" + Refresh (founder only): runs the GitHub sync now. */
export function ProjectsSyncStatus({ syncedAt }: { syncedAt: string | null }) {
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
        setError(body.error ?? `Sync failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Sync failed: network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted-foreground)]" suppressHydrationWarning>
          {syncedLabel(syncedAt)}
        </span>
        <button type="button" onClick={refresh} disabled={busy} className={CHIP_BUTTON}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </button>
      </div>
      {error ? <span className="text-xs text-[var(--color-destructive)]">{error}</span> : null}
    </div>
  );
}

export function ProjectsBoardView({ board }: { board: ProjectsBoard }) {
  const router = useRouter();
  // Optimistic pin / hide, and suggestions already acted on, until the
  // refreshed server model lands.
  const [overrides, setOverrides] = useState<Map<string, Visibility>>(new Map());
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busyTopic, setBusyTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A refreshed model already carries the change.
  useEffect(() => {
    setOverrides(new Map());
    setHandled(new Set());
  }, [board]);

  const allCards = useMemo(
    () => [...board.groups.flatMap((g) => g.cards), ...board.dormant, ...board.hidden],
    [board],
  );
  const { groups, dormant, hidden } = useMemo(
    () =>
      bucketCards(
        allCards.map((c) => (overrides.has(c.id) ? { ...c, visibility: overrides.get(c.id)! } : c)),
        new Date(),
      ),
    [allCards, overrides],
  );
  const suggested = board.suggested.filter((s) => !handled.has(s.id));

  async function setVisibility(card: BoardCard, visibility: Visibility) {
    const previous = overrides.get(card.id);
    setError(null);
    setOverrides((m) => new Map(m).set(card.id, visibility));
    let ok = false;
    try {
      const res =
        card.kind === "project"
          ? await fetch(`/api/projects/${card.projectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ visibility }),
            })
          : await fetch(`/api/projects/sources/${card.sourceId}`, {
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

  async function actOnTopic(topic: SuggestedTopic, action: "accept" | "dismiss") {
    setBusyTopic(topic.id);
    setError(null);
    try {
      const res =
        action === "accept"
          ? await fetch(`/api/projects/sources/${topic.id}/accept`, { method: "POST" })
          : await fetch(`/api/projects/sources/${topic.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ state: "dismissed" }),
            });
      if (!res.ok) throw new Error(String(res.status));
      setHandled((s) => new Set(s).add(topic.id));
      router.refresh();
    } catch {
      setError(`Couldn't ${action} ${topic.name}. Try again.`);
    } finally {
      setBusyTopic(null);
    }
  }

  const empty = !groups.length && !suggested.length;

  return (
    <div className="space-y-8">
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      {suggested.length ? (
        <section aria-label="Suggested">
          <h2 className={cn(SECTION_LABEL, "mb-2")}>Suggested from meetings</h2>
          <div className="flex flex-wrap gap-2">
            {suggested.map((t) => (
              <div
                key={t.id}
                className="flex min-w-0 max-w-full items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
              >
                <CalendarDays className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]" suppressHydrationWarning>
                    {t.meetings} meeting{t.meetings === 1 ? "" : "s"}
                    {t.lastMeetingAt ? ` · last ${timeAgo(t.lastMeetingAt)}` : ""} · {t.company}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={CHIP_BUTTON}
                    disabled={busyTopic === t.id}
                    onClick={() => actOnTopic(t, "accept")}
                  >
                    <Check className="size-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    className={CHIP_BUTTON}
                    disabled={busyTopic === t.id}
                    onClick={() => actOnTopic(t, "dismiss")}
                  >
                    <X className="size-3.5" /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.company} aria-label={g.company}>
          <h2 className={cn(SECTION_LABEL, "mb-2")}>{g.company}</h2>
          <CardGrid cards={g.cards} onVisibility={setVisibility} />
        </section>
      ))}

      {empty ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-sm text-[var(--color-muted-foreground)]">
          Nothing active in the last 14 days.
        </p>
      ) : null}

      {dormant.length ? (
        <Collapsible label={`Dormant · ${dormant.length}`}>
          <CardGrid cards={dormant} onVisibility={setVisibility} showCompany />
        </Collapsible>
      ) : null}
      {hidden.length ? (
        <Collapsible label={`Hidden · ${hidden.length}`}>
          <CardGrid cards={hidden} onVisibility={setVisibility} showCompany />
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

function CardGrid({
  cards,
  onVisibility,
  showCompany,
}: {
  cards: BoardCard[];
  onVisibility: (card: BoardCard, v: Visibility) => void;
  showCompany?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <ProjectCard key={c.id} card={c} onVisibility={onVisibility} showCompany={showCompany} />
      ))}
    </div>
  );
}

function ActivityRow({ line }: { line: ActivityLine }) {
  const text =
    line.kind === "meeting" ? `Met: ${line.text}` : line.kind === "todo" ? `Done: ${line.text}` : line.text;
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {line.kind === "commit" && line.branch ? (
        <span className="max-w-[35%] truncate rounded bg-[var(--color-fill)] px-1.5 py-px font-mono text-[11px] text-[var(--color-muted-foreground)]" title={line.branch}>
          {line.branch}
        </span>
      ) : null}
      <span className="shrink-0 pl-1 text-xs text-[var(--color-muted-foreground)] tabular-nums" suppressHydrationWarning>
        {timeAgo(line.at)}
      </span>
    </>
  );
  return (
    <li className="min-w-0">
      {line.url ? (
        <a href={line.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline">
          {body}
        </a>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">{body}</div>
      )}
    </li>
  );
}

function ProjectCard({
  card,
  onVisibility,
  showCompany,
}: {
  card: BoardCard;
  onVisibility: (card: BoardCard, v: Visibility) => void;
  showCompany?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = card.kind === "repo" ? Github : Folder;
  const pinned = card.visibility === "pinned";
  const hiddenCard = card.visibility === "hidden";
  const more = card.planTotal - card.plan.length;

  const choose = (v: Visibility) => {
    setMenuOpen(false);
    onVisibility(card, v);
  };

  return (
    <article
      data-card-id={card.id}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
    >
      <header className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-[var(--color-muted-foreground)]" />
        <div className="min-w-0 flex-1">
          {card.href ? (
            <Link href={card.href} className="block truncate font-semibold hover:underline">
              {card.name}
            </Link>
          ) : (
            <h3 className="truncate font-semibold">{card.name}</h3>
          )}
          {showCompany ? (
            <div className="text-xs text-[var(--color-muted-foreground)]">{card.company}</div>
          ) : null}
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
              <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                {hiddenCard ? (
                  <MenuItem onClick={() => choose("auto")} icon={<Eye className="size-3.5" />} label="Unhide" />
                ) : (
                  <>
                    {pinned ? (
                      <MenuItem onClick={() => choose("auto")} icon={<PinOff className="size-3.5" />} label="Unpin" />
                    ) : (
                      <MenuItem onClick={() => choose("pinned")} icon={<Pin className="size-3.5" />} label="Pin" />
                    )}
                    <MenuItem onClick={() => choose("hidden")} icon={<EyeOff className="size-3.5" />} label="Hide" />
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {card.activity.length ? (
        <ul className="space-y-1 text-sm">
          {card.activity.map((line, i) => (
            <ActivityRow key={i} line={line} />
          ))}
        </ul>
      ) : null}

      {card.plan.length ? (
        <div>
          <div className={cn(SECTION_LABEL, "mb-1")}>Plan</div>
          <ul className="space-y-0.5 text-sm text-[var(--color-label-secondary)]">
            {card.plan.map((p, i) => (
              <li key={i} className="flex min-w-0 items-start gap-1.5" title={p.section ?? undefined}>
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full border border-[var(--color-muted-foreground)]" />
                <span className="line-clamp-2">{p.text}</span>
              </li>
            ))}
          </ul>
          {more > 0 ? <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">+{more} more</div> : null}
        </div>
      ) : null}

      {card.githubUrl || card.homepageUrl || card.href ? (
        <footer className="mt-auto flex flex-wrap gap-3 text-xs text-[var(--color-muted-foreground)]">
          {card.githubUrl ? (
            <a href={card.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]">
              <Github className="size-3.5" /> GitHub
            </a>
          ) : null}
          {card.homepageUrl ? (
            <a href={card.homepageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]">
              <Globe className="size-3.5" /> Site
            </a>
          ) : null}
          {card.href ? (
            <Link href={card.href} className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]">
              <Folder className="size-3.5" /> Open
            </Link>
          ) : null}
        </footer>
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
