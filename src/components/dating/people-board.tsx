"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Columns3, Instagram, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, instagramUrl, isStage, type Stage } from "@/lib/dating";
import {
  defaultView,
  groupByStage,
  parseView,
  shortDate,
  spanLabel,
  vibeTone,
  withStage,
  type BoardView,
} from "@/lib/dating-board";
import { initials } from "@/lib/initials";
import type { DatingPersonDTO } from "@/lib/dating-server";

export type DatingCard = DatingPersonDTO & {
  dateCount: number;
  avgVibe: number | null;
  /** Newest photo, shown as a small round avatar. */
  avatarUrl: string | null;
  /** Earliest and latest event of any kind. */
  firstEventAt: string | null;
  lastEventAt: string | null;
  /** The latest event of kind "date". */
  lastDate: { at: string; vibe: number | null } | null;
};

const VIEW_KEY = "personalos:dating-view";
const ENDED_KEY = "personalos:dating-ended-open";
const DRAG_TYPE = "application/x-dating-person";

const LABEL: Record<Stage, string> = {
  talking: "Talking",
  dating: "Dating",
  exclusive: "Exclusive",
  paused: "Paused",
  ended: "Ended",
};
const EMPTY_HINT: Partial<Record<Stage, string>> = {
  talking: "No one you're talking to yet.",
  dating: "No one you're dating right now.",
};

const card = "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]";
const heading = "text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Everyone as a card grouped by stage, as a kanban board or as horizontal
 * rows. Moving a card (drag on the board, or the "Move to…" menu on any
 * card) PATCHes the stage optimistically and reverts with a toast if it fails.
 */
export function PeopleBoard({ people }: { people: DatingCard[] }) {
  // null until mounted: the server can't know the width, so both views render
  // and CSS picks one (board ≥ lg). A saved choice replaces that after mount.
  const [view, setView] = useState<BoardView | null>(null);
  const [wide, setWide] = useState(false);
  const [endedOpen, setEndedOpen] = useState(false);
  // Optimistic stage changes on top of the server props, by person id.
  const [moved, setMoved] = useState<Record<string, DatingCard>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setView(parseView(readStorage(VIEW_KEY)));
    setEndedOpen(readStorage(ENDED_KEY) === "1");
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const active = view ?? defaultView(wide ? 1024 : 0);
  const choose = (v: BoardView) => {
    setView(v);
    writeStorage(VIEW_KEY, v);
  };
  const toggleEnded = () => {
    setEndedOpen((o) => {
      writeStorage(ENDED_KEY, o ? "0" : "1");
      return !o;
    });
  };

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const current = people.map((p) => moved[p.id] ?? p);
  const groups = groupByStage(current);

  const move = async (id: string, stage: Stage) => {
    const p = current.find((x) => x.id === id);
    if (!p || p.stage === stage) return;
    const prev = moved[id];
    setMoved((m) => ({ ...m, [id]: withStage(p, stage) }));
    const res = await fetch(`/api/dating/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && data.person) {
      // Keep the server's copy of what changed (endedAt is stamped there).
      setMoved((m) => ({ ...m, [id]: { ...p, stage: data.person.stage, endedAt: data.person.endedAt } }));
      return;
    }
    setMoved((m) => {
      const next = { ...m };
      if (prev) next[id] = prev;
      else delete next[id];
      return next;
    });
    showToast(`Couldn't move ${p.name} to ${LABEL[stage]}${data.error ? `: ${data.error}` : ""}`);
  };

  const shared = { groups, move, endedOpen, toggleEnded };

  return (
    <section className="mb-8" aria-label="People">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={heading}>People</h2>
        <div role="group" aria-label="View" className="inline-flex rounded-lg bg-[var(--color-fill)] p-0.5">
          {(
            [
              ["board", "Board", Columns3],
              ["rows", "Rows", Rows3],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              aria-pressed={active === v}
              onClick={() => choose(v)}
              className={cn(
                "pressable inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition md:min-h-8",
                active === v
                  ? "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-card"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === null ? (
        <>
          <div className="hidden lg:block">
            <Board {...shared} />
          </div>
          <div className="lg:hidden">
            <Rows {...shared} />
          </div>
        </>
      ) : view === "board" ? (
        <Board {...shared} />
      ) : (
        <Rows {...shared} />
      )}

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-50 max-w-[calc(100vw-2rem)] rounded-full px-4 py-2 text-sm shadow-popover bg-[var(--color-destructive)] text-white"
        >
          {toast}
        </div>
      )}
    </section>
  );
}

type ViewProps = {
  groups: Record<Stage, DatingCard[]>;
  move: (id: string, stage: Stage) => void;
  endedOpen: boolean;
  toggleEnded: () => void;
};

function Board({ groups, move, endedOpen, toggleEnded }: ViewProps) {
  const [over, setOver] = useState<Stage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const drop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) move(id, stage);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
      <div className="flex min-w-max gap-3 lg:min-w-0">
        {STAGES.map((stage) => {
          const people = groups[stage];
          const collapsed = stage === "ended" && !endedOpen && people.length > 0;
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== stage) setOver(stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={drop(stage)}
              aria-label={`${LABEL[stage]}, ${people.length}`}
              className={cn(
                "flex flex-col rounded-xl bg-[var(--color-fill-secondary)] p-2 transition-colors",
                collapsed ? "w-36 shrink-0" : "w-60 shrink-0 lg:w-auto lg:min-w-[13.5rem] lg:flex-1 lg:basis-0",
                over === stage && "ring-2 ring-[var(--color-ring)] bg-[var(--color-fill)]",
              )}
            >
              <div className="flex items-center justify-between gap-2 px-1.5 pb-2 pt-1">
                <h3 className="text-sm font-semibold">
                  {LABEL[stage]} <span className="font-normal tabular-nums text-[var(--color-muted-foreground)]">{people.length}</span>
                </h3>
                {stage === "ended" && people.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleEnded}
                    aria-expanded={endedOpen}
                    className="inline-flex min-h-8 items-center gap-0.5 rounded-md px-1.5 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                  >
                    {endedOpen ? "Hide" : `Show ${people.length}`}
                    {endedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                )}
              </div>
              {collapsed ? (
                <p className="px-1.5 pb-1 text-xs text-[var(--color-label-tertiary)]">Drop a card here to end it.</p>
              ) : (
                <ul className="flex max-h-[70vh] min-h-24 flex-col gap-2 overflow-y-auto">
                  {people.map((p) => (
                    <li
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, p.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(p.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={cn("cursor-grab active:cursor-grabbing", dragging === p.id && "opacity-40")}
                    >
                      <PersonCard p={p} move={move} />
                    </li>
                  ))}
                  {!people.length && (
                    <li className="rounded-lg border border-dashed border-[var(--color-card-border)] px-2 py-4 text-center text-xs text-[var(--color-label-tertiary)]">
                      Drag someone here
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Rows({ groups, move, endedOpen, toggleEnded }: ViewProps) {
  return (
    <div className="space-y-5">
      {STAGES.map((stage) => {
        const people = groups[stage];
        const hint = EMPTY_HINT[stage];
        if (!people.length && !hint) return null;
        const collapsed = stage === "ended" && !endedOpen;
        return (
          <div key={stage}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {LABEL[stage]} <span className="font-normal tabular-nums text-[var(--color-muted-foreground)]">{people.length}</span>
              </h3>
              {stage === "ended" && (
                <button
                  type="button"
                  onClick={toggleEnded}
                  aria-expanded={endedOpen}
                  className="inline-flex min-h-11 items-center gap-0.5 rounded-md px-2 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] md:min-h-8"
                >
                  {endedOpen ? "Hide" : `Show ${people.length}`}
                  {endedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
              )}
            </div>
            {!people.length ? (
              <p className="text-sm text-[var(--color-label-tertiary)]">{hint}</p>
            ) : collapsed ? null : (
              <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:-mx-8 md:scroll-px-8 md:px-8">
                {people.map((p) => (
                  <li key={p.id} className="w-64 shrink-0 snap-start">
                    <PersonCard p={p} move={move} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

const TONE = {
  good: "bg-[var(--color-success)]",
  ok: "bg-[var(--color-warning)]",
  low: "bg-[var(--color-destructive)]",
} as const;

function PersonCard({ p, move }: { p: DatingCard; move: (id: string, stage: Stage) => void }) {
  const remember = p.remember[0];
  const facts = [
    p.lastMessageAt && `Texted ${shortDate(p.lastMessageAt)}`,
    p.dateCount > 0 && `${p.dateCount} date${p.dateCount === 1 ? "" : "s"}`,
  ].filter(Boolean);
  // The name link stretches over the whole card (after:inset-0) so the
  // Instagram link and stage menu can sit inside it without nesting.
  return (
    <div className={cn(card, "relative p-3 transition hover:bg-[var(--color-fill-secondary)]")}>
      <div className="flex items-start gap-2.5">
        {p.avatarUrl ? (
          // Fixed size, so nothing moves while the image loads.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.avatarUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-9 shrink-0 rounded-full bg-[var(--color-fill)] object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-fill)] text-xs font-semibold text-[var(--color-muted-foreground)]"
          >
            {initials(p.name) || "?"}
          </span>
        )}
        <Link
          href={`/dating/${p.id}`}
          draggable={false}
          className="min-w-0 flex-1 self-center break-words font-semibold leading-snug line-clamp-2 after:absolute after:inset-0 after:rounded-xl"
        >
          {p.name}
        </Link>
        <div className="-mr-1.5 -mt-1.5 flex shrink-0 items-center">
          {p.instagram && (
            <a
              href={instagramUrl(p.instagram)}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              aria-label={`@${p.instagram} on Instagram`}
              title={`@${p.instagram}`}
              className="relative z-10 grid size-11 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] md:size-8"
            >
              <Instagram className="size-4" />
            </a>
          )}
          <StageMenu p={p} move={move} />
        </div>
      </div>

      {/* The date range is the card's main subline, on its own line so it never truncates. */}
      <div className="mt-2 text-sm font-medium tabular-nums text-[var(--color-foreground)]">{spanLabel(p)}</div>
      <div className="mt-1 space-y-0.5 text-xs tabular-nums text-[var(--color-muted-foreground)]">
        {p.lastDate && (
          <div className="truncate">
            Last date {shortDate(p.lastDate.at)}
            {p.lastDate.vibe !== null && <span className="text-[var(--color-foreground)]"> · {p.lastDate.vibe}/10</span>}
          </div>
        )}
        {(facts.length > 0 || p.avgVibe !== null) && (
          <div className="flex items-center gap-2">
            {facts.length > 0 && <span className="min-w-0 truncate">{facts.join(" · ")}</span>}
            {p.avgVibe !== null && (
              <span
                className="ml-auto inline-flex shrink-0 items-center gap-1"
                title={`Average vibe ${p.avgVibe.toFixed(1)} of 10`}
                aria-label={`Average vibe ${p.avgVibe.toFixed(1)} of 10`}
              >
                <span className={cn("size-1.5 rounded-full", TONE[vibeTone(p.avgVibe)])} />
                {p.avgVibe.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>
      {remember && <p className="mt-1.5 truncate text-xs text-[var(--color-label-tertiary)]">{remember}</p>}
    </div>
  );
}

// A native <select> under an icon: keyboard and touch friendly for free, and
// the phone's own picker on mobile. Also the non-drag way to move a card.
function StageMenu({ p, move }: { p: DatingCard; move: (id: string, stage: Stage) => void }) {
  return (
    <label
      title="Move to…"
      className="relative z-10 grid size-11 place-items-center rounded-full text-[var(--color-muted-foreground)] focus-within:ring-2 focus-within:ring-[var(--color-ring)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] md:size-8"
    >
      <ArrowRightLeft className="size-4" />
      <span className="sr-only">Move {p.name} to…</span>
      <select
        value=""
        onChange={(e) => {
          if (isStage(e.target.value)) move(p.id, e.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          Move to…
        </option>
        {STAGES.filter((s) => s !== p.stage).map((s) => (
          <option key={s} value={s}>
            {LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
