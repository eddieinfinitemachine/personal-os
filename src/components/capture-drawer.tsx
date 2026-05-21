"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapture, type Capture } from "@/lib/capture-store";
import {
  ProposalEditor,
  type Project,
} from "@/components/smart-capture-form";

// Top-anchored drawer for the desktop background capture queue. Slides down
// from the top. Each pending capture is a card; "ready" cards embed the same
// editable ProposalEditor used on the /capture page.
export function CaptureDrawer() {
  const { captures, drawerOpen, setDrawerOpen, patch, commit, dismiss, retry } =
    useCapture();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);

  // Fetch active projects once when the drawer opens — needed by the
  // ProposalEditor for the project dropdown.
  useEffect(() => {
    if (!drawerOpen || projects.length > 0) return;
    let cancelled = false;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: { projects: Project[] }) => {
        if (!cancelled && Array.isArray(d.projects)) setProjects(d.projects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, projects.length]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  // Auto-close when the queue empties (e.g., last capture was approved).
  useEffect(() => {
    if (drawerOpen && captures.length === 0) setDrawerOpen(false);
  }, [drawerOpen, captures.length, setDrawerOpen]);

  if (!drawerOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 hidden md:block"
      onClick={(e) => {
        if (e.target === e.currentTarget) setDrawerOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="relative mx-auto mt-0 max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-b-2xl border-b border-x border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)]/95 px-5 py-3 backdrop-blur">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Captures
            </div>
            <div className="text-sm font-medium">
              {captures.length} pending
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {captures.map((c) => (
            <CaptureCard
              key={c.id}
              capture={c}
              projects={projects}
              onPatch={(p) => patch(c.id, p)}
              onSave={() => commit(c.id)}
              onDismiss={() => dismiss(c.id)}
              onRetry={() => retry(c.id)}
              onSavedRouteHint={(href) => {
                // Don't navigate automatically when approving from the
                // drawer — user is multitasking. They can click the seed
                // text to jump.
                void href;
                router; // keep router alive in scope for the no-op (eslint).
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CaptureCard({
  capture,
  projects,
  onPatch,
  onSave,
  onDismiss,
  onRetry,
}: {
  capture: Capture;
  projects: Project[];
  onPatch: (p: NonNullable<Capture["proposal"]>) => void;
  onSave: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onSavedRouteHint?: (href: string) => void;
}) {
  // Track Claude's followup suggestion separately from the proposal so the
  // ProposalEditor's "add follow-up" affordance still works.
  const suggestedFollowupTitle =
    capture.proposal &&
    capture.proposal.type === "asset" &&
    capture.proposal.followupTodo?.title
      ? capture.proposal.followupTodo.title
      : null;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-[var(--color-card)]",
        capture.status === "error"
          ? "border-rose-500/40"
          : "border-[var(--color-border)]",
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {capture.status}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium" title={capture.text}>
            {capture.text || <span className="opacity-50">(no text)</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {capture.status === "error" ? (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)]"
            >
              <RotateCcw className="size-3" /> Retry
            </button>
          ) : null}
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="grid size-7 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {capture.status === "parsing" ? (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="size-4 animate-spin" />
          Claude is reading…
        </div>
      ) : null}

      {capture.status === "saved" ? (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-3 text-sm text-emerald-500">
          <Check className="size-4" /> Saved
        </div>
      ) : null}

      {capture.status === "error" ? (
        <div className="flex items-start gap-2 border-t border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          <AlertCircle className="size-4 shrink-0" />
          <span>{capture.error ?? "Something went wrong."}</span>
        </div>
      ) : null}

      {(capture.status === "ready" || capture.status === "saving") &&
      capture.proposal ? (
        <div className="border-t border-[var(--color-border)] p-3">
          <ProposalEditor
            proposal={capture.proposal}
            projects={projects}
            suggestedFollowupTitle={suggestedFollowupTitle}
            onChange={onPatch}
            onSave={onSave}
            onDiscard={onDismiss}
            committing={capture.status === "saving"}
            error={null}
          />
        </div>
      ) : null}
    </div>
  );
}
