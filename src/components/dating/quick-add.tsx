"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, type Stage } from "@/lib/dating";
import { Sheet } from "./sheet";

const field =
  "w-full rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const label = "block text-xs font-medium text-[var(--color-muted-foreground)] mb-1";
const primary =
  "pressable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50";
const ghost =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";

const STAGE_LABEL: Record<Stage, string> = {
  talking: "Talking",
  dating: "Dating",
  exclusive: "Exclusive",
  paused: "Paused",
  ended: "Ended",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "+ Add" on /dating: name and stage, plus the phone (so the iMessage sync
 * can match her), Instagram and how you met. Stays open after saving with a
 * link to her page, and refreshes the board so her card shows up behind it.
 */
export function QuickAdd({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>("talking");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [metVia, setMetVia] = useState("");
  const [metAt, setMetAt] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);

  const reset = () => {
    setName("");
    setStage("talking");
    setPhone("");
    setInstagram("");
    setMetVia("");
    setMetAt(today());
    setError(null);
    setAdded(null);
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        stage,
        handles: phone,
        instagram,
        metVia,
        metAt: metAt ? new Date(`${metAt}T12:00:00`).toISOString() : null,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Could not add her. Try again.");
    setAdded({ id: data.person.id, name: data.person.name });
    router.refresh();
  };

  return (
    <Sheet title="Add someone" onClose={onClose}>
      {added ? (
        <div className="px-4 pb-4 pt-2" role="status">
          <p className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-[var(--color-success)]" aria-hidden />
            Added {added.name}.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link autoFocus href={`/dating/${added.id}`} className={primary}>
              Open her page <ArrowRight className="size-4" />
            </Link>
            <button type="button" onClick={reset} className={ghost}>
              Add another
            </button>
            <button type="button" onClick={onClose} className={cn(ghost, "ml-auto")}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid grid-cols-2 gap-3 px-4 pb-4 pt-2"
        >
          <div className="col-span-2">
            <label htmlFor="qa-name" className={label}>
              Name
            </label>
            <input
              id="qa-name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="qa-stage" className={label}>
              Stage
            </label>
            <select id="qa-stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={field}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qa-phone" className={label}>
              Phone <span className="font-normal text-[var(--color-label-tertiary)]">for iMessage</span>
            </label>
            <input
              id="qa-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              className={field}
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="qa-instagram" className={label}>
              Instagram
            </label>
            <input
              id="qa-instagram"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@handle or profile link"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="qa-metvia" className={label}>
              Met via
            </label>
            <input
              id="qa-metvia"
              value={metVia}
              onChange={(e) => setMetVia(e.target.value)}
              placeholder="Hinge, a friend…"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="qa-metat" className={label}>
              Met on
            </label>
            <input id="qa-metat" type="date" value={metAt} onChange={(e) => setMetAt(e.target.value)} className={field} />
          </div>
          {error && (
            <p role="alert" className="col-span-2 text-sm text-[var(--color-destructive)]">
              {error}
            </p>
          )}
          <div className="col-span-2 flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={ghost}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className={primary}>
              {busy && <Loader2 className="size-4 animate-spin" />} Add
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
