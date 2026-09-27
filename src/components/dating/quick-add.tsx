"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { STAGES, type Stage } from "@/lib/dating";
import { Sheet } from "./sheet";

const field =
  "w-full min-h-11 rounded-md bg-[var(--color-fill-secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const label =
  "block text-xs font-medium text-[var(--color-muted-foreground)] mb-1";
const primary =
  "pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50";
const ghost =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-50";
const STAGE_LABEL: Record<Stage, string> = {
  talking: "Pursuing",
  dating: "Dating",
  exclusive: "Exclusive",
  paused: "Paused",
  ended: "Ended",
};
type Draft = {
  name: string;
  stage: Stage | null;
  handles: string[];
  instagram: string | null;
  metVia: string | null;
  metAt: string | null;
  endedAt: string | null;
  age: number | null;
  city: string | null;
  work: string | null;
  notes: string;
  remember: string[];
  greenFlags: string[];
  redFlags: string[];
  lessons: string | null;
};
const blank = (): Draft => ({
  name: "",
  stage: null,
  handles: [],
  instagram: null,
  metVia: null,
  metAt: null,
  endedAt: null,
  age: null,
  city: null,
  work: null,
  notes: "",
  remember: [],
  greenFlags: [],
  redFlags: [],
  lessons: null,
});
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function QuickAdd({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phone, setPhone] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const reset = () => {
    setText("");
    setDraft(null);
    setPhone("");
    setWarnings([]);
    setExisting(null);
    setError(null);
    setAdded(null);
  };
  const prepare = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dating/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, today: today() }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error ||
            "Could not read that yet. Try again, or enter details yourself.",
        );
      setDraft(data.draft);
      setPhone(data.draft.handles.join(", "));
      setWarnings(data.warnings || []);
      setExisting(data.existingPerson || null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read that yet. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!draft?.name.trim() || !draft.stage || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, handles: phone }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error ||
            "Could not save. Your details are still here; try again.",
        );
      setAdded({ id: data.person.id, name: data.person.name });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={draft ? "Check the details" : "Add someone"}
      onClose={onClose}
    >
      <div className="px-4 pb-4 pt-2">
        {added ? (
          <div role="status">
            <p className="flex items-center gap-2 text-sm">
              <Check
                className="size-4 text-[var(--color-success)]"
                aria-hidden
              />
              Added {added.name}.
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
              The Mac sync checks saved contacts and matching messages on its
              next run. New messages will refresh her summary automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link autoFocus href={`/dating/${added.id}`} className={primary}>
                Open her page <ArrowRight className="size-4" />
              </Link>
              <button onClick={reset} className={ghost}>
                Add another
              </button>
              <button onClick={onClose} className={ghost}>
                Done
              </button>
            </div>
          </div>
        ) : !draft ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="qa-context"
                className="mb-2 block text-sm font-medium"
              >
                Tell me about her
              </label>
              <textarea
                id="qa-context"
                autoFocus
                required
                rows={6}
                maxLength={12000}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                className={field}
                placeholder="Noa Cohen — we met through a friend last week. I’d like to ask her out. She lives in Brooklyn and works in design. We’ve been talking on WhatsApp…"
              />
            </div>
            <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              Include her full name and whatever you remember. I’ll fill in the
              details I can support and check saved contacts. You can review
              everything before adding her.
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Instagram: paste a handle or profile link if you know it.
              Automatic lookup in your Instagram account isn’t connected yet.
            </p>
            {error && (
              <p
                role="alert"
                className="text-sm text-[var(--color-destructive)]"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                disabled={busy}
                className={ghost}
                onClick={() => {
                  setDraft({ ...blank(), notes: text });
                  setPhone("");
                  setWarnings([]);
                  setExisting(null);
                  setError(null);
                }}
              >
                Enter details myself
              </button>
              <button disabled={busy || !text.trim()} className={primary}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading…
                  </>
                ) : (
                  <>
                    Fill in details <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Check what I understood. Unknown details stay blank.
            </p>
            {existing && (
              <div className="rounded-md bg-[var(--color-fill-secondary)] p-3 text-sm">
                <p>{existing.name} already has a page.</p>
                <Link
                  href={`/dating/${existing.id}`}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 underline"
                >
                  Open existing page <ArrowRight className="size-4" />
                </Link>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Only add another if this is a different person.
                </p>
              </div>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <fieldset
              disabled={busy}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <div>
                <label htmlFor="qa-name" className={label}>
                  Name
                </label>
                <input
                  id="qa-name"
                  autoFocus
                  required
                  value={draft.name}
                  onChange={(e) => {
                    update({ name: e.target.value });
                    setExisting(null);
                  }}
                  className={field}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="qa-stage" className={label}>
                  Stage
                </label>
                <select
                  id="qa-stage"
                  required
                  value={draft.stage || ""}
                  onChange={(e) => update({ stage: e.target.value as Stage })}
                  className={field}
                >
                  <option value="" disabled>
                    Choose a stage
                  </option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="qa-phone" className={label}>
                  Phone or email
                </label>
                <input
                  id="qa-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={field}
                  placeholder="Checked during Mac sync if blank"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="qa-instagram" className={label}>
                  Instagram
                </label>
                <input
                  id="qa-instagram"
                  value={draft.instagram || ""}
                  onChange={(e) => update({ instagram: e.target.value })}
                  className={field}
                  placeholder="@handle or profile link"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <label htmlFor="qa-metvia" className={label}>
                  Met via
                </label>
                <input
                  id="qa-metvia"
                  value={draft.metVia || ""}
                  onChange={(e) => update({ metVia: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="qa-metat" className={label}>
                  Met on
                </label>
                <input
                  id="qa-metat"
                  type="date"
                  value={draft.metAt?.slice(0, 10) || ""}
                  onChange={(e) =>
                    update({
                      metAt: e.target.value
                        ? `${e.target.value}T12:00:00.000Z`
                        : null,
                    })
                  }
                  className={field}
                />
              </div>
              {draft.stage === "ended" && (
                <div>
                  <label htmlFor="qa-endedat" className={label}>
                    Ended on
                  </label>
                  <input
                    id="qa-endedat"
                    type="date"
                    value={draft.endedAt?.slice(0, 10) || ""}
                    onChange={(e) =>
                      update({
                        endedAt: e.target.value
                          ? `${e.target.value}T12:00:00.000Z`
                          : null,
                      })
                    }
                    className={field}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="qa-notes" className={label}>
                  Your context
                </label>
                <textarea
                  id="qa-notes"
                  rows={4}
                  value={draft.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  className={field}
                />
              </div>
              <details className="sm:col-span-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">
                  More details
                </summary>
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor="qa-age" className={label}>
                      Age
                    </label>
                    <input
                      id="qa-age"
                      type="number"
                      min={18}
                      max={120}
                      value={draft.age ?? ""}
                      onChange={(e) =>
                        update({
                          age: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className={field}
                    />
                  </div>
                  {(
                    [
                      ["city", "City"],
                      ["work", "Work"],
                    ] as const
                  ).map(([key, title]) => (
                    <div key={key}>
                      <label htmlFor={`qa-${key}`} className={label}>
                        {title}
                      </label>
                      <input
                        id={`qa-${key}`}
                        value={draft[key] || ""}
                        onChange={(e) => update({ [key]: e.target.value })}
                        className={field}
                      />
                    </div>
                  ))}
                  {(
                    [
                      ["remember", "Remember"],
                      ["greenFlags", "Green flags"],
                      ["redFlags", "Red flags"],
                    ] as const
                  ).map(([key, title]) => (
                    <div key={key} className="sm:col-span-2">
                      <label htmlFor={`qa-${key}`} className={label}>
                        {title} (one per line)
                      </label>
                      <textarea
                        id={`qa-${key}`}
                        rows={2}
                        value={draft[key].join("\n")}
                        onChange={(e) =>
                          update({ [key]: e.target.value.split("\n") })
                        }
                        className={field}
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label htmlFor="qa-lessons" className={label}>
                      Lessons
                    </label>
                    <textarea
                      id="qa-lessons"
                      rows={2}
                      value={draft.lessons || ""}
                      onChange={(e) => update({ lessons: e.target.value })}
                      className={field}
                    />
                  </div>
                </div>
              </details>
            </fieldset>
            {error && (
              <p
                role="alert"
                className="text-sm text-[var(--color-destructive)]"
              >
                {error}
              </p>
            )}
            <div className="flex justify-between gap-2">
              <button
                type="button"
                className={ghost}
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Back to paragraph
              </button>
              <button
                disabled={busy || !draft.name.trim() || !draft.stage}
                className={primary}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}Add person
              </button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
