"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Sparkles, X } from "lucide-react";
import type { CaptureProposal } from "@/lib/smart-capture";

type Project = { id: string; name: string; kind: string };

const PLACEHOLDERS = [
  "Paid $850 at Brooklyn Flea, in the living room",
  "Had dinner with Joe Milstein at Lucali",
  "Got a new oil filter for the Ferrari, $42 at NAPA",
  "Met with Hudson about Walden today",
  "Bought a vintage KitchenAid mixer from eBay for $220",
];

export function SmartCaptureForm({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CaptureProposal | null>(null);
  const [suggestedFollowupTitle, setSuggestedFollowupTitle] = useState<
    string | null
  >(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // Rotate the placeholder every 4s while the textarea is empty.
  useEffect(() => {
    if (text) return;
    const t = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length),
      4000,
    );
    return () => clearInterval(t);
  }, [text]);

  // Generate a preview (data URL via FileReader — more reliable on iOS
  // Safari + PWAs than URL.createObjectURL, which sometimes silently
  // returns a URL the <img> tag can't render).
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    console.log("[capture] FileReader start", { name: photo.name, size: photo.size, type: photo.type });
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled) return;
      const result = reader.result;
      console.log("[capture] FileReader onload", {
        type: typeof result,
        length: typeof result === "string" ? result.length : null,
      });
      if (typeof result === "string") setPhotoPreview(result);
    };
    reader.onerror = (err) => {
      console.error("[capture] FileReader onerror", err);
      if (!cancelled) {
        setError("Couldn't read that image. Try a different one.");
        setPhotoPreview(null);
      }
    };
    reader.readAsDataURL(photo);
    return () => {
      cancelled = true;
      try {
        reader.abort();
      } catch {}
    };
  }, [photo]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    console.log("[capture] onPickFile", {
      hasFile: !!f,
      name: f?.name,
      size: f?.size,
      type: f?.type,
    });
    if (f) setPhoto(f);
    // Reset so the user can re-pick the same file.
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onParse() {
    if (!text.trim() || parsing) return;
    setParsing(true);
    setError(null);
    setProposal(null);

    const form = new FormData();
    form.append("text", text.trim());
    if (photo) form.append("photo", photo);

    try {
      const res = await fetch("/api/capture/smart/parse", {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as
        | { proposal: CaptureProposal }
        | { error: string };
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : "Parse failed.");
        setParsing(false);
        return;
      }
      // Stash Claude's follow-up todo suggestion in a separate state and
      // strip it from the proposal — the user has to opt in via the UI.
      const incoming = body.proposal;
      if (incoming.type === "inventory" && incoming.followupTodo?.title) {
        setSuggestedFollowupTitle(incoming.followupTodo.title);
        setProposal({ ...incoming, followupTodo: null });
      } else {
        setSuggestedFollowupTitle(null);
        setProposal(incoming);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setParsing(false);
    }
  }

  async function onCommit() {
    if (!proposal || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/capture/smart/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal }),
      });
      const body = (await res.json()) as Record<string, unknown> & {
        error?: string;
      };
      if (!res.ok || body.error) {
        setError((body.error as string) ?? "Commit failed.");
        setCommitting(false);
        return;
      }
      // Route to the most relevant destination.
      if (proposal.projectId) {
        router.push(`/projects/${proposal.projectId}`);
      } else if (proposal.type === "inventory") {
        router.push("/inventory");
      } else {
        router.push("/friends");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setCommitting(false);
    }
  }

  function reset() {
    setProposal(null);
    setPhoto(null);
    setText("");
    setError(null);
  }

  if (proposal) {
    return (
      <Preview
        proposal={proposal}
        projects={projects}
        suggestedFollowupTitle={suggestedFollowupTitle}
        onChange={setProposal}
        onSave={onCommit}
        onDiscard={reset}
        committing={committing}
        error={error}
      />
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      {/* Photo zone — `photo` (not `photoPreview`) drives the branch so the
          user sees feedback the instant they pick a file, even before the
          FileReader finishes decoding. The label pattern (no JS .click())
          is the most reliable on iOS Safari + PWAs. */}
      {photo ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-6">
          <div className="relative">
            {photoPreview ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Capture preview"
                  className="max-h-[300px] w-auto rounded-lg object-contain"
                  onError={() => {
                    console.error("[capture] preview <img> failed to render", {
                      previewLen: photoPreview?.length,
                      photoType: photo?.type,
                      photoSize: photo?.size,
                    });
                    setError("Couldn't render that image. Try a different one.");
                  }}
                />
              </>
            ) : (
              <div className="grid h-40 w-64 place-items-center rounded-lg bg-[var(--color-background)] text-[var(--color-muted-foreground)]">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Loading preview…
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setPhoto(null)}
              className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] shadow"
              aria-label="Remove photo"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <label className="flex min-h-[160px] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-6 transition hover:border-[var(--color-foreground)]">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            className="sr-only"
          />
          <div className="text-center">
            <Camera className="mx-auto mb-2 size-7 text-[var(--color-muted-foreground)]" />
            <div className="text-sm font-medium">Take photo or upload</div>
            <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
              Camera or library — optional. Kaizen reads the image too.
            </div>
          </div>
        </label>
      )}

      {/* Text zone */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDERS[placeholderIdx]}
        rows={3}
        className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base focus:border-[var(--color-ring)] focus:outline-none"
      />

      {error ? <div className="text-sm text-rose-500">{error}</div> : null}

      <button
        onClick={onParse}
        disabled={!text.trim() || parsing}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-foreground)] text-base font-medium text-[var(--color-background)] disabled:opacity-50"
      >
        {parsing ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Sparkles className="size-5" />
        )}
        {parsing ? "Reading…" : "Parse with Claude"}
      </button>
    </div>
  );
}

interface PreviewProps {
  proposal: CaptureProposal;
  projects: Project[];
  suggestedFollowupTitle: string | null;
  onChange: (p: CaptureProposal) => void;
  onSave: () => void;
  onDiscard: () => void;
  committing: boolean;
  error: string | null;
}

function Preview({
  proposal,
  projects,
  suggestedFollowupTitle,
  onChange,
  onSave,
  onDiscard,
  committing,
  error,
}: PreviewProps) {
  function patch<P extends CaptureProposal>(part: Partial<P>) {
    onChange({ ...(proposal as P), ...part } as CaptureProposal);
  }

  return (
    <div className="max-w-xl space-y-4 pb-[calc(56px+96px+env(safe-area-inset-bottom))] md:pb-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Preview · {proposal.type}
          </div>
        </div>

        {proposal.type === "inventory" ? (
          <InventoryFields
            proposal={proposal}
            projects={projects}
            suggestedFollowupTitle={suggestedFollowupTitle}
            patch={patch}
          />
        ) : (
          <InteractionFields proposal={proposal} projects={projects} patch={patch} />
        )}
      </div>

      {error ? <div className="text-sm text-rose-500">{error}</div> : null}

      {/* Sticky approve bar — sits ABOVE the mobile bottom tab (56px) plus
          home-indicator safe area. On desktop it's a normal block. */}
      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3 md:static md:border-t-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <button
            onClick={onDiscard}
            disabled={committing}
            className="h-12 flex-1 rounded-xl border border-[var(--color-border)] text-base font-medium hover:bg-[var(--color-card)] disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={committing}
            className="inline-flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-[var(--color-foreground)] text-base font-semibold text-[var(--color-background)] disabled:opacity-50"
          >
            {committing ? <Loader2 className="size-4 animate-spin" /> : null}
            {committing ? "Saving…" : "Approve & save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-[var(--color-muted-foreground)]">
        {label}
      </div>
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none";

function InventoryFields({
  proposal,
  projects,
  suggestedFollowupTitle,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "inventory" }>;
  projects: Project[];
  suggestedFollowupTitle: string | null;
  patch: (part: Partial<Extract<CaptureProposal, { type: "inventory" }>>) => void;
}) {
  const followup = proposal.followupTodo ?? null;
  return (
    <div className="space-y-3">
      <Field label="Title">
        <input
          value={proposal.title}
          onChange={(e) => patch({ title: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Brand · Model">
        <input
          value={proposal.subtitle ?? ""}
          onChange={(e) => patch({ subtitle: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="You paid (USD)">
          <input
            type="number"
            value={proposal.costBasis ?? ""}
            onChange={(e) =>
              patch({ costBasis: e.target.value === "" ? null : Number(e.target.value) })
            }
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Market value (USD)">
          <input
            type="number"
            value={proposal.currentValue ?? ""}
            onChange={(e) =>
              patch({ currentValue: e.target.value === "" ? null : Number(e.target.value) })
            }
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Where you got it">
        <input
          value={proposal.sourceVendor ?? ""}
          onChange={(e) => patch({ sourceVendor: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select
            value={proposal.status ?? "owned"}
            onChange={(e) => patch({ status: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="owned">Owned</option>
            <option value="wishlist">Wishlist</option>
            <option value="exited">Exited (sold/gave away)</option>
            <option value="lost">Lost</option>
          </select>
        </Field>
        <Field label="Where it lives">
          <input
            value={proposal.location ?? ""}
            onChange={(e) => patch({ location: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Project">
        <ProjectSelect
          value={proposal.projectId ?? null}
          projects={projects}
          onChange={(v) => patch({ projectId: v })}
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={proposal.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={2}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Field>
      {/* Follow-up todo: opt-in, never auto-checked. If Claude suggested
          one, surface it as a subtle suggestion the user can add. Once
          added, the title is editable and a delete button removes it. */}
      {followup ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3">
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-[var(--color-muted-foreground)]">
              Follow-up todo (will be created)
            </div>
            <input
              value={followup.title}
              onChange={(e) =>
                patch({
                  followupTodo: { ...followup, title: e.target.value },
                })
              }
              className={INPUT_CLASS}
            />
          </div>
          <button
            type="button"
            onClick={() => patch({ followupTodo: null })}
            aria-label="Remove follow-up todo"
            className="mt-5 grid size-7 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : suggestedFollowupTitle ? (
        <button
          type="button"
          onClick={() =>
            patch({ followupTodo: { title: suggestedFollowupTitle } })
          }
          className="flex w-full items-center justify-between rounded-md border border-dashed border-[var(--color-border)] px-3 py-2.5 text-left text-sm text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]"
        >
          <span>
            <span className="opacity-60">Suggested:</span> Also add todo &ldquo;
            {suggestedFollowupTitle}&rdquo;
          </span>
          <span className="ml-3 text-base">+</span>
        </button>
      ) : null}
    </div>
  );
}

function InteractionFields({
  proposal,
  projects,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "interaction" }>;
  projects: Project[];
  patch: (part: Partial<Extract<CaptureProposal, { type: "interaction" }>>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Title">
        <input
          value={proposal.title}
          onChange={(e) => patch({ title: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select
            value={proposal.kind}
            onChange={(e) =>
              patch({ kind: e.target.value as typeof proposal.kind })
            }
            className={INPUT_CLASS}
          >
            <option value="dinner">Dinner</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="event">Event</option>
            <option value="message">Message</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="When">
          <input
            type="date"
            value={proposal.occurredAt?.slice(0, 10) ?? ""}
            onChange={(e) => patch({ occurredAt: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Where">
        <input
          value={proposal.location ?? ""}
          onChange={(e) => patch({ location: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="People">
        <div className="flex flex-wrap gap-2">
          {proposal.personHints.map((h, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-2.5 py-1 text-sm"
            >
              {h.firstName}
              {h.lastName ? ` ${h.lastName}` : ""}
              <button
                onClick={() =>
                  patch({
                    personHints: proposal.personHints.filter((_, j) => j !== i),
                  })
                }
                className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                aria-label="Remove"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <AddPersonChip
            onAdd={(firstName, lastName) =>
              patch({
                personHints: [
                  ...proposal.personHints,
                  { firstName, lastName: lastName || null },
                ],
              })
            }
          />
        </div>
      </Field>
      <Field label="Project">
        <ProjectSelect
          value={proposal.projectId ?? null}
          projects={projects}
          onChange={(v) => patch({ projectId: v })}
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={proposal.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={2}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Field>
    </div>
  );
}

function ProjectSelect({
  value,
  projects,
  onChange,
}: {
  value: string | null;
  projects: Project[];
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={INPUT_CLASS}
    >
      <option value="">— None —</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function AddPersonChip({
  onAdd,
}: {
  onAdd: (firstName: string, lastName: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        + add
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        const trimmed = name.trim();
        if (trimmed) {
          const [first, ...rest] = trimmed.split(/\s+/);
          onAdd(first, rest.join(" "));
        }
        setName("");
        setAdding(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setName("");
          setAdding(false);
        }
      }}
      placeholder="Joe Milstein"
      className="rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-sm focus:outline-none"
    />
  );
}
