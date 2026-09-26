"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Proposal, ProposedPerson } from "@/lib/dating";
import type { DatingEventDTO, DatingPersonDTO } from "@/lib/dating-server";

// Say (or type) how it's going; Claude files it. "File it" asks for a
// proposal, the review lists every change ticked, "Save" writes what stays
// ticked. With `personId` everything goes to that person.

export type DictateResult = {
  applied: { personId: string; name: string; created: boolean; eventIds: string[] }[];
  people: DatingPersonDTO[];
  events: DatingEventDTO[];
};

const input =
  "w-full rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const btn =
  "pressable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50";
const ghost =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";

// Web Speech API; not in every TS DOM lib, so just the bits used here.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Local YYYY-MM-DD, so "last night" means the user's last night.
const today = () => new Date().toLocaleDateString("en-CA");

export function DictateCard({
  personId,
  firstName,
  onSaved,
}: {
  personId?: string;
  firstName?: string;
  onSaved: (r: DictateResult) => void;
}) {
  const [text, setText] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ people: ProposedPerson[]; day: string } | null>(null);
  // Keys of unticked items: "p0", "p0:note", "p0:event:1", "p0:remember:2" …
  const [off, setOff] = useState<Set<string>>(new Set());
  const rec = useRef<Recognition | null>(null);

  // Decided after mount so server and client render the same markup.
  useEffect(() => setSupported(!!recognitionCtor()), []);
  useEffect(() => () => rec.current?.stop(), []);

  const toggleMic = () => {
    if (listening) return rec.current?.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = text.trim() ? `${text.trim()} ` : "";
    let finals = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += t;
        else interim += t;
      }
      setText(base + finals + interim);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access is blocked for this site.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Dictation stopped (${e.error}).`);
    };
    r.onend = () => {
      setListening(false);
      setText(base + finals);
      rec.current = null;
    };
    rec.current = r;
    setError(null);
    setDone(null);
    r.start();
    setListening(true);
  };

  const fileIt = async () => {
    rec.current?.stop();
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch("/api/dating/dictate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, personId, day: today() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not file that");
    if (!data.proposal?.people?.length) {
      return setError(personId ? "Nothing in that to file." : "Couldn't tell who that was about. Mention her by name.");
    }
    setOff(new Set());
    setProposal({ people: data.proposal.people, day: data.day });
  };

  const tick = (key: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const on = (key: string) => !off.has(key);

  const kept = (): Proposal => ({
    people: (proposal?.people ?? []).flatMap((p, i) => {
      const k = `p${i}`;
      if (!on(k)) return [];
      const keep = <T,>(xs: T[], field: string) => xs.filter((_, j) => on(`${k}:${field}:${j}`));
      return [
        {
          ...p,
          note: on(`${k}:note`) ? p.note : "",
          summary: on(`${k}:note`) ? p.summary : "",
          events: keep(p.events, "event"),
          remember: keep(p.remember, "remember"),
          greenFlags: keep(p.greenFlags, "greenFlags"),
          redFlags: keep(p.redFlags, "redFlags"),
          lessons: on(`${k}:lessons`) ? p.lessons : "",
          stage: on(`${k}:stage`) ? p.stage : null,
        },
      ];
    }),
  });

  const save = async () => {
    if (!proposal) return;
    const body = kept();
    if (!body.people.length) return setProposal(null);
    setBusy(true);
    const res = await fetch("/api/dating/dictate/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: body, day: proposal.day, personId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save");
    const r = data as DictateResult;
    setDone(
      r.applied.length
        ? `Filed to ${r.applied.map((a) => (a.created ? `${a.name} (new)` : a.name)).join(", ")}.`
        : "Nothing new to save.",
    );
    setProposal(null);
    setText("");
    onSaved(r);
  };

  const setNote = (i: number, note: string) =>
    setProposal((p) => p && { ...p, people: p.people.map((x, j) => (j === i ? { ...x, note } : x)) });

  return (
    <section className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Dictate</h3>
        {supported === false && (
          <span className="text-xs text-[var(--color-label-tertiary)]">Tap the mic on your keyboard to dictate</span>
        )}
      </div>

      {!proposal ? (
        <>
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={
                personId
                  ? `How's it going with ${firstName ?? "her"}? Last date, what she said, how you felt`
                  : "Talk about anyone: who you saw, what happened, what she mentioned. Claude files it to the right person."
              }
              className={cn(input, supported && "pr-12")}
              aria-label="Note"
            />
            {supported && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label={listening ? "Stop dictating" : "Dictate"}
                aria-pressed={listening}
                className={cn(
                  "pressable absolute right-2 top-2 rounded-full p-2 transition",
                  listening
                    ? "bg-[var(--color-destructive)] text-white animate-pulse"
                    : "bg-[var(--color-fill)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]",
                )}
              >
                {listening ? <Square className="size-4" /> : <Mic className="size-4" />}
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {listening ? "Listening… tap stop when you're done." : "You'll see what gets filed before it's saved."}
            </p>
            <button onClick={fileIt} disabled={busy || !text.trim()} className={btn}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} File it
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {proposal.people.map((p, i) => {
            const k = `p${i}`;
            const personOn = on(k);
            return (
              <div key={k} className={cn("space-y-2", !personOn && "opacity-50")}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={personOn} onChange={() => tick(k)} className="size-4 accent-[var(--color-tint)]" />
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.isNew && (
                    <span className="rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                      new person
                    </span>
                  )}
                </label>
                {personOn && (
                  <ul className="space-y-1.5 pl-6">
                    {(p.note || p.summary) && (
                      <Row checked={on(`${k}:note`)} onChange={() => tick(`${k}:note`)} label="Note">
                        {p.summary && <div className="text-sm font-medium">{p.summary}</div>}
                        <textarea
                          value={p.note}
                          onChange={(e) => setNote(i, e.target.value)}
                          rows={Math.min(10, Math.max(3, Math.ceil(p.note.length / 45)))}
                          className={cn(input, "mt-1")}
                          aria-label={`Note for ${p.name}`}
                        />
                      </Row>
                    )}
                    {p.events.map((e, j) => (
                      <Row key={`e${j}`} checked={on(`${k}:event:${j}`)} onChange={() => tick(`${k}:event:${j}`)} label={e.kind}>
                        <span className="text-sm">
                          {e.title}
                          <span className="text-[var(--color-muted-foreground)]">
                            {" "}
                            · {fmtDay(e.occurredAt)}
                            {e.vibe ? ` · vibe ${e.vibe}/10` : ""}
                          </span>
                        </span>
                        {e.notes && <p className="text-xs text-[var(--color-muted-foreground)]">{e.notes}</p>}
                      </Row>
                    ))}
                    {(
                      [
                        ["remember", "Remember"],
                        ["greenFlags", "Green flag"],
                        ["redFlags", "Red flag"],
                      ] as const
                    ).map(([field, label]) =>
                      p[field].map((item, j) => (
                        <Row
                          key={`${field}${j}`}
                          checked={on(`${k}:${field}:${j}`)}
                          onChange={() => tick(`${k}:${field}:${j}`)}
                          label={label}
                        >
                          <span className="text-sm">{item}</span>
                        </Row>
                      )),
                    )}
                    {p.lessons && (
                      <Row checked={on(`${k}:lessons`)} onChange={() => tick(`${k}:lessons`)} label="Lesson">
                        <span className="text-sm">{p.lessons}</span>
                      </Row>
                    )}
                    {p.stage && (
                      <Row checked={on(`${k}:stage`)} onChange={() => tick(`${k}:stage`)} label="Stage">
                        <span className="text-sm capitalize">{p.stage}</span>
                      </Row>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => setProposal(null)} disabled={busy} className={ghost}>
              Cancel
            </button>
            <button onClick={save} disabled={busy} className={btn}>
              {busy && <Loader2 className="size-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
      {done && <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{done}</p>}
    </section>
  );
}

function Row({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("flex items-start gap-2", !checked && "opacity-50")}>
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 size-4 shrink-0 accent-[var(--color-tint)]" aria-label={`Keep ${label}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-label-tertiary)]">{label}</div>
        {children}
      </div>
    </li>
  );
}

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
