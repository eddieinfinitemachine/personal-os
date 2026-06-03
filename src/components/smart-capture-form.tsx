"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Loader2, Sparkles, X } from "lucide-react";
import type { CaptureProposal } from "@/lib/smart-capture";

export type Project = { id: string; name: string; kind: string };

const PLACEHOLDERS = [
  "Paid $850 at Brooklyn Flea, in the living room",
  "Had dinner with Joe Milstein at Lucali",
  "Got a new oil filter for the Ferrari, $42 at NAPA",
  "Met with Hudson about Walden today",
  "Bought a vintage KitchenAid mixer from eBay for $220",
];

export function SmartCaptureForm({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  // Pre-fill text from URL (?text=…) — set from the ⌘K command palette so
  // typing a sentence into the palette and hitting Enter lands you here with
  // the input already populated.
  const initialText = searchParams.get("text") ?? "";
  const autoparse = searchParams.get("autoparse") === "1";

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [text, setText] = useState(initialText);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CaptureProposal | null>(null);
  const [suggestedFollowupTitle, setSuggestedFollowupTitle] = useState<
    string | null
  >(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const autoparseTriggered = useRef(false);

  // Rotate the placeholder every 4s while the textarea is empty.
  useEffect(() => {
    if (text) return;
    const t = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length),
      4000,
    );
    return () => clearInterval(t);
  }, [text]);

  // Auto-parse when navigated here from ⌘K with ?autoparse=1 — runs once.
  useEffect(() => {
    if (!autoparse || autoparseTriggered.current) return;
    if (!initialText.trim()) return;
    autoparseTriggered.current = true;
    // Defer one tick so all state is mounted.
    setTimeout(() => onParse(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoparse, initialText]);

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
    if (photo) {
      try {
        const compressed = await compressImage(photo);
        console.log("[capture] compressed", {
          original: photo.size,
          compressed: compressed.size,
        });
        form.append("photo", compressed);
      } catch (e) {
        console.error("[capture] compression failed", e);
        // Fall back to original — server will reject if too large.
        form.append("photo", photo);
      }
    }

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
      if (incoming.type === "asset" && incoming.followupTodo?.title) {
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
      // Post-save routing per proposal type.
      const projectHop =
        (proposal.type === "asset" || proposal.type === "todo") &&
        proposal.projectId;
      if (projectHop) {
        router.push(`/projects/${projectHop}`);
      } else if (proposal.type === "asset") {
        // 5 asset kinds → 5 sections.
        const ROUTE: Record<typeof proposal.assetKind, string> = {
          inventory: "/inventory",
          investment: "/investments",
          media: "/media",
          place: "/places",
          practice: "/best-practices",
        };
        router.push(ROUTE[proposal.assetKind] ?? "/inventory");
      } else if (proposal.type === "trip") {
        router.push("/trips");
      } else if (proposal.type === "todo") {
        router.push("/");
      } else {
        // interaction + person land on /friends.
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

export type ProposalEditorProps = {
  proposal: CaptureProposal;
  projects: Project[];
  suggestedFollowupTitle: string | null;
  onChange: (p: CaptureProposal) => void;
  onSave: () => void;
  onDiscard: () => void;
  committing: boolean;
  error: string | null;
};
// Re-exported for callers that mount the editor outside SmartCaptureForm
// (e.g. the capture drawer renders one per ready capture).
export type PreviewProps = ProposalEditorProps;

export function ProposalEditor(props: ProposalEditorProps) {
  return <Preview {...props} />;
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
    <div className="max-w-xl space-y-4 pb-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Preview · {previewLabel(proposal)}
          </div>
        </div>

        {proposal.type === "asset" ? (
          <InventoryFields
            proposal={proposal}
            projects={projects}
            suggestedFollowupTitle={suggestedFollowupTitle}
            patch={patch}
          />
        ) : proposal.type === "interaction" ? (
          <InteractionFields proposal={proposal} projects={projects} patch={patch} />
        ) : proposal.type === "person" ? (
          <PersonFields proposal={proposal} patch={patch} />
        ) : proposal.type === "trip" ? (
          <TripFields proposal={proposal} patch={patch} />
        ) : (
          <TodoFields proposal={proposal} projects={projects} patch={patch} />
        )}

        {error ? <div className="mt-3 text-sm text-rose-500">{error}</div> : null}

        {/* Action buttons live INSIDE the card, normal flow. No fixed/sticky —
            iOS Safari's collapsing address bar makes fixed-bottom elements
            slide around, which feels broken. */}
        <div className="mt-5 flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
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

type AssetKind = Extract<CaptureProposal, { type: "asset" }>["assetKind"];

type AssetKindUi = {
  titleLabel: string;
  subtitleLabel: string;
  subtitlePlaceholder?: string;
  money?: { paidLabel: string; valueLabel: string };
  vendor?: { label: string };
  location?: { label: string; placeholder?: string };
  statusOptions: { value: string; label: string }[];
};

const ASSET_KIND_UI: Record<AssetKind, AssetKindUi> = {
  inventory: {
    titleLabel: "Title",
    subtitleLabel: "Brand · Model",
    money: { paidLabel: "You paid (USD)", valueLabel: "Market value (USD)" },
    vendor: { label: "Where you got it" },
    location: { label: "Where it lives" },
    statusOptions: [
      { value: "owned", label: "Owned" },
      { value: "wishlist", label: "Wishlist" },
      { value: "exited", label: "Exited (sold/gave away)" },
      { value: "lost", label: "Lost" },
    ],
  },
  investment: {
    titleLabel: "Investment",
    subtitleLabel: "Type / vehicle",
    subtitlePlaceholder: "venture · stocks · crypto · real estate",
    money: { paidLabel: "Amount invested (USD)", valueLabel: "Current value (USD)" },
    vendor: { label: "Through (broker / fund / platform)" },
    statusOptions: [
      { value: "active", label: "Active" },
      { value: "exited", label: "Exited" },
      { value: "wishlist", label: "Considering" },
    ],
  },
  media: {
    titleLabel: "Title",
    subtitleLabel: "Author / creator",
    statusOptions: [
      { value: "to-read", label: "To read" },
      { value: "to-watch", label: "To watch" },
      { value: "to-listen", label: "To listen" },
      { value: "in-progress", label: "In progress" },
      { value: "consumed", label: "Consumed" },
      { value: "wishlist", label: "Wishlist (unsure)" },
    ],
  },
  place: {
    titleLabel: "Place",
    subtitleLabel: "Cuisine / type",
    subtitlePlaceholder: "ramen · cocktail bar · trail · hotel",
    location: { label: "Address / area", placeholder: "46 Bowery, NYC" },
    statusOptions: [
      { value: "wishlist", label: "Want to go" },
      { value: "visited", label: "Visited" },
      { value: "saved", label: "Saved" },
    ],
  },
  practice: {
    titleLabel: "Practice",
    subtitleLabel: "Area",
    subtitlePlaceholder: "fitness · finance · mind · creativity",
    statusOptions: [
      { value: "active", label: "Active" },
      { value: "exited", label: "Stopped" },
    ],
  },
};

function InventoryFields({
  proposal,
  projects,
  suggestedFollowupTitle,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "asset" }>;
  projects: Project[];
  suggestedFollowupTitle: string | null;
  patch: (part: Partial<Extract<CaptureProposal, { type: "asset" }>>) => void;
}) {
  const followup = proposal.followupTodo ?? null;
  const ui = ASSET_KIND_UI[proposal.assetKind];
  return (
    <div className="space-y-3">
      <Field label={ui.titleLabel}>
        <input
          value={proposal.title}
          onChange={(e) => patch({ title: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label={ui.subtitleLabel}>
        <input
          value={proposal.subtitle ?? ""}
          onChange={(e) => patch({ subtitle: e.target.value })}
          placeholder={ui.subtitlePlaceholder}
          className={INPUT_CLASS}
        />
      </Field>
      {ui.money ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={ui.money.paidLabel}>
            <input
              type="number"
              value={proposal.costBasis ?? ""}
              onChange={(e) =>
                patch({ costBasis: e.target.value === "" ? null : Number(e.target.value) })
              }
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={ui.money.valueLabel}>
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
      ) : null}
      {ui.vendor ? (
        <Field label={ui.vendor.label}>
          <input
            value={proposal.sourceVendor ?? ""}
            onChange={(e) => patch({ sourceVendor: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      ) : null}
      {ui.location ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select
              value={proposal.status ?? ui.statusOptions[0].value}
              onChange={(e) => patch({ status: e.target.value })}
              className={INPUT_CLASS}
            >
              {ui.statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={ui.location.label}>
            <input
              value={proposal.location ?? ""}
              onChange={(e) => patch({ location: e.target.value })}
              placeholder={ui.location.placeholder}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      ) : (
        <Field label="Status">
          <select
            value={proposal.status ?? ui.statusOptions[0].value}
            onChange={(e) => patch({ status: e.target.value })}
            className={INPUT_CLASS}
          >
            {ui.statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
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

function PersonFields({
  proposal,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "person" }>;
  patch: (part: Partial<Extract<CaptureProposal, { type: "person" }>>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input
            value={proposal.firstName}
            onChange={(e) => patch({ firstName: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Last name">
          <input
            value={proposal.lastName ?? ""}
            onChange={(e) => patch({ lastName: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <input
            value={proposal.role ?? ""}
            onChange={(e) => patch({ role: e.target.value })}
            placeholder="artist · founder · engineer"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Company">
          <input
            value={proposal.company ?? ""}
            onChange={(e) => patch({ company: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <input
            value={proposal.city ?? ""}
            onChange={(e) => patch({ city: e.target.value })}
            placeholder="São Paulo"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Country">
          <input
            value={proposal.country ?? ""}
            onChange={(e) => patch({ country: e.target.value })}
            placeholder="Brazil"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Strength">
          <select
            value={proposal.strength ?? ""}
            onChange={(e) =>
              patch({
                strength:
                  (e.target.value || null) as
                    | "close"
                    | "strong"
                    | "casual"
                    | "weak"
                    | null,
              })
            }
            className={INPUT_CLASS}
          >
            <option value="">—</option>
            <option value="close">Close</option>
            <option value="strong">Strong</option>
            <option value="casual">Casual</option>
            <option value="weak">Weak</option>
          </select>
        </Field>
        <Field label="How we met">
          <input
            value={proposal.howWeMet ?? ""}
            onChange={(e) => patch({ howWeMet: e.target.value })}
            placeholder="intro from Maya"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Interests">
        <input
          value={(proposal.interests ?? []).join(", ")}
          onChange={(e) =>
            patch({
              interests: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="climbing, Brazilian art, venture"
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LinkedIn">
          <input
            value={proposal.socialUrls?.linkedin ?? ""}
            onChange={(e) =>
              patch({
                socialUrls: { ...(proposal.socialUrls ?? {}), linkedin: e.target.value || null },
              })
            }
            placeholder="https://linkedin.com/in/…"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Twitter / X">
          <input
            value={proposal.socialUrls?.twitter ?? ""}
            onChange={(e) =>
              patch({
                socialUrls: { ...(proposal.socialUrls ?? {}), twitter: e.target.value || null },
              })
            }
            placeholder="https://x.com/…"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Instagram">
          <input
            value={proposal.socialUrls?.instagram ?? ""}
            onChange={(e) =>
              patch({
                socialUrls: { ...(proposal.socialUrls ?? {}), instagram: e.target.value || null },
              })
            }
            placeholder="https://instagram.com/…"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Website">
          <input
            value={proposal.socialUrls?.website ?? ""}
            onChange={(e) =>
              patch({
                socialUrls: { ...(proposal.socialUrls ?? {}), website: e.target.value || null },
              })
            }
            placeholder="https://…"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <input
            value={proposal.email ?? ""}
            onChange={(e) => patch({ email: e.target.value })}
            type="email"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Phone">
          <input
            value={proposal.phone ?? ""}
            onChange={(e) => patch({ phone: e.target.value })}
            type="tel"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          value={proposal.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={3}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Field>
    </div>
  );
}

function TripFields({
  proposal,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "trip" }>;
  patch: (part: Partial<Extract<CaptureProposal, { type: "trip" }>>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          value={proposal.name}
          onChange={(e) => patch({ name: e.target.value })}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Destination">
        <input
          value={proposal.destination ?? ""}
          onChange={(e) => patch({ destination: e.target.value })}
          placeholder="Tokyo, Japan"
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <input
            type="date"
            value={proposal.startDate ?? ""}
            onChange={(e) => patch({ startDate: e.target.value || null })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="End">
          <input
            type="date"
            value={proposal.endDate ?? ""}
            onChange={(e) => patch({ endDate: e.target.value || null })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select
            value={proposal.status ?? "planned"}
            onChange={(e) =>
              patch({ status: e.target.value as typeof proposal.status })
            }
            className={INPUT_CLASS}
          >
            <option value="planned">Planned</option>
            <option value="booked">Booked</option>
            <option value="active">Active</option>
            <option value="past">Past</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Cost (USD)">
          <input
            type="number"
            value={proposal.costUsd ?? ""}
            onChange={(e) =>
              patch({ costUsd: e.target.value === "" ? null : Number(e.target.value) })
            }
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Transport">
          <input
            value={proposal.transport ?? ""}
            onChange={(e) => patch({ transport: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Accommodation">
          <input
            value={proposal.accommodation ?? ""}
            onChange={(e) => patch({ accommodation: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Travelers">
        <input
          value={(proposal.travelers ?? []).join(", ")}
          onChange={(e) =>
            patch({
              travelers: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="comma-separated"
          className={INPUT_CLASS}
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

function TodoFields({
  proposal,
  projects,
  patch,
}: {
  proposal: Extract<CaptureProposal, { type: "todo" }>;
  projects: Project[];
  patch: (part: Partial<Extract<CaptureProposal, { type: "todo" }>>) => void;
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
        <Field label="Due">
          <input
            type="date"
            value={proposal.dueDate ?? ""}
            onChange={(e) => patch({ dueDate: e.target.value || null })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="List">
          <div
            className={`${INPUT_CLASS} flex items-center text-[var(--color-muted-foreground)]`}
          >
            Inbox · sort it later
          </div>
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
    </div>
  );
}

function previewLabel(p: CaptureProposal): string {
  if (p.type === "asset") return p.assetKind;
  return p.type;
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

// ---- Image compression ----------------------------------------------------
//
// Anthropic's API rejects base64 images > 5MB. iPhone photos can be 3-4MB
// raw, which becomes 5-6MB once base64-encoded. Claude vision also doesn't
// benefit from images > 1568px on the longest edge (their docs).
//
// Resize on the client before upload: max longest edge 1568px, JPEG q=0.85.
// Typical photo drops from 3MB → 200-400KB. Also speeds up the upload.

const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

async function compressImage(file: File): Promise<File> {
  // Non-images (or already-tiny files) pass through unchanged.
  if (!file.type.startsWith("image/")) return file;

  const img = await loadImage(file);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const longest = Math.max(width, height);
  const scale = longest > MAX_LONG_EDGE ? MAX_LONG_EDGE / longest : 1;

  // Don't bother re-encoding if it's already small AND under 4MB.
  if (scale === 1 && file.size < 4 * 1024 * 1024) return file;

  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) return file;

  const baseName = file.name.replace(/\.[^.]+$/, "") || "capture";
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

// Loads a File into an <img> element with object-URL src so we can draw it
// to a canvas. Works everywhere including older iOS Safari.
async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  } finally {
    // Revoke after the next tick so the image has finished decoding.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
