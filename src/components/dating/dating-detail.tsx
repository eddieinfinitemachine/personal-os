"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Instagram, Loader2, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EVENT_KINDS,
  STAGES,
  datesLine,
  instagramUrl,
  journalExternalId,
  keyDates,
  normalizeInstagram,
  splitSourceLine,
  threadStats,
  type EventKind,
} from "@/lib/dating";
import { initials } from "@/lib/initials";
import type { DatingEventDTO, DatingMessageDTO, DatingPersonDTO } from "@/lib/dating-server";
import type { DatingPhotoDTO } from "@/lib/dating-photos";
import { SOURCE_LABELS } from "@/lib/dating-message-sync";
import { DictateCard } from "./dictate-card";
import { ListEditor } from "./list-editor";
import { PhotoStrip } from "./photo-strip";
import { RelationshipChart } from "./relationship-chart";
import { SyncHelp } from "./sync-help";

type Meta = { sentAt: string; fromMe: boolean };
type Patch = (fields: Partial<Record<keyof DatingPersonDTO, unknown>>) => Promise<void>;

const input =
  "w-full rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const card = "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4";
const btn =
  "pressable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50";
const ghost =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";
// Ghost buttons that sit alone get a 44px hit area on touch screens.
const tap = "min-h-11 sm:min-h-0";

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtMin = (m: number | null) =>
  m === null ? "n/a" : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
const byDay = (a: DatingEventDTO, b: DatingEventDTO) => a.occurredAt.localeCompare(b.occurredAt);

const MORE_KEY = "dating:detail-more-open";

/**
 * One page per person, kept short: header (photo, name, stage, one line of
 * dates), then Dictate, Summary and Timeline. Everything else (photos, stats,
 * notes, details, messages) sits in one "More" disclosure. Sections keep their
 * ids (#insights, #timeline, #photos, #chart, #notes, #details, #messages);
 * a hash pointing inside More opens it.
 */
export function DatingDetail({
  initialPerson,
  initialEvents,
  initialMessages,
  initialMore,
  initialPhotos = [],
  meta: initialMeta,
}: {
  initialPerson: DatingPersonDTO;
  initialEvents: DatingEventDTO[];
  initialMessages: DatingMessageDTO[];
  initialMore: boolean;
  initialPhotos?: DatingPhotoDTO[];
  meta: Meta[];
}) {
  const router = useRouter();
  const [person, setPerson] = useState(initialPerson);
  const [events, setEvents] = useState(initialEvents);
  const [meta, setMeta] = useState(initialMeta);
  const [photos, setPhotos] = useState(initialPhotos);
  const [error, setError] = useState<string | null>(null);
  const [organized, setOrganized] = useState<string | null>(null);
  const first = person.name.split(/\s+/)[0];

  const patch: Patch = useCallback(
    async (fields) => {
      setPerson((p) => ({ ...p, ...(fields as Partial<DatingPersonDTO>) }));
      const res = await fetch(`/api/dating/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Could not save");
      setPerson(data.person);
      setError(null);
    },
    [person.id],
  );

  // --- More disclosure -------------------------------------------------------
  const [moreOpen, setMoreOpen] = useState(false);
  const [jump, setJump] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    try {
      localStorage.setItem(MORE_KEY, next ? "1" : "0");
    } catch {
      // Private window or blocked storage: it just won't be remembered.
    }
  };
  const openTo = (id: string) => {
    setMoreOpen(true);
    setJump(id);
  };
  useEffect(() => {
    // Read after mount: the server render can't see localStorage.
    try {
      if (localStorage.getItem(MORE_KEY) === "1") setMoreOpen(true);
    } catch {
      // Ignore; More stays closed.
    }
    const sync = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el && moreRef.current?.contains(el)) {
        setMoreOpen(true);
        setJump(id);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  // Scroll once the section is visible (it was hidden when the browser tried).
  useEffect(() => {
    if (!jump || !moreOpen) return;
    document.getElementById(jump)?.scrollIntoView({ block: "start" });
    setJump(null);
  }, [jump, moreOpen]);

  const stats = useMemo(() => threadStats(meta), [meta]);
  const line = datesLine(keyDates(person, events));
  const journalDone = events.some((e) => e.externalId === journalExternalId(person.id));

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-3xl space-y-10">
      <div>
        <Link href="/dating" className={cn(ghost, tap, "-ml-2.5 mb-3")}>
          <ChevronLeft className="size-4" /> Dating
        </Link>
        <header className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => openTo("photos")}
            aria-label={photos.length ? `Photos of ${first}` : `Add a photo of ${first}`}
            className="pressable shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <Avatar name={person.name} photo={photos[0]?.url} />
          </button>
          <div className="min-w-0 flex-1">
            <NameHeading name={person.name} onRename={(name) => patch({ name })} setError={setError} />
            <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
              <select
                value={person.stage}
                onChange={(e) => patch({ stage: e.target.value })}
                aria-label="Stage"
                className="h-11 rounded-full bg-[var(--color-fill-secondary)] px-3 text-sm capitalize outline-none focus:ring-2 focus:ring-[var(--color-ring)] sm:h-8"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {person.instagram && (
                <a
                  href={instagramUrl(person.instagram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`@${person.instagram} on Instagram`}
                  title={`@${person.instagram}`}
                  className="inline-flex size-11 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] sm:size-8"
                >
                  <Instagram className="size-4" />
                </a>
              )}
            </div>
          </div>
        </header>
        {line && <p className="mt-3 text-sm tabular-nums text-[var(--color-muted-foreground)]">{line}</p>}
      </div>

      <DictateCard
        personId={person.id}
        firstName={first}
        onSaved={({ people, events: added }) => {
          const updated = people.find((p) => p.id === person.id);
          if (updated) setPerson(updated);
          setEvents((list) => [...list.filter((e) => !added.some((a) => a.id === e.id)), ...added].sort(byDay));
        }}
      />

      <Summary
        person={person}
        setPerson={setPerson}
        patch={patch}
        setError={setError}
        organize={
          <>
            {!!person.notes?.trim() && !journalDone && (
              <OrganizeNotes
                personId={person.id}
                setError={setError}
                onDone={(r) => {
                  setPerson(r.person);
                  setEvents([...r.events].sort(byDay));
                  setOrganized(r.summary);
                }}
              />
            )}
            {organized && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
                <Sparkles className="size-4 shrink-0" /> Organized your notes. {organized}.
              </p>
            )}
          </>
        }
      />

      <Timeline personId={person.id} events={events} setEvents={setEvents} setError={setError} />

      <section id="more" className="scroll-mt-4 border-t border-[var(--color-separator)] pt-2">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="more-body"
          onClick={toggleMore}
          className="flex min-h-11 w-full items-center gap-2 py-2 text-left"
        >
          <span className="text-headline font-semibold">More</span>
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-label-tertiary)]">
            Photos, stats, notes, details, messages
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform", moreOpen && "rotate-180")} />
        </button>
        {/* Always mounted (hidden when closed) so photo paste/drop and anchors keep working. */}
        <div id="more-body" ref={moreRef} hidden={!moreOpen} className="mt-6 space-y-10">
          <div id="photos" className="scroll-mt-4">
            <PhotoStrip personId={person.id} firstName={first} photos={photos} setPhotos={setPhotos} setError={setError} />
          </div>

          <Section id="chart" title="How it's going">
            {stats.total > 0 && (
              <dl className="grid grid-cols-3 gap-4">
                <Stat label="Messages" value={stats.total.toLocaleString()} sub={`${Math.round((stats.mine / stats.total) * 100)}% from you`} />
                <Stat
                  label="You start"
                  value={stats.iInitiate === null ? "n/a" : `${Math.round(stats.iInitiate * 100)}%`}
                  sub={`of ${stats.conversations} conversations`}
                />
                <Stat label="Median reply" value={`${fmtMin(stats.myReplyMin)} / ${fmtMin(stats.theirReplyMin)}`} sub={`you / ${first}`} />
              </dl>
            )}
            <RelationshipChart messages={meta} events={events} name={first} metAt={person.metAt} />
          </Section>

          <Section id="notes" title="Notes & lessons">
            <Notes person={person} patch={patch} />
          </Section>

          <Section id="details" title="Details">
            <Details
              person={person}
              patch={patch}
              setError={setError}
              onDelete={async () => {
                if (!confirm(`Delete ${person.name} and all notes, timeline and messages?`)) return;
                const res = await fetch(`/api/dating/${person.id}`, { method: "DELETE" });
                if (res.ok) router.push("/dating");
                else setError("Could not delete");
              }}
            />
          </Section>

          <MessagesSection count={stats.total}>
            <Messages
              person={person}
              first={first}
              initialMessages={initialMessages}
              initialMore={initialMore}
              onImported={() => router.refresh()}
              setMeta={setMeta}
              setError={setError}
            />
          </MessagesSection>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-start gap-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2.5 text-sm text-[var(--color-destructive)] shadow-lg"
        >
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, photo }: { name: string; photo?: string }) {
  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-fill)] flex items-center justify-center text-xl font-semibold text-[var(--color-muted-foreground)]">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        initials(name) || "?"
      )}
    </div>
  );
}

// The name is the page title; click it (or the pencil) to rename in place.
// Enter or leaving the field saves, Esc cancels, an empty name is refused.
function NameHeading({
  name,
  onRename,
  setError,
}: {
  name: string;
  onRename: (name: string) => void;
  setError: (e: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // Set once Enter/Esc/blur has handled the edit, so the follow-up blur is a no-op.
  const settled = useRef(false);
  const start = () => {
    setDraft(name);
    settled.current = false;
    setEditing(true);
  };
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (!save) return;
    const next = draft.trim();
    if (!next) return setError("Name can't be empty");
    if (next !== name) onRename(next);
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
        aria-label="Name"
        className="-ml-2 w-[calc(100%+0.5rem)] min-w-0 rounded-md bg-[var(--color-fill-secondary)] px-2 text-large-title font-bold outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center">
      <h1 onClick={start} className="min-w-0 cursor-text text-large-title font-bold break-words">
        {name}
      </h1>
      <button
        type="button"
        onClick={start}
        aria-label="Rename"
        title="Rename"
        className="ml-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--color-label-tertiary)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] sm:size-8"
      >
        <Pencil className="size-4" />
      </button>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-headline font-semibold">
          {title}
          {!!count && <span className="ml-1.5 font-normal text-[var(--color-label-tertiary)]">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Messages start collapsed (they're long); #messages in the URL opens them.
function MessagesSection({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept, so collapsing doesn't lose a search or paste.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#messages") {
        setOpen(true);
        setMounted(true);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return (
    <section id="messages" className="scroll-mt-4 space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="messages-body"
        onClick={() => {
          setOpen((o) => !o);
          setMounted(true);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-headline font-semibold">
          Messages
          {count > 0 && <span className="ml-1.5 font-normal text-[var(--color-label-tertiary)]">{count.toLocaleString()}</span>}
        </span>
        <ChevronDown className={cn("size-4 text-[var(--color-muted-foreground)] transition-transform", open && "rotate-180")} />
      </button>
      <div id="messages-body" hidden={!open}>
        {mounted && children}
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="text-lg sm:text-xl font-semibold tabular-nums mt-0.5 truncate">{value}</dd>
      <dd className="text-xs text-[var(--color-label-tertiary)] mt-0.5 truncate">{sub}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Organized = { summary: string; person: DatingPersonDTO; events: DatingEventDTO[] };

// Shown only while there are journal notes Claude hasn't filed yet.
function OrganizeNotes({
  personId,
  onDone,
  setError,
}: {
  personId: string;
  onDone: (r: Organized) => void;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const res = await fetch(`/api/dating/${personId}/organize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ today }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? "Could not organize the notes");
    setError(null);
    onDone({ summary: data.result.summary, person: data.person, events: data.events });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--color-fill-secondary)] px-3 py-2">
      <p className="min-w-0 flex-1 basis-48 text-sm text-[var(--color-muted-foreground)]">
        Your notes aren&apos;t on the timeline yet. Claude can turn them into dates, flags and lessons.
      </p>
      <button onClick={run} disabled={busy} className={cn(ghost, tap, "-mr-1.5 text-[var(--color-foreground)]")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "Organizing…" : "Organize notes"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Claude's read up top, then the three lists it feeds. Claude's list
// suggestions show inside each list until added.
function Summary({
  person,
  setPerson,
  patch,
  setError,
  organize,
}: {
  person: DatingPersonDTO;
  setPerson: (p: DatingPersonDTO) => void;
  patch: Patch;
  setError: (e: string | null) => void;
  organize: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const ins = person.insights;
  const run = async () => {
    setBusy(true);
    const res = await fetch(`/api/dating/${person.id}/insights`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not read the thread");
    setPerson(data.person);
    setError(null);
  };
  const fresh = (items: string[] | undefined, have: string[]) => (items ?? []).filter((i) => !have.includes(i));
  return (
    <Section
      id="insights"
      title="Summary"
      action={
        ins && (
          <button onClick={run} disabled={busy} className={cn(ghost, tap, "-mr-2.5")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Refresh
          </button>
        )
      }
    >
      {ins ? (
        <div className="space-y-1">
          {ins.summary && <p className="text-[15px] leading-relaxed">{ins.summary}</p>}
          {person.insightsAt && (
            <p className="text-xs text-[var(--color-label-tertiary)]">Claude&apos;s read, {fmtDate(person.insightsAt)}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Claude reads your messages, timeline and notes, sums up where things stand and suggests what to remember.
          </p>
          <button onClick={run} disabled={busy} className={cn(btn, tap)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "Reading…" : "Read everything with Claude"}
          </button>
        </div>
      )}

      {organize}

      <div className="grid gap-5 pt-2 sm:grid-cols-3">
        <ListEditor
          title="Remember"
          items={person.remember}
          suggestions={fresh(ins?.remember, person.remember)}
          placeholder="Sister is Maya, hates cilantro"
          onChange={(remember) => patch({ remember })}
        />
        <ListEditor
          title="Green flags"
          tone="good"
          items={person.greenFlags}
          suggestions={fresh(ins?.greenFlags, person.greenFlags)}
          placeholder="Plans the next date"
          onChange={(greenFlags) => patch({ greenFlags })}
        />
        <ListEditor
          title="Red flags"
          tone="bad"
          items={person.redFlags}
          suggestions={fresh(ins?.redFlags, person.redFlags)}
          placeholder="Cancels last minute"
          onChange={(redFlags) => patch({ redFlags })}
        />
      </div>

      {ins && (!!ins.ideas?.length || !!ins.lessons) && (
        <details className="group pt-1">
          <summary className={cn(ghost, tap, "-ml-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
            <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
            Ideas and a lesson from Claude
          </summary>
          <div className="mt-2 space-y-3 pl-1">
            {!!ins.ideas?.length && (
              <div>
                <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Ideas</div>
                <ul className="list-disc pl-5 text-sm space-y-0.5">
                  {ins.ideas.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}
            {ins.lessons && (
              <div>
                <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Lesson</div>
                <p className="text-sm">{ins.lessons}</p>
                {!person.lessons?.includes(ins.lessons) && (
                  <button
                    onClick={() => patch({ lessons: [person.lessons, ins.lessons].filter(Boolean).join("\n\n") })}
                    className={cn(ghost, tap, "-ml-2.5 mt-1")}
                  >
                    <Plus className="size-3.5" /> Add to my lessons
                  </button>
                )}
              </div>
            )}
          </div>
        </details>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

type Draft = { id?: string; occurredAt: string; kind: EventKind; title: string; notes: string; vibe: number | null };
const emptyDraft = (): Draft => ({
  occurredAt: new Date().toISOString().slice(0, 10),
  kind: "date",
  title: "",
  notes: "",
  vibe: null,
});

// Newest first, one line each; tap a row to edit it. The form opens inline.
function Timeline({
  personId,
  events,
  setEvents,
  setError,
}: {
  personId: string;
  events: DatingEventDTO[];
  setEvents: (fn: (e: DatingEventDTO[]) => DatingEventDTO[]) => void;
  setError: (e: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const year = new Date().getFullYear();
  const short = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== year && { year: "2-digit" }) });
  };

  const openForm = (d: Draft) => {
    setDraft(d);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    // Noon local keeps the day stable across time zones.
    const occurredAt = new Date(`${draft.occurredAt}T12:00:00`).toISOString();
    const body = JSON.stringify({ ...draft, occurredAt });
    const res = draft.id
      ? await fetch(`/api/dating/events/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
      : await fetch(`/api/dating/${personId}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save");
    setEvents((list) => [...list.filter((e) => e.id !== data.event.id), data.event].sort(byDay));
    setDraft(null);
    setError(null);
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/dating/events/${id}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not delete");
    setEvents((list) => list.filter((e) => e.id !== id));
    setDraft(null);
  };

  return (
    <Section
      id="timeline"
      title="Timeline"
      count={events.length}
      action={
        !draft && (
          <button type="button" onClick={() => openForm(emptyDraft())} className={cn(ghost, tap, "-mr-2.5")}>
            <Plus className="size-4" /> Add
          </button>
        )
      }
    >
      {draft && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className={cn(card, "scroll-mt-4 space-y-2.5")}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{draft.id ? "Edit moment" : "Add a moment"}</h3>
            <button type="button" onClick={() => setDraft(null)} className={cn(ghost, "-mr-2 -my-1")} aria-label="Cancel">
              <X className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={draft.occurredAt}
              onChange={(e) => setDraft({ ...draft, occurredAt: e.target.value })}
              className={input}
              aria-label="Date"
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}
              className={cn(input, "capitalize")}
              aria-label="Kind"
            >
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <input
            autoFocus={!draft.id}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Drinks at Bar Pisellino"
            className={input}
            aria-label="Title"
          />
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="What happened, what you talked about, how you felt"
            rows={3}
            className={input}
            aria-label="Notes"
          />
          <div>
            <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
              <span>How it felt</span>
              <span className="tabular-nums">{draft.vibe ? `${draft.vibe}/10` : "not rated"}</span>
            </div>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setDraft({ ...draft, vibe: draft.vibe === v ? null : v })}
                  className={cn(
                    "rounded py-2 sm:py-1 text-xs tabular-nums transition",
                    draft.vibe === v
                      ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                      : "bg-[var(--color-fill-secondary)] hover:bg-[var(--color-fill)]",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {draft.id && (
              <button
                type="button"
                onClick={() => remove(draft.id!)}
                className={cn(ghost, tap, "-ml-2.5 hover:text-[var(--color-destructive)]")}
              >
                <Trash2 className="size-4" /> Delete
              </button>
            )}
            <button type="submit" disabled={busy || !draft.title.trim()} className={cn(btn, tap, "ml-auto justify-center px-5")}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {draft.id ? "Save" : "Add"}
            </button>
          </div>
        </form>
      )}

      {!events.length && !draft && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nothing yet. Log dates, milestones, fights and calls, and rate each one to see how it&apos;s going.
        </p>
      )}
      {!!events.length && (
        <ol className="divide-y divide-[var(--color-separator)]">
          {[...events].reverse().map((e) => (
            <li key={e.id} className={cn("py-1", draft?.id === e.id && "opacity-50")}>
              <button
                type="button"
                onClick={() =>
                  openForm({
                    id: e.id,
                    occurredAt: dateInput(e.occurredAt),
                    kind: e.kind as EventKind,
                    title: e.title,
                    notes: e.notes ?? "",
                    vibe: e.vibe,
                  })
                }
                className="flex min-h-11 w-full items-start gap-3 rounded-md py-2 text-left hover:bg-[var(--color-fill-secondary)] sm:-mx-2 sm:w-[calc(100%+1rem)] sm:px-2"
              >
                <span className="w-16 shrink-0 pt-px text-sm tabular-nums text-[var(--color-muted-foreground)]">{short(e.occurredAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words">{e.title}</span>
                  <span className="block text-xs capitalize text-[var(--color-label-tertiary)]">
                    {e.kind}
                    {e.vibe !== null && ` · ${e.vibe}/10`}
                  </span>
                  {e.notes && (
                    <span className="mt-0.5 block line-clamp-2 text-sm whitespace-pre-wrap text-[var(--color-muted-foreground)]">
                      {e.source ? splitSourceLine(e.notes).body : e.notes}
                    </span>
                  )}
                </span>
              </button>
              <div className="pl-[4.75rem]">
                <SourceBadge event={e} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// Where a filed note came from; Granola notes link back to the meeting.
function SourceBadge({ event }: { event: DatingEventDTO }) {
  if (event.source !== "dictation" && event.source !== "granola" && event.source !== "journal") return null;
  const { label, url } = splitSourceLine(event.notes);
  const text =
    event.source === "dictation"
      ? "dictated"
      : event.source === "journal"
        ? "from your notes"
        : `from Granola${label && label !== "Granola" ? ` · ${label}` : ""}`;
  const cls = "mb-1.5 inline-block max-w-full truncate rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]";
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:text-[var(--color-foreground)] hover:underline")}>
      {text}
    </a>
  ) : (
    <span className={cls}>{text}</span>
  );
}

// ---------------------------------------------------------------------------

function Messages({
  person,
  first,
  initialMessages,
  initialMore,
  onImported,
  setMeta,
  setError,
}: {
  person: DatingPersonDTO;
  first: string;
  initialMessages: DatingMessageDTO[];
  initialMore: boolean;
  onImported: () => void;
  setMeta: (m: Meta[]) => void;
  setError: (e: string | null) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [more, setMore] = useState(initialMore);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [paste, setPaste] = useState(!initialMessages.length);
  const [pasteText, setPasteText] = useState("");
  const [myName, setMyName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const load = async (opts: { before?: string; query?: string }) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (opts.before) params.set("before", opts.before);
    if (opts.query) params.set("q", opts.query);
    const res = await fetch(`/api/dating/${person.id}/messages?${params}`);
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(data.error ?? "Could not load messages");
    setMessages((cur) => (opts.before ? [...data.messages, ...cur] : data.messages));
    setMore(data.more);
  };

  const importPaste = async () => {
    setLoading(true);
    const res = await fetch(`/api/dating/${person.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pasteText, myName: myName || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(data.error ?? "Could not import");
    setResult(`Found ${data.parsed} messages, ${data.added} new. Senders: ${data.senders.join(", ")}.`);
    setPasteText("");
    setError(null);
    await load({});
    const metaRes = await fetch(`/api/dating/${person.id}/messages/meta`);
    if (metaRes.ok) setMeta((await metaRes.json()).meta);
    onImported();
  };

  let lastDay = "";
  let lastSource = "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load({ query: q });
          }}
          className="relative flex-1 min-w-[200px]"
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[var(--color-muted-foreground)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" className={cn(input, "pl-8")} />
        </form>
        <button onClick={() => setPaste((p) => !p)} className={ghost}>
          <Plus className="size-4" /> Paste a chat
        </button>
      </div>

      {paste && (
        <div className={cn(card, "space-y-2")}>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Paste a WhatsApp export or lines like <code>{first}: hey</code> / <code>Me: hi</code>. Hinge, Bumble and
            Instagram chats work as copied text. Re-pasting the same chat skips duplicates.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder={`${first}: that ramen place was so good\nMe: we should go back Thursday`}
            className={cn(input, "font-mono text-xs")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Your name in the export (optional)"
              className={cn(input, "w-auto flex-1 min-w-[200px]")}
            />
            <button onClick={importPaste} disabled={loading || !pasteText.trim()} className={btn}>
              {loading && <Loader2 className="size-4 animate-spin" />} Import
            </button>
          </div>
          {result && <p className="text-xs text-[var(--color-muted-foreground)]">{result}</p>}
          <SyncHelp compact hasHandles={person.handles.length > 0} />
        </div>
      )}

      <div className={cn(card, "space-y-1")}>
        {more && (
          <div className="text-center pb-2">
            <button onClick={() => load({ before: messages[0]?.sentAt, query: q })} disabled={loading} className={ghost}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null} Load older
            </button>
          </div>
        )}
        {!messages.length && (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6 text-center">
            {q ? "No matches." : "No messages yet. Paste a chat, or sync iMessage and WhatsApp from your Mac."}
          </p>
        )}
        {messages.map((m) => {
          const day = new Date(m.sentAt).toDateString();
          const header = day !== lastDay;
          // Label the source (iMessage / WhatsApp / Pasted) at the start of each run.
          const sourceLabel = header || m.source !== lastSource ? (SOURCE_LABELS[m.source] ?? m.source) : null;
          lastDay = day;
          lastSource = m.source;
          return (
            <div key={m.id}>
              {header && (
                <div className="text-center text-[11px] text-[var(--color-label-tertiary)] pt-3 pb-1">{fmtDate(m.sentAt)}</div>
              )}
              {sourceLabel && (
                <div
                  className={cn(
                    "px-1 pb-0.5 text-[10px] text-[var(--color-label-tertiary)]",
                    m.fromMe ? "text-right" : "text-left",
                  )}
                >
                  {sourceLabel}
                </div>
              )}
              <div className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                <div
                  title={`${new Date(m.sentAt).toLocaleString()} · ${SOURCE_LABELS[m.source] ?? m.source}`}
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                    m.fromMe
                      ? "bg-[var(--color-tint)] text-white"
                      : "bg-[var(--color-fill)] text-[var(--color-foreground)]",
                  )}
                >
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Notes({ person, patch }: { person: DatingPersonDTO; patch: Patch }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold mb-2" aria-hidden>
          About her
        </h3>
        <textarea
          defaultValue={person.notes ?? ""}
          onBlur={(e) => e.target.value !== (person.notes ?? "") && patch({ notes: e.target.value })}
          rows={10}
          placeholder="Anything: her story, what she's into, what she's looking for, how you feel about it"
          aria-label="About her"
          className={input}
        />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">What this taught me</h3>
        <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
          Lessons roll up on the Dating page so patterns across people show up.
        </p>
        <textarea
          defaultValue={person.lessons ?? ""}
          key={person.lessons ?? ""}
          onBlur={(e) => e.target.value !== (person.lessons ?? "") && patch({ lessons: e.target.value })}
          rows={7}
          placeholder="What worked, what didn't, what you want next time"
          aria-label="Lessons"
          className={input}
        />
      </div>
    </div>
  );
}

// The name is edited in the page header, so it isn't repeated here.
function Details({
  person,
  patch,
  setError,
  onDelete,
}: {
  person: DatingPersonDTO;
  patch: Patch;
  setError: (e: string | null) => void;
  onDelete: () => void;
}) {
  // Text fields save on blur, only when changed.
  const field = (key: "metVia" | "city" | "work", label: string, placeholder: string) => (
    <label className="block">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <input
        defaultValue={person[key] ?? ""}
        placeholder={placeholder}
        onBlur={(e) => e.target.value !== (person[key] ?? "") && patch({ [key]: e.target.value })}
        className={input}
      />
    </label>
  );
  return (
    <div>
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[var(--color-muted-foreground)]">Phone or email (for iMessage sync)</span>
          <input
            defaultValue={person.handles.join(", ")}
            placeholder="(415) 555-0134"
            onBlur={(e) => e.target.value !== person.handles.join(", ") && patch({ handles: e.target.value })}
            className={input}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-muted-foreground)]">Instagram</span>
          <input
            defaultValue={person.instagram ? `@${person.instagram}` : ""}
            key={person.instagram ?? ""}
            placeholder="@handle or profile link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const handle = normalizeInstagram(raw);
              // Checked here too so a bad value never shows as her link.
              if (raw && !handle) return setError("That doesn't look like an Instagram handle. Use @name or an instagram.com/name link.");
              if (handle !== person.instagram) patch({ instagram: handle ?? "" });
              else if (raw) e.target.value = `@${handle}`;
            }}
            className={input}
          />
        </label>
        {field("city", "City", "Brooklyn")}
        {field("work", "Work", "Architect")}
        <label className="block">
          <span className="text-xs text-[var(--color-muted-foreground)]">Age</span>
          <input
            type="number"
            defaultValue={person.age ?? ""}
            onBlur={(e) => String(person.age ?? "") !== e.target.value && patch({ age: e.target.value ? Number(e.target.value) : null })}
            className={input}
          />
        </label>
        {field("metVia", "Met via", "Hinge, friends, a bar")}
        <label className="block">
          <span className="text-xs text-[var(--color-muted-foreground)]">Met on</span>
          <input
            type="date"
            defaultValue={dateInput(person.metAt)}
            onChange={(e) => patch({ metAt: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })}
            className={input}
          />
        </label>
      </div>
      <div className="mt-6">
        <button onClick={onDelete} className={cn(ghost, tap, "-ml-2.5 hover:text-[var(--color-destructive)]")}>
          <Trash2 className="size-4" /> Delete {person.name.split(/\s+/)[0]}
        </button>
      </div>
    </div>
  );
}
