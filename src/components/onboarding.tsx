"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Calendar, Check, FolderPlus, Keyboard, ListPlus, Printer, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "personalos:onboarding-completed";

type Step = {
  icon: typeof Sparkles;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to your personal OS",
    body: "Tasks, projects, and the parts of your life worth tracking — all in one place. Two minutes to learn the basics.",
  },
  {
    icon: ListPlus,
    title: "Capture todos into lists",
    body: "Home shows three default lists — To Do, Monitor, Later. Click in any list to add a reminder, or press ⌘K from anywhere to capture fast.",
  },
  {
    icon: FolderPlus,
    title: "Group work into projects",
    body: "Projects live in the sidebar. Tag a todo with a project from its detail panel, or right-click any list item. Project pages show every task that belongs to it.",
  },
  {
    icon: ListPlus,
    title: "Add list templates",
    body: "Sidebar starts minimal. Click + Add list to enable templates like Trips, Vehicles, Friends, Inventory — each is a pre-built view tied to the things you track.",
  },
  {
    icon: Calendar,
    title: "See what's due",
    body: "Calendar gives a date-based view of todos and projects. Drag dates to reschedule.",
  },
  {
    icon: Printer,
    title: "Print or escape",
    body: "Print lists gives a clean single-page view of every open task. On the print page, press esc to bounce back to home.",
  },
  {
    icon: Keyboard,
    title: "Shortcuts to know",
    body: "⌘K = command palette · ⌘P inside the print view = system print dialog · esc = back. That's most of it.",
  },
];

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function finish() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setOpen(false);
  }
  function next() {
    if (step >= STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  }
  function prev() {
    setStep((s) => Math.max(0, s - 1));
  }

  if (!open) return null;
  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={finish}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
      >
        <button
          type="button"
          onClick={finish}
          aria-label="Close"
          className="absolute top-3 right-3 grid place-items-center size-8 rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        >
          <X className="size-4" />
        </button>

        <div className="px-6 pt-8 pb-4">
          <div className="grid place-items-center size-10 rounded-full bg-[var(--color-accent)] mb-4">
            <Icon className="size-5" />
          </div>
          <h2 id="onboarding-title" className="text-lg font-semibold tracking-tight">
            {s.title}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)] leading-relaxed">
            {s.body}
          </p>
        </div>

        <div className="px-6 pb-5 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1.5 rounded-full transition",
                  i === step
                    ? "bg-[var(--color-foreground)]"
                    : i < step
                      ? "bg-[var(--color-foreground)]/40"
                      : "bg-[var(--color-foreground)]/15",
                )}
              />
            ))}
          </div>
          <div className="flex-1" />
          {step > 0 ? (
            <button
              type="button"
              onClick={prev}
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {isLast ? (
              <>
                <Check className="size-3.5" />
                Got it
              </>
            ) : (
              <>
                Next
                <ArrowRight className="size-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
