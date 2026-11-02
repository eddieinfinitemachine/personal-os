"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CaptureProposal } from "@/lib/smart-capture";

export type CaptureStatus = "parsing" | "ready" | "saving" | "saved" | "error";

export type Capture = {
  id: string;
  status: CaptureStatus;
  text: string;
  proposal?: CaptureProposal;
  error?: string;
  createdAt: number;
};

export type CaptureStore = {
  captures: Capture[];
  enqueue: (text: string) => string;
  retry: (id: string) => void;
  patch: (id: string, proposal: CaptureProposal) => void;
  commit: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
};

const Ctx = createContext<CaptureStore | null>(null);
const STORAGE_KEY = "ec:capture-queue";

// Keep an interrupted Save retryable with its original proposal and action ID.
// Parsing can be restarted; completed captures do not need local persistence.
const PERSISTABLE: CaptureStatus[] = ["ready", "error"];

function persist(captures: Capture[]) {
  if (typeof window === "undefined") return;
  try {
    const subset = captures
      .map((c): Capture => c.status === "saving" ? { ...c, status: "error", error: "Save interrupted. Retry to check whether it saved." } : c)
      .filter((c) => PERSISTABLE.includes(c.status));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subset));
  } catch {}
}

function hydrate(): Capture[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Capture[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.id === "string" && PERSISTABLE.includes(c.status));
  } catch {
    return [];
  }
}

function makeId(): string {
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const saving = useRef(new Set<string>());
  // Track which captures were previously "parsing" so the inbox pill can
  // detect parsing → ready transitions for the pulse animation.
  const prevStatusRef = useRef<Map<string, CaptureStatus>>(new Map());

  // Hydrate from localStorage on first mount.
  useEffect(() => {
    setCaptures(hydrate());
  }, []);

  // Persist whenever captures change.
  useEffect(() => {
    persist(captures);
    const next = new Map<string, CaptureStatus>();
    for (const c of captures) next.set(c.id, c.status);
    prevStatusRef.current = next;
  }, [captures]);

  const startParse = useCallback(async (id: string, text: string) => {
    try {
      const form = new FormData();
      form.append("text", text);
      const res = await fetch("/api/capture/smart/parse", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as
        | { proposal: CaptureProposal }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `Parse failed (HTTP ${res.status}).`;
        setCaptures((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "error", error: msg } : c)),
        );
        return;
      }
      setCaptures((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "ready", proposal: body.proposal } : c,
        ),
      );
    } catch (e) {
      setCaptures((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, status: "error", error: e instanceof Error ? e.message : "Network error" }
            : c,
        ),
      );
    }
  }, []);

  const enqueue = useCallback(
    (text: string): string => {
      const id = makeId();
      const entry: Capture = {
        id,
        status: "parsing",
        text: text.trim(),
        createdAt: Date.now(),
      };
      setCaptures((prev) => [entry, ...prev]);
      startParse(id, entry.text);
      return id;
    },
    [startParse],
  );

  const patch = useCallback((id: string, proposal: CaptureProposal) => {
    setCaptures((prev) =>
      prev.map((c) => (c.id === id ? { ...c, proposal } : c)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const commit = useCallback(
    async (id: string) => {
      const entry = captures.find((c) => c.id === id);
      if (!entry || !entry.proposal || entry.status === "saved" || saving.current.has(id)) return;
      saving.current.add(id);
      setCaptures((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "saving" } : c)),
      );
      try {
        const res = await fetch("/api/capture/smart/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Capture-ID": entry.id },
          body: JSON.stringify({
            requestId: entry.id,
            input: { text: entry.text, url: entry.text.match(/https?:\/\/[^\s]+/i)?.[0] ?? null },
            proposal: entry.proposal,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setCaptures((prev) =>
            prev.map((c) =>
              c.id === id
                ? {
                    ...c,
                    status: "error",
                    error: body.error ?? `Save failed (HTTP ${res.status}).`,
                  }
                : c,
            ),
          );
          return;
        }
        setCaptures((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "saved" } : c)),
        );
        window.dispatchEvent(new CustomEvent("personalos:capture-saved"));
        // Linger briefly so the user sees the checkmark, then remove.
        setTimeout(() => {
          setCaptures((prev) => prev.filter((c) => c.id !== id));
        }, 900);
      } catch (e) {
        setCaptures((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "error",
                  error: e instanceof Error ? e.message : "Network error",
                }
              : c,
          ),
        );
      } finally {
        saving.current.delete(id);
      }
    },
    [captures],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = captures.find((c) => c.id === id);
      if (!entry || entry.status !== "error") return;
      // The server may have saved before a response was lost. Replay the same
      // proposal rather than asking the model to produce a different request.
      if (entry.proposal) { void commit(id); return; }
      setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, status: "parsing", error: undefined } : c));
      void startParse(id, entry.text);
    },
    [captures, commit, startParse],
  );

  const value = useMemo<CaptureStore>(
    () => ({
      captures,
      enqueue,
      retry,
      patch,
      commit,
      dismiss,
      drawerOpen,
      setDrawerOpen,
    }),
    [captures, enqueue, retry, patch, commit, dismiss, drawerOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCapture(): CaptureStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCapture must be used within <CaptureProvider>");
  return ctx;
}

// Subscribe to parsing → ready transitions. Returns the count of recent
// transitions so the inbox pill can pulse when one happens.
export function useCaptureReadyPulse(): number {
  const { captures } = useCapture();
  const prevRef = useRef<Map<string, CaptureStatus>>(new Map());
  const [pulseCount, setPulseCount] = useState(0);

  useEffect(() => {
    let became = 0;
    for (const c of captures) {
      const prev = prevRef.current.get(c.id);
      if (prev === "parsing" && c.status === "ready") became++;
    }
    const next = new Map<string, CaptureStatus>();
    for (const c of captures) next.set(c.id, c.status);
    prevRef.current = next;
    if (became > 0) setPulseCount((n) => n + became);
  }, [captures]);

  return pulseCount;
}
