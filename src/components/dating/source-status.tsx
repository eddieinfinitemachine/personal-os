"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type SourceKind = "ecpad" | "texts" | "granola";
export type DatingSource = {
  id: string | null; source: SourceKind; enabled: boolean; status: string;
  lastSuccessAt: string | null; lastAttemptAt: string | null; lastNewDataAt: string | null;
  backlog: number; coverageStart: string | null; coverageEnd: string | null; error: string | null;
};
type SourceAction = "enable" | "pause" | "disconnect" | "remove";
type Pairing = { code: string; expiresAt: string };
const labels: Record<SourceKind, string> = { ecpad: "EC Pad", texts: "Texts", granola: "Granola" };
const button = "inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";
const primary = `${button} bg-[var(--color-foreground)] text-[var(--color-background)] hover:opacity-90`;
const kinds: SourceKind[] = ["texts", "ecpad", "granola"];
const SourcesContext = createContext<{
  sources: DatingSource[]; available: boolean; loading: boolean; error: string | null; busy: boolean;
  load: () => Promise<void>; action: (action: SourceAction, source: DatingSource) => Promise<void>; pair: () => Promise<Pairing>;
} | null>(null);
function useSources() {
  const context = useContext(SourcesContext);
  if (!context) throw new Error("Dating source controls need DatingSourcesProvider");
  return context;
}
function blank(source: SourceKind): DatingSource {
  return { id: null, source, enabled: false, status: "not_connected", lastSuccessAt: null, lastAttemptAt: null, lastNewDataAt: null, backlog: 0, coverageStart: null, coverageEnd: null, error: null };
}
function date(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function dateOnly(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function health(source: DatingSource) {
  if (!source.id) return "Not connected";
  if (!source.enabled) return source.status === "disconnected" ? "Disconnected" : "Paused";
  if (source.error || ["error", "needs_attention", "expired", "refetch_required"].includes(source.status)) return "Needs attention";
  if (["checking", "processing", "running"].includes(source.status)) return "Checking";
  if (source.backlog > 0) return `${source.backlog} waiting to be checked`;
  if (source.status === "waiting_for_mac") return "Waiting for Mac";
  if (source.lastSuccessAt && source.coverageStart && source.coverageEnd) return "Up to date for shown range";
  if (source.lastSuccessAt) return "Last scan complete";
  return source.source === "granola" ? "Waiting for first scan" : "Waiting for Mac";
}

export function DatingSourcesProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<DatingSource[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current;
    setLoading(true);
    try {
      const response = await fetch("/api/dating/sources", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.sources)) throw new Error("Could not check sources. Try again.");
      if (version.current !== request) return;
      setSources(data.sources);
      setAvailable(data.granolaAvailable === true);
      setError(null);
    } catch { if (version.current === request) setError("Could not check sources. Try again."); }
    finally { if (version.current === request) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { ++version.current; }; }, [load]);
  const post = async (body: object) => {
    if (inFlight.current) throw new Error("Another source change is still saving.");
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/dating/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save this source setting. Try again.");
      await load();
      return data;
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <SourcesContext.Provider value={{ sources, available, loading, error, busy, load,
    action: async (action, source) => { await post({ action, source: source.source, ...(source.id ? { id: source.id } : {}) }); },
    pair: async () => {
      const data = await post({ action: "pair" });
      if (typeof data.code !== "string" || typeof data.expiresAt !== "string") throw new Error("No pairing code was returned. Try again.");
      return { code: data.code, expiresAt: data.expiresAt };
    },
  }}>{children}</SourcesContext.Provider>;
}

export function SourceStatus() {
  const { sources, loading, error } = useSources();
  return <section aria-label="Source status" className="mb-4">
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-muted-foreground)]">{kinds.map((kind) => {
      const source = sources.find((item) => item.source === kind) ?? blank(kind);
      return <li key={kind} className="min-w-0"><span className="font-medium text-[var(--color-foreground)]">{labels[kind]}</span> · {error ? "Status unavailable" : loading ? "Checking status…" : health(source)}{!loading && !error && source.lastSuccessAt && <span className="block">Last successful scan {date(source.lastSuccessAt)}</span>}</li>;
    })}</ul>
  </section>;
}

export function SourceSettings({ children }: { children?: ReactNode }) {
  const { sources, loading, error, load, busy } = useSources();
  return <details className="mt-8 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Imports and sync</summary>
    <div className="space-y-4 pt-3">
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      <button type="button" className={button} disabled={loading || busy} onClick={() => void load()}>Refresh source status</button>
      {kinds.map((kind) => <SourceControl key={kind} source={sources.find((item) => item.source === kind) ?? blank(kind)} />)}
      {children}
    </div>
  </details>;
}

function SourceControl({ source }: { source: DatingSource }) {
  const { action, pair, busy, available, loading, error: loadError } = useSources();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  const disabled = busy || loading || !!loadError;
  const run = async (next: SourceAction) => {
    setError(null);
    try {
      await action(next, source);
      if (next === "remove") setConfirmRemove(false);
      if (next === "disconnect") setPairing(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save. Try again."); }
  };
  const pairingExpired = pairing && new Date(pairing.expiresAt).getTime() <= now;
  return <section aria-label={`${labels[source.source]} settings`} className="border-t border-[var(--color-card-border)] pt-3">
    <h3 className="text-sm font-semibold">{labels[source.source]} · {loadError ? "Status unavailable" : loading ? "Checking status…" : health(source)}</h3>
    {source.source === "texts" && <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Message discovery is optional. When enabled, your Mac checks the last 30 days of one-to-one iMessage and WhatsApp conversations for explicit dating context. Group chats are excluded. Suggestions need your approval; subtle context may be missed. Existing approved conversations keep their separate import.</p>}
    {source.source === "ecpad" && <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Pair in EC Pad’s Dating settings, then choose notes or folders. Creating a new pairing code replaces the previous connection. Selected folders include Markdown notes below them, except hidden files, Trash and connected Granola notes. Sync runs while EC Pad is open and unlocked on your Mac. iPhone changes join after they sync to the Mac.</p>}
    {source.source === "granola" && <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Checks meeting notes for dating evidence. Recent edits are checked again; older edits may require a separate import.{!available && " Granola is not available for this account."}</p>}
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-2">
      <div><dt className="inline">Last successful scan: </dt><dd className="inline">{date(source.lastSuccessAt) ?? "No successful scan yet"}</dd></div>
      <div><dt className="inline">Last attempt: </dt><dd className="inline">{date(source.lastAttemptAt) ?? "No attempt yet"}</dd></div>
      <div><dt className="inline">Last new data: </dt><dd className="inline">{date(source.lastNewDataAt) ?? "None yet"}</dd></div>
      <div><dt className="inline">Date coverage: </dt><dd className="inline">{source.coverageStart && source.coverageEnd ? `${dateOnly(source.coverageStart)} – ${dateOnly(source.coverageEnd)}` : "Not established yet"}</dd></div>
    </dl>
    {source.backlog > 0 && <p className="mt-1 text-xs">{source.backlog} items still waiting to be checked.</p>}
    {source.error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{source.error}</p>}
    <div className="mt-2 flex flex-wrap gap-1">
      {source.source === "ecpad" && <button type="button" disabled={disabled} className={button} onClick={async () => {
        setError(null);
        try { setPairing(await pair()); setNow(Date.now()); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create a pairing code. Try again."); }
      }}>{source.id ? "Pair EC Pad again" : "Pair EC Pad"}</button>}
      {source.enabled ? <button type="button" disabled={disabled} className={button} onClick={() => void run("pause")}>Pause</button> : (source.source !== "ecpad" || source.id) && <button type="button" disabled={disabled || (source.source === "granola" && !available)} className={button} onClick={() => void run("enable")}>{source.source === "texts" ? "Enable message discovery" : source.id ? "Resume" : "Enable Granola"}</button>}
      {source.id && <>
        <button type="button" disabled={disabled} className={button} onClick={() => void run("disconnect")}>Disconnect</button>
        <button type="button" disabled={disabled} className={button} aria-expanded={confirmRemove} onClick={() => setConfirmRemove(!confirmRemove)}>Remove imported evidence…</button>
      </>}
    </div>
    {pairing && <div role="status" className="mt-2 rounded-md bg-[var(--color-fill-secondary)] p-3 text-sm">
      {pairingExpired ? <p>This pairing code expired. Create a new code to continue.</p> : <><p>Enter this one-time code in EC Pad:</p><code className="mt-1 block select-all break-all font-mono">{pairing.code}</code><p className="mt-1 text-xs">Expires {date(pairing.expiresAt)}. Pairing again replaces the previous EC Pad connection.</p></>}
    </div>}
    {source.id && <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Pausing or disconnecting stops new intake. Saved evidence stays until you remove it separately.</p>}
    <div hidden={!confirmRemove} className="mt-2 rounded-md border border-[var(--color-card-border)] p-3">
      <p className="text-sm">Remove imported evidence from {labels[source.source]}? Your profiles and manual edits stay. Imported excerpts and unchanged imported timeline entries will be removed.</p>
      <div className="mt-2 flex flex-wrap gap-1"><button type="button" className={primary} disabled={disabled} onClick={() => void run("remove")}>Remove evidence from {labels[source.source]}</button><button type="button" className={button} disabled={disabled} onClick={() => setConfirmRemove(false)}>Cancel</button></div>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
  </section>;
}
