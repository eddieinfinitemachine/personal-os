"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2, X } from "lucide-react";
import { haptic } from "@/lib/haptic";

// Mirrors ParsedPerson from /api/people/parse, with a client-only `include`
// flag and `interests`/`tags` kept as comma strings for easy editing.
type DraftPerson = {
  include: boolean;
  firstName: string;
  lastName: string;
  strength: string | null;
  email: string;
  phone: string;
  company: string;
  role: string;
  city: string;
  country: string;
  howWeMet: string;
  interests: string; // comma-separated in the editor
  tags: string; // comma-separated in the editor
  birthday: string;
  notes: string;
};

type ParsedPerson = {
  firstName: string;
  lastName?: string | null;
  strength?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  city?: string | null;
  country?: string | null;
  howWeMet?: string | null;
  interests?: string[];
  tags?: string[];
  birthday?: string | null;
  notes?: string | null;
};

const PLACEHOLDER = `Paste anything — a few names with context, a list, or a paragraph. For example:

Met Sarah Chen at the AI dinner in SF last week — she's a PM at Stripe, really into climbing. Her partner Jon was there too, photographer based in Brooklyn. Also reconnected with Dev Patel, old college friend, now a founder in Austin.`;

function normalizeName(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");
}

export function BulkAddPeople({
  open,
  onClose,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  existingNames: Set<string>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftPerson[]>([]);

  // Reset everything whenever the modal is opened fresh.
  useEffect(() => {
    if (open) {
      setPhase("input");
      setText("");
      setDrafts([]);
      setError(null);
      setParsing(false);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const includedCount = useMemo(
    () => drafts.filter((d) => d.include && d.firstName.trim()).length,
    [drafts]
  );

  if (!open) return null;

  async function parse() {
    const body = text.trim();
    if (!body) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/people/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Parse failed (HTTP ${res.status}).`);
        setParsing(false);
        return;
      }
      const { people } = (await res.json()) as { people: ParsedPerson[] };
      if (!people.length) {
        setError("No people found in that text. Try adding names and detail.");
        setParsing(false);
        return;
      }
      setDrafts(
        people.map((p) => ({
          include: true,
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          strength: p.strength ?? null,
          email: p.email ?? "",
          phone: p.phone ?? "",
          company: p.company ?? "",
          role: p.role ?? "",
          city: p.city ?? "",
          country: p.country ?? "",
          howWeMet: p.howWeMet ?? "",
          interests: (p.interests ?? []).join(", "),
          tags: (p.tags ?? []).join(", "),
          birthday: p.birthday ?? "",
          notes: p.notes ?? "",
        }))
      );
      haptic("success");
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    const payload = drafts
      .filter((d) => d.include && d.firstName.trim())
      .map((d) => ({
        firstName: d.firstName.trim(),
        lastName: d.lastName || null,
        strength: d.strength,
        email: d.email || null,
        phone: d.phone || null,
        company: d.company || null,
        role: d.role || null,
        city: d.city || null,
        country: d.country || null,
        howWeMet: d.howWeMet || null,
        interests: d.interests
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        tags: d.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        birthday: d.birthday || null,
        notes: d.notes || null,
      }));
    if (payload.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/people/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ people: payload }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Add failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      haptic("success");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setSubmitting(false);
    }
  }

  function update(i: number, patch: Partial<DraftPerson>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 pb-[calc(56px+env(safe-area-inset-bottom))] sm:p-4 sm:pb-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)] rounded-t-2xl">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-[var(--color-muted-foreground)]" />
            {phase === "input" ? "Bulk add people" : `Review ${includedCount} ${includedCount === 1 ? "person" : "people"}`}
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--color-accent)]">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4">
          {phase === "input" ? (
            <div className="grid gap-3">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Type or paste freeform notes about people — names, where you met,
                what they do, where they live. Claude turns it into structured
                contacts you can review before adding.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={10}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm leading-relaxed focus:border-[var(--color-ring)] focus:outline-none resize-y"
              />
            </div>
          ) : (
            <div className="grid gap-3">
              {drafts.map((d, i) => {
                const dup = existingNames.has(normalizeName(d.firstName, d.lastName));
                return (
                  <div
                    key={i}
                    className={
                      "rounded-xl border p-3 " +
                      (d.include
                        ? "border-[var(--color-border)] bg-[var(--color-background)]"
                        : "border-dashed border-[var(--color-border)] opacity-50")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={d.include}
                        onChange={(e) => update(i, { include: e.target.checked })}
                        className="mt-1 size-4 accent-[var(--color-foreground)]"
                      />
                      <div className="flex-1 grid gap-2 grid-cols-2">
                        <BInput placeholder="First name" value={d.firstName} onChange={(v) => update(i, { firstName: v })} />
                        <BInput placeholder="Last name" value={d.lastName} onChange={(v) => update(i, { lastName: v })} />
                        <BInput placeholder="Role" value={d.role} onChange={(v) => update(i, { role: v })} />
                        <BInput placeholder="Company" value={d.company} onChange={(v) => update(i, { company: v })} />
                        <BInput placeholder="City" value={d.city} onChange={(v) => update(i, { city: v })} />
                        <BInput placeholder="Interests (comma-sep)" value={d.interests} onChange={(v) => update(i, { interests: v })} />
                        <div className="col-span-2">
                          <BInput placeholder="How you met / context" value={d.howWeMet} onChange={(v) => update(i, { howWeMet: v })} />
                        </div>
                        {(d.email || d.phone) && (
                          <>
                            <BInput placeholder="Email" value={d.email} onChange={(v) => update(i, { email: v })} />
                            <BInput placeholder="Phone" value={d.phone} onChange={(v) => update(i, { phone: v })} />
                          </>
                        )}
                        {dup && d.include ? (
                          <div className="col-span-2 text-xs text-amber-600 dark:text-amber-500">
                            ⚠ You already have a “{d.firstName} {d.lastName}”. Uncheck to skip.
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                        className="mt-1 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                        aria-label="Remove"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error ? <p className="mt-3 text-sm text-rose-500">{error}</p> : null}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          {phase === "input" ? (
            <>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Reviewed before anything is saved.
              </span>
              <button
                onClick={parse}
                disabled={!text.trim() || parsing}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
              >
                {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {parsing ? "Parsing…" : "Parse"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPhase("input")}
                className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-2 py-2"
              >
                ← Back to text
              </button>
              <button
                onClick={submit}
                disabled={includedCount === 0 || submitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {submitting ? "Adding…" : `Add ${includedCount} ${includedCount === 1 ? "person" : "people"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[36px]"
    />
  );
}
