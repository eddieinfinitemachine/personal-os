"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Instagram, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EVENT_KINDS,
  STAGES,
  daysSince,
  fmtDuration,
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

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtMin = (m: number | null) =>
  m === null ? "n/a" : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
const byDay = (a: DatingEventDTO, b: DatingEventDTO) => a.occurredAt.localeCompare(b.occurredAt);

/**
 * One scrolling page per person: header with key dates, dictation, Claude's
 * read, lists, the chart, timeline, notes, details and (collapsed) messages.
 * Sections have ids (#timeline, #notes, #details, #messages) for links.
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

  const stats = useMemo(() => threadStats(meta), [meta]);
  const since = daysSince(person.lastMessageAt);
  const vibes = events.filter((e) => e.vibe).map((e) => e.vibe!);
  const journalDone = events.some((e) => e.externalId === journalExternalId(person.id));

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-4xl space-y-8">
      <div>
        <Link href="/dating" className={cn(ghost, "-ml-2.5 mb-2")}>
          <ChevronLeft className="size-4" /> Dating
        </Link>
        <header className="flex items-center gap-4">
          <Avatar name={person.name} photo={photos[0]?.url} />
          <div className="min-w-0 flex-1">
            <h1 className="text-large-title font-bold break-words">{person.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <select
                value={person.stage}
                onChange={(e) => patch({ stage: e.target.value })}
                aria-label="Stage"
                className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-1 text-sm capitalize"
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
                  className="inline-flex min-w-0 items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline"
                >
                  <Instagram className="size-3.5 shrink-0" />
                  <span className="truncate">@{person.instagram}</span>
                </a>
              )}
            </div>
          </div>
        </header>
        <KeyDateRow person={person} events={events} since={since} vibes={vibes} />
      </div>

      <PhotoStrip personId={person.id} firstName={first} photos={photos} setPhotos={setPhotos} setError={setError} />

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
        <p role="status" className="-mt-4 flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
          <Sparkles className="size-4 shrink-0" /> Organized your notes. {organized}.
        </p>
      )}

      <DictateCard
        personId={person.id}
        firstName={first}
        onSaved={({ people, events: added }) => {
          const updated = people.find((p) => p.id === person.id);
          if (updated) setPerson(updated);
          setEvents((list) => [...list.filter((e) => !added.some((a) => a.id === e.id)), ...added].sort(byDay));
        }}
      />

      <Insights person={person} setPerson={setPerson} patch={patch} setError={setError} />

      <div className="grid gap-4 md:grid-cols-3">
        <ListEditor
          title="Remember"
          items={person.remember}
          placeholder="Sister is Maya, hates cilantro"
          onChange={(remember) => patch({ remember })}
        />
        <ListEditor
          title="Green flags"
          tone="good"
          items={person.greenFlags}
          placeholder="Plans the next date"
          onChange={(greenFlags) => patch({ greenFlags })}
        />
        <ListEditor
          title="Red flags"
          tone="bad"
          items={person.redFlags}
          placeholder="Cancels last minute"
          onChange={(redFlags) => patch({ redFlags })}
        />
      </div>

      <Section id="chart" title="How it's going">
        {stats.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Messages" value={stats.total.toLocaleString()} sub={`${Math.round((stats.mine / stats.total) * 100)}% from you`} />
            <Stat
              label="You start"
              value={stats.iInitiate === null ? "n/a" : `${Math.round(stats.iInitiate * 100)}%`}
              sub={`of ${stats.conversations} conversations`}
            />
            <Stat label="Median reply" value={`${fmtMin(stats.myReplyMin)} / ${fmtMin(stats.theirReplyMin)}`} sub={`you / ${first}`} />
          </div>
        )}
        <div className={card}>
          <RelationshipChart messages={meta} events={events} name={first} metAt={person.metAt} />
        </div>
      </Section>

      <Section id="timeline" title="Timeline" count={events.length}>
        <Timeline personId={person.id} events={events} setEvents={setEvents} setError={setError} />
      </Section>

      <Section id="notes" title="Notes">
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

function KeyDateRow({
  person,
  events,
  since,
  vibes,
}: {
  person: DatingPersonDTO;
  events: DatingEventDTO[];
  since: number | null;
  vibes: number[];
}) {
  const k = keyDates(person, events);
  const short = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sameYear = k.from && k.to && new Date(k.from).getFullYear() === new Date(k.to).getFullYear();
  const lastAgo = k.lastDate ? daysSince(k.lastDate.occurredAt) : null;
  const facts: { label: string; value: string; sub?: string | null }[] = [
    {
      label: "Met",
      value: k.met ? fmtDate(k.met) : "Not set",
      sub: person.metVia ? `via ${person.metVia}` : null,
    },
    {
      label: k.ongoing ? "Since" : "Together",
      value: !k.from ? "n/a" : k.ongoing ? fmtDate(k.from) : `${sameYear ? short(k.from) : fmtDate(k.from)} – ${fmtDate(k.to ?? k.from)}`,
      sub: k.days !== null ? fmtDuration(k.days) : null,
    },
    {
      label: "Last date",
      value: k.lastDate ? fmtDate(k.lastDate.occurredAt) : "None yet",
      sub: k.lastDate
        ? [k.lastDate.vibe && `vibe ${k.lastDate.vibe}/10`, lastAgo !== null && (lastAgo === 0 ? "today" : `${lastAgo}d ago`)]
            .filter(Boolean)
            .join(" · ")
        : null,
    },
    {
      label: "Dates",
      value: String(k.dates),
      sub: [
        vibes.length ? `avg vibe ${(vibes.reduce((a, b) => a + b, 0) / vibes.length).toFixed(1)}` : null,
        since !== null && (since === 0 ? "texted today" : `last text ${since}d ago`),
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-caption uppercase tracking-wide text-[var(--color-label-tertiary)]">{f.label}</dt>
          <dd className="text-sm font-medium tabular-nums">{f.value}</dd>
          {f.sub && <dd className="truncate text-xs text-[var(--color-muted-foreground)]">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <h2 id={`${id}-title`} className="text-headline font-semibold">
        {title}
        {!!count && <span className="ml-1.5 font-normal text-[var(--color-label-tertiary)]">{count}</span>}
      </h2>
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
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3 text-left hover:bg-[var(--color-fill-secondary)] transition"
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
    <div className={cn(card, "min-w-0 p-3")}>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-lg sm:text-xl font-semibold tabular-nums mt-0.5 truncate">{value}</div>
      <div className="text-xs text-[var(--color-label-tertiary)] mt-0.5 truncate">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Organized = { summary: string; person: DatingPersonDTO; events: DatingEventDTO[] };

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
    <section className={cn(card, "flex flex-wrap items-center gap-3")}>
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-sm font-semibold">Organize notes with Claude</div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Turns your notes into dates on the timeline, flags, things to remember and lessons. The notes stay as they are.
        </p>
      </div>
      <button onClick={run} disabled={busy} className={btn}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "Organizing…" : "Organize"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Insights({
  person,
  setPerson,
  patch,
  setError,
}: {
  person: DatingPersonDTO;
  setPerson: (p: DatingPersonDTO) => void;
  patch: Patch;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const ins = person.insights;
  const run = async () => {
    setBusy(true);
    const res = await fetch(`/api/dating/${person.id}/insights`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not read the thread");
    setPerson(data.person);
    setOpen(true);
    setError(null);
  };
  const suggest = (title: string, items: string[] | undefined, field: "remember" | "greenFlags" | "redFlags") => {
    const fresh = (items ?? []).filter((i) => !person[field].includes(i));
    if (!fresh.length) return null;
    return (
      <div>
        <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1">{title}</div>
        <ul className="space-y-1">
          {fresh.map((i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <button
                onClick={() => patch({ [field]: [...person[field], i] })}
                aria-label="Add to notes"
                title="Add to notes"
                className="mt-0.5 rounded p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              >
                <Plus className="size-3.5" />
              </button>
              <span className="flex-1">{i}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <section id="insights" className={cn(card, "scroll-mt-4")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="insights-body"
          disabled={!ins}
          className="-my-1 flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left disabled:cursor-default"
        >
          <h3 className="text-sm font-semibold">Claude&apos;s read</h3>
          {ins && (
            <ChevronDown className={cn("size-4 text-[var(--color-muted-foreground)] transition-transform", open && "rotate-180")} />
          )}
        </button>
        <button onClick={run} disabled={busy} className={cn(ghost, "-mr-2.5")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {ins ? "Refresh" : "Read the thread"}
        </button>
      </div>
      {!ins ? (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Reads your messages, timeline and notes, then pulls out details worth remembering, flags, date ideas and what
          this is teaching you.
        </p>
      ) : !open ? (
        ins.summary && (
          <button type="button" onClick={() => setOpen(true)} className="mt-1 block w-full text-left text-sm leading-relaxed text-[var(--color-muted-foreground)] line-clamp-2">
            {ins.summary}
          </button>
        )
      ) : (
        <div id="insights-body" className="mt-2 space-y-3">
          {ins.summary && <p className="text-sm leading-relaxed">{ins.summary}</p>}
          <div className="grid gap-3 md:grid-cols-3">
            {suggest("Remember", ins.remember, "remember")}
            {suggest("Green flags", ins.greenFlags, "greenFlags")}
            {suggest("Red flags", ins.redFlags, "redFlags")}
          </div>
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
                  className={cn(ghost, "-ml-2.5 mt-1")}
                >
                  <Plus className="size-3.5" /> Add to my lessons
                </button>
              )}
            </div>
          )}
          {person.insightsAt && (
            <div className="text-xs text-[var(--color-label-tertiary)]">Read {fmtDate(person.insightsAt)}</div>
          )}
        </div>
      )}
    </section>
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
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const save = async () => {
    if (!draft.title.trim()) return;
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
    setEvents((list) =>
      [...list.filter((e) => e.id !== data.event.id), data.event].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    );
    setDraft(emptyDraft());
    setError(null);
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/dating/events/${id}`, { method: "DELETE" });
    if (res.ok) setEvents((list) => list.filter((e) => e.id !== id));
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
      <ol className="space-y-2 order-2 md:order-1">
        {!events.length && (
          <li className="text-sm text-[var(--color-muted-foreground)]">
            Nothing yet. Log first dates, milestones, fights, calls. Rate each one to plot how it&apos;s going.
          </li>
        )}
        {[...events].reverse().map((e) => (
          <li key={e.id} className={cn(card, "group p-3")}>
            <div className="flex items-start gap-3">
              <div className="w-16 shrink-0 text-center">
                <div className="text-lg font-semibold tabular-nums leading-tight">{e.vibe ?? "·"}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-label-tertiary)]">{e.kind}</div>
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => {
                    setDraft({
                      id: e.id,
                      occurredAt: dateInput(e.occurredAt),
                      kind: e.kind as EventKind,
                      title: e.title,
                      notes: e.notes ?? "",
                      vibe: e.vibe,
                    });
                    formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                  className="w-full text-left"
                >
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">{fmtDate(e.occurredAt)}</div>
                  {e.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{e.source ? splitSourceLine(e.notes).body : e.notes}</p>}
                </button>
                <SourceBadge event={e} />
              </div>
              <button
                onClick={() => remove(e.id)}
                aria-label="Delete"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className={cn(card, "space-y-2.5 h-fit order-1 md:order-2 md:sticky md:top-4")}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{draft.id ? "Edit moment" : "Add a moment"}</h3>
          {draft.id && (
            <button type="button" onClick={() => setDraft(emptyDraft())} className={ghost} aria-label="Cancel edit">
              <X className="size-4" />
            </button>
          )}
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
          rows={4}
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
                  "rounded py-1 text-xs tabular-nums transition",
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
        <button type="submit" disabled={busy || !draft.title.trim()} className={cn(btn, "w-full justify-center")}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {draft.id ? "Save" : "Add"}
        </button>
      </form>
    </div>
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
  const cls = "mt-1.5 inline-block max-w-full truncate rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]";
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
    <div className="grid gap-4 md:grid-cols-2">
      <section className={card}>
        <h3 className="text-sm font-semibold mb-2" aria-hidden>
          About her
        </h3>
        <textarea
          defaultValue={person.notes ?? ""}
          onBlur={(e) => e.target.value !== (person.notes ?? "") && patch({ notes: e.target.value })}
          rows={12}
          placeholder="Anything: her story, what she's into, what she's looking for, how you feel about it"
          aria-label="About her"
          className={input}
        />
      </section>
      <section className={card}>
        <h3 className="text-sm font-semibold mb-1">What this taught me</h3>
        <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
          Lessons roll up on the Dating page so patterns across people show up.
        </p>
        <textarea
          defaultValue={person.lessons ?? ""}
          key={person.lessons ?? ""}
          onBlur={(e) => e.target.value !== (person.lessons ?? "") && patch({ lessons: e.target.value })}
          rows={9}
          placeholder="What worked, what didn't, what you want next time"
          aria-label="Lessons"
          className={input}
        />
      </section>
    </div>
  );
}

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
  const field = (key: "name" | "metVia" | "city" | "work", label: string, placeholder: string) => (
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
    <div className={card}>
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        {field("name", "Name", "Name")}
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
      <div className="mt-4 border-t border-[var(--color-separator)] pt-3">
        <button onClick={onDelete} className={cn(ghost, "-ml-2.5 hover:text-[var(--color-destructive)]")}>
          <Trash2 className="size-4" /> Delete {person.name.split(/\s+/)[0]}
        </button>
      </div>
    </div>
  );
}
