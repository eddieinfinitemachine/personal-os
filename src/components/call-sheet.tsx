"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, MessageCircle, Phone, RotateCcw, Settings2 } from "lucide-react";
import { Sheet } from "@/components/dating/sheet";
import { REACH_OUT_METHODS, type ReachOutMethod } from "@/lib/call-sheet/reach-out";
import type { CallSheetEntry, CallSheetMutation, CallSheetResponse, CallSheetSettingsMutation } from "@/lib/call-sheet/types";

const actionClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50";
const labels = { imessage: "iMessage", whatsapp: "WhatsApp" } as const;
function date(value: string | null, timezone: string) {
  if (!value) return "Last contact unknown";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }

export function CallSheet() {
  const [data, setData] = useState<CallSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<{ entry: CallSheetEntry; dayId: string; version: number } | null>(null);
  const choosing = useRef(false);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusAfterSave = useRef(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true), mutation = useRef(false), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (mutation.current || choosing.current || document.visibilityState === "hidden") return;
    const own = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch("/api/call-sheet", { cache: "no-store", signal: abort.signal });
      const result = await res.json();
      if (!res.ok || !result.day || !Array.isArray(result.entries)) throw Error(res.status === 401 ? "Sign in again to see your call sheet." : "Your call sheet could not load. Try again.");
      if (alive.current && own === sequence.current) { setData(result); if (!quiet) setError(null); }
    } catch (e) {
      if (alive.current && own === sequence.current && !quiet) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Your call sheet took too long to load. Try again.");
    } finally {
      clearTimeout(timeout);
      if (alive.current && own === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => { if (!mutation.current) void load(true); }, 30000);
    const visible = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; ++sequence.current; controller.current?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  useEffect(() => {
    if (!prompt && !busy && focusAfterSave.current) {
      focusAfterSave.current = false;
      undoButton.current?.focus();
    }
  }, [prompt, busy]);

  async function send(path: string, body: CallSheetMutation | CallSheetSettingsMutation) {
    if (mutation.current) return false;
    mutation.current = true; ++sequence.current; controller.current?.abort();
    setBusy(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const result = await res.json();
      if (res.status === 409) {
        if (alive.current) setError("Your call sheet changed. Review the refreshed list and try again.");
        mutation.current = false;
        choosing.current = false;
        if (alive.current) setPrompt(null);
        await load(true);
        return false;
      }
      if (!res.ok || !result.day) throw Error(res.status === 401 ? "Sign in again to update your call sheet." : "That change could not save. Please try again.");
      if (alive.current) setData(result);
      return true;
    } catch (e) {
      if (alive.current) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "The change took too long. Refresh before trying again.");
      return false;
    } finally {
      clearTimeout(timeout); mutation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function act(entry: CallSheetEntry, action: CallSheetMutation["action"]) {
    if (!data) return;
    return send("/api/call-sheet", { dayId: data.day.id, version: data.day.version, entryId: entry.id, action, ...(action === "snooze" ? { days: 7 } : {}) });
  }
  function openCheckIn(entry: CallSheetEntry) {
    if (!data || mutation.current) return;
    choosing.current = true;
    ++sequence.current;
    controller.current?.abort();
    setError(null);
    setPrompt({ entry, dayId: data.day.id, version: data.day.version });
  }
  function closeCheckIn() {
    if (mutation.current) return;
    choosing.current = false;
    setPrompt(null);
  }
  async function completeCheckIn(method: ReachOutMethod) {
    if (!prompt) return;
    const saved = await send("/api/call-sheet", {
      dayId: prompt.dayId, version: prompt.version, entryId: prompt.entry.id, action: "done", method,
    });
    if (saved) {
      focusAfterSave.current = true;
      closeCheckIn();
    }
  }
  /** Call / Text on the row log the check-in straight away; they never dial or open Messages. */
  async function logCheckIn(entry: CallSheetEntry, method: ReachOutMethod) {
    if (!data || prompt) return;
    const saved = await send("/api/call-sheet", { dayId: data.day.id, version: data.day.version, entryId: entry.id, action: "done", method });
    if (saved) focusAfterSave.current = true;
  }
  const complete = data?.entries.filter(e => e.status !== "pending").length ?? 0;
  return (
    <section aria-label="Daily call sheet" className="mb-7 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Call Sheet</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">
            {data?.entries.length ? `${complete} of ${data.entries.length} checked in today` : "A few people worth checking in with."}
          </p>
        </div>
        {busy ? <Loader2 className="mt-1 size-4 animate-spin" aria-label="Saving" /> : null}
      </div>
      {error && !prompt ? <div role="alert" className="mx-4 mt-3 rounded-lg bg-[var(--color-muted)] p-3 text-sm">{error} <button onClick={() => void load()} disabled={busy} className="underline underline-offset-2">Refresh</button></div> : null}
      {loading && !data ? <p role="status" className="p-5 text-sm text-[var(--color-muted-foreground)]">Getting your call sheet…</p> : null}
      {data ? <>
        {!data.entries.length ? <div className="px-4 py-5 text-sm text-[var(--color-muted-foreground)]">No check-ins to suggest yet. Your list will fill as recent conversations and saved interactions are checked.</div> : null}
        <ol className="divide-y divide-[var(--color-border)] px-4 sm:px-5">
          {data.entries.map(entry => (
            <li key={entry.id} className="py-4 sm:flex sm:items-start sm:justify-between sm:gap-4" data-person-id={entry.personId}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {entry.imageUrl ? <img src={entry.imageUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-muted)] text-xs text-[var(--color-muted-foreground)]">{initials(entry.name)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{entry.name}</span>
                    {entry.status !== "pending" ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="size-3" />{entry.status === "done" ? "Checked in" : "Recently contacted"}</span> : null}
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{entry.reason}</p>
                  {entry.status === "pending" && entry.topic ? <p className="mt-2 text-sm">{entry.topic}</p> : null}
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    {entry.lastContactAt ? `Last recorded contact · ${date(entry.lastContactAt, data.timezone)}${entry.lastContactSource ? " · " + (entry.lastContactSource === "manual" ? "Saved check-in" : labels[entry.lastContactSource as keyof typeof labels] ?? entry.lastContactSource) : ""}` : "Last contact unknown"}
                  </p>
                  {entry.status === "pending" && entry.cues.length > 0 ? <details className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1">Conversation context <ChevronDown className="size-3" /></summary>
                    <div className="mt-2 space-y-2 border-l-2 border-[var(--color-border)] pl-3">
                      {entry.cues.flatMap(c => c.evidence).slice(0, 3).map((e, i) => <div key={e.source + e.messageId + i}><p className="mb-1">{labels[e.source]} · {date(e.sentAt, data.timezone)}</p><blockquote className="whitespace-pre-wrap break-words text-[var(--color-foreground)]">{e.excerpt}</blockquote></div>)}
                    </div>
                  </details> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1 sm:mt-0 sm:shrink-0">
                {entry.status === "pending" ? <>
                  <button className={actionClass} disabled={busy} onClick={() => void logCheckIn(entry, "call")} aria-label={`Log a call with ${entry.name}`}><Phone className="size-3.5" />Call</button>
                  <button className={actionClass} disabled={busy} onClick={() => void logCheckIn(entry, "text")} aria-label={`Log a text with ${entry.name}`}><MessageCircle className="size-3.5" />Text</button>
                  <button className={actionClass + " font-medium"} disabled={busy} onClick={() => openCheckIn(entry)} aria-label={`Mark ${entry.name} done`}><Check className="size-3.5" />Done</button>
                  <details className="relative">
                    <summary aria-label={`More options for ${entry.name}`} className={actionClass + " cursor-pointer list-none"}>•••</summary>
                    <div className="absolute right-0 z-10 mt-1 min-w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-md">
                      <button className={actionClass + " w-full justify-start"} disabled={busy} onClick={() => void act(entry, "snooze")}>Remind me in a week</button>
                      <button className={actionClass + " w-full justify-start"} disabled={busy} onClick={() => void act(entry, "replace")}>Someone else today</button>
                      <button className={actionClass + " w-full justify-start"} disabled={busy} onClick={() => void act(entry, "hide")}>Don’t suggest</button>
                      <label className="block px-3 py-2 text-xs">Check in every
                        <select aria-label={`Check-in frequency for ${entry.name}`} className="mt-1 block w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm" disabled={busy} value={entry.cadenceDays} onChange={e => void send("/api/call-sheet/settings", { personId: entry.personId, cadenceDays: Number(e.target.value) })}>
                          {[7, 14, 30, 60, 90, 180, 365, entry.cadenceDays].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map(n => <option key={n} value={n}>{n} days</option>)}
                        </select>
                      </label>
                    </div>
                  </details>
                </> : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 sm:px-5">
          {data.undoToken ? <button ref={undoButton} className={actionClass} disabled={busy} onClick={() => void send("/api/call-sheet", { dayId: data.day.id, version: data.day.version, action: "undo", undoToken: data.undoToken })}><RotateCcw className="size-3.5" />Undo last change</button> : <span className="text-xs text-[var(--color-muted-foreground)]">Your list stays steady throughout the day.</span>}
          <details className="w-full text-sm">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 py-2 text-xs text-[var(--color-muted-foreground)]"><Settings2 className="size-3.5" />Sources & preferences</summary>
            <div className="space-y-3 pb-3 pt-1">
              <p className="text-xs text-[var(--color-muted-foreground)]">Messages refresh from your Mac while it is awake.</p>
              {(["imessage", "whatsapp"] as const).map(source => {
                const state = data.sources[source];
                return <div key={source} className="flex flex-wrap items-start justify-between gap-2">
                  <div><span>{labels[source]}</span><p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{!state.enabled ? "Not connected" : state.status === "error" ? state.error ?? "Could not refresh. Check Mac access." : state.status === "ready" ? `Last updated ${date(state.lastSuccessAt, data.timezone)}` : "Waiting for your Mac to check conversations…"}</p></div>
                  <button className={actionClass} disabled={busy} onClick={() => void send("/api/call-sheet/settings", { source, enabled: !state.enabled })}>{state.enabled ? `Disconnect ${labels[source]}` : `Use ${labels[source]}`}</button>
                </div>;
              })}
              <label className="block text-xs text-[var(--color-muted-foreground)]">Time zone
                <input aria-label="Call sheet time zone" key={data.timezone} defaultValue={data.timezone} className="ml-2 max-w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm text-[var(--color-foreground)]" disabled={busy} onBlur={e => { const value = e.target.value.trim(); if (value && value !== data.timezone) void send("/api/call-sheet/settings", { timezone: value }); }} />
              </label>
              {data.hidden.length ? <div><p className="mb-1 text-xs text-[var(--color-muted-foreground)]">Hidden from your call sheet</p>{data.hidden.map(person => <div key={person.personId} className="flex items-center justify-between gap-2"><span>{person.name}</span><button className={actionClass} disabled={busy} onClick={() => void send("/api/call-sheet/settings", { restorePersonId: person.personId })}>Restore</button></div>)}</div> : null}
            </div>
          </details>
          {Object.values(data.sources).some(s => s.enabled && (s.status === "error" || !s.lastSuccessAt || Date.now() - Date.parse(s.lastSuccessAt) > 48 * 3600000)) ? <p role="status" className="pb-1 text-xs text-amber-700">Some message history is still waiting to refresh. Suggestions may be limited.</p> : null}
        </div>
      </> : null}
      {prompt ? <Sheet title="How did you reach out?" onClose={closeCheckIn}>
        <div className="px-4 pb-4 pt-2">
          <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">Log your check-in with {prompt.entry.name}.</p>
          {error ? <p role="alert" className="mb-3 rounded-lg bg-[var(--color-muted)] p-3 text-sm">{error}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(REACH_OUT_METHODS) as [ReachOutMethod, { label: string }][]).map(([method, choice], index) => (
              <button key={method} autoFocus={index === 0} type="button" disabled={busy} className={actionClass + " min-h-12 border border-[var(--color-border)]"} onClick={() => void completeCheckIn(method)}>{choice.label}</button>
            ))}
          </div>
          {busy ? <p role="status" className="mt-3 text-sm text-[var(--color-muted-foreground)]">Saving check-in…</p> : null}
          <button type="button" className={actionClass + " mt-3 w-full"} disabled={busy} onClick={closeCheckIn}>Cancel</button>
        </div>
      </Sheet> : null}
    </section>
  );
}
