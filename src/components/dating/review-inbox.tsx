"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES } from "@/lib/dating";
import { LinkPicker, type PickablePerson } from "./link-picker";

export type ReviewCandidate = {
  id: string;
  name: string;
  fingerprint: string;
  status: string;
  identities: string[];
  personId: string | null;
  evidence: { id: string; source: string; title: string | null; url: string | null; occurredAt: string | null; quote: string; summary: string }[];
  draft: { name: string; stage: string; metAt: string | null; handles: string[] };
};
type ReviewAction = "add" | "link" | "dismiss" | "exclude" | "restore";
const button = "inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";
const primary = `${button} bg-[var(--color-foreground)] text-[var(--color-background)] hover:opacity-90`;
const field = "mt-1 min-h-11 w-full rounded-md bg-[var(--color-fill-secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const sourceLabel: Record<string, string> = { ecpad: "EC Pad", texts: "Texts", granola: "Granola" };
const stageLabel: Record<string, string> = { talking: "Pursuing", dating: "Dating", exclusive: "Exclusive", paused: "Paused", ended: "Ended" };

function sourceDate(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Date unknown";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:", "granola:", "ecpad:"].includes(url.protocol) ? value : null;
  } catch { return null; }
}

export function ReviewInbox({ people }: { people: PickablePerson[] }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [excluded, setExcluded] = useState<ReviewCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reviewed = useRef(new Set<string>());
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const response = await fetch("/api/dating/review", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.candidates) || !Array.isArray(data.excluded)) throw new Error("Could not load people to review. Try again.");
      if (version !== loadVersion.current) return;
      setCandidates(data.candidates);
      setExcluded(data.excluded);
      setError(null);
    } catch {
      if (version === loadVersion.current) setError("Could not load people to review. Try again.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { ++loadVersion.current; }; }, [load]);

  const act = async (candidate: ReviewCandidate, action: ReviewAction, extra: { personId?: string; draft?: ReviewCandidate["draft"] } = {}) => {
    const key = `${candidate.id}:${candidate.fingerprint}:${action === "restore" ? "restore" : "review"}`;
    if (inFlight.current || reviewed.current.has(key)) return;
    inFlight.current = true;
    setBusy(candidate.id);
    try {
      const response = await fetch(`/api/dating/review/${encodeURIComponent(candidate.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, fingerprint: candidate.fingerprint, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "Could not save that choice. Try again.");
      reviewed.current.add(key);
      reviewed.current.delete(`${candidate.id}:${candidate.fingerprint}:${action === "restore" ? "review" : "restore"}`);
      // Only remove a card after the server confirms the choice.
      setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      setExcluded((items) => action === "exclude" ? [...items.filter((item) => item.id !== candidate.id), { ...candidate, status: "excluded" }] : items.filter((item) => item.id !== candidate.id));
      router.refresh();
      await load();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (!loading && !error && !candidates.length && !excluded.length) return null;
  return (
    <section aria-label="People to review" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">People to review{candidates.length > 0 && ` (${candidates.length})`}</h2>
        <button type="button" className={button} disabled={loading || busy !== null} onClick={() => void load()}>Refresh review</button>
      </div>
      {loading && !candidates.length && <p role="status" className="py-2 text-sm text-[var(--color-muted-foreground)]">Checking for people to review…</p>}
      {error && <p role="alert" className="mb-2 text-sm text-[var(--color-destructive)]">{error}</p>}
      <ul className="space-y-3">
        {candidates.map((candidate) => <ReviewCard key={candidate.id} candidate={candidate} people={people} disabled={busy !== null} busy={busy === candidate.id} act={act} />)}
      </ul>
      {excluded.length > 0 && <details className="mt-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm text-[var(--color-muted-foreground)]">Excluded people ({excluded.length})</summary>
        <ul className="space-y-2">{excluded.map((candidate) => <ExcludedCard key={candidate.id} candidate={candidate} disabled={busy !== null} act={act} />)}</ul>
      </details>}
    </section>
  );
}

type ActionHandler = (candidate: ReviewCandidate, action: ReviewAction, extra?: { personId?: string; draft?: ReviewCandidate["draft"] }) => Promise<void>;
function ReviewCard({ candidate, people, disabled, busy, act }: { candidate: ReviewCandidate; people: PickablePerson[]; disabled: boolean; busy: boolean; act: ActionHandler }) {
  const id = useId();
  const [draft, setDraft] = useState(candidate.draft);
  const [handles, setHandles] = useState(candidate.draft.handles.join(", "));
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perform = async (action: ReviewAction, extra?: Parameters<ActionHandler>[2]) => {
    setError(null);
    setLinking(false);
    try { await act(candidate, action, extra); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save that choice. Try again."); }
  };
  return <li className="min-w-0 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
    <h3 className="font-semibold">{candidate.name}</h3>
    <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--color-muted-foreground)]">{[...new Set(candidate.evidence.map((item) => item.source))].map((source) => <span key={source} className="rounded bg-[var(--color-fill-secondary)] px-2 py-1">{sourceLabel[source] ?? source}</span>)}</div>
    <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{sourceDate(candidate.evidence[0]?.occurredAt ?? null)}</p>
    {candidate.evidence[0]?.summary && <p className="mt-2 break-words text-sm">{candidate.evidence[0].summary}</p>}
    <details className="mt-1">
      <summary className="min-h-11 cursor-pointer content-center text-sm">Evidence ({candidate.evidence.length})</summary>
      <ul className="space-y-3">{candidate.evidence.map((evidence) => <li key={evidence.id} className="min-w-0 border-l-2 border-[var(--color-card-border)] pl-3">
        <p className="text-xs text-[var(--color-muted-foreground)]">{sourceLabel[evidence.source] ?? evidence.source} · {sourceDate(evidence.occurredAt)}</p>
        <p className="mt-1 break-words text-sm font-medium">{safeLink(evidence.url) ? <a href={safeLink(evidence.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">{evidence.title || "Open source"}</a> : evidence.title || "Source evidence"}</p>
        <blockquote className="whitespace-pre-wrap break-words text-sm">{evidence.quote}</blockquote>
      </li>)}</ul>
    </details>
    <p className="mb-2 text-xs text-[var(--color-muted-foreground)]">{candidate.identities.length ? "Dismiss or Don’t suggest again: this person isn’t suggested again and the conversation is no longer read. Only Don’t suggest again can be undone, below." : "Identity is unconfirmed. Dismiss or Don’t suggest again: this name isn’t suggested again from EC Pad or Granola. Only Don’t suggest again can be undone, below."}</p>
    <div className="flex flex-wrap gap-1">
      <button type="button" className={primary} disabled={disabled} aria-expanded={adding} aria-controls={`${id}-draft`} onClick={() => setAdding(!adding)}>{adding ? "Hide draft" : "Add person"}</button>
      {people.length > 0 && <button type="button" className={button} disabled={disabled} aria-haspopup="dialog" onClick={() => setLinking(true)}>Link existing</button>}
      <button type="button" className={button} disabled={disabled} onClick={() => void perform("dismiss")}>Dismiss</button>
      <button type="button" className={button} disabled={disabled} onClick={() => void perform("exclude")}>Don’t suggest again</button>
    </div>
    <form id={`${id}-draft`} hidden={!adding} className="mt-3 space-y-3 border-t border-[var(--color-card-border)] pt-3" onSubmit={(event) => {
      event.preventDefault();
      if (!draft.name.trim() || disabled) return;
      void perform("add", { draft: { ...draft, name: draft.name.trim(), handles: handles.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean), metAt: draft.metAt || null } });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Name<input required value={draft.name} disabled={disabled} className={field} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="text-sm">Stage<select value={draft.stage} disabled={disabled} className={field} onChange={(event) => setDraft({ ...draft, stage: event.target.value })}>{STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select></label>
        <label className="text-sm">Phone numbers or emails<input value={handles} disabled={disabled} className={field} placeholder="Separate with commas" onChange={(event) => setHandles(event.target.value)} /></label>
        <label className="text-sm">Met date, if known<input type="date" value={draft.metAt?.slice(0, 10) ?? ""} disabled={disabled} className={field} onChange={(event) => setDraft({ ...draft, metAt: event.target.value || null })} /></label>
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)]">A source mention does not tell us when you met. Leave the date blank unless you know it. Adding exact phone numbers enables the existing conversation import.</p>
      <button className={primary} disabled={disabled || !draft.name.trim()} type="submit">{busy ? "Saving…" : "Save person"}</button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error} Use Refresh review if the evidence has changed.</p>}
    {linking && <LinkPicker name={candidate.name} description="Attach the reviewed evidence to the person you choose." people={people} onPick={(person) => void perform("link", { personId: person.id })} onClose={() => setLinking(false)} />}
  </li>;
}

function ExcludedCard({ candidate, disabled, act }: { candidate: ReviewCandidate; disabled: boolean; act: ActionHandler }) {
  const [error, setError] = useState<string | null>(null);
  return <li className="rounded-md border border-[var(--color-card-border)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{candidate.name}</span><button className={button} disabled={disabled} type="button" onClick={async () => {
      setError(null);
      try { await act(candidate, "restore"); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not restore. Try again."); }
    }}>Restore</button></div>
    {!candidate.identities.length && <p className="text-xs text-[var(--color-muted-foreground)]">Identity is unconfirmed; this name isn’t suggested from EC Pad or Granola.</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
  </li>;
}
