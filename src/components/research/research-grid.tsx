"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { titleFromTopic, type ResearchReportView } from "@/lib/research/report";

export const POLL_MS = 15_000;

const isActive = (r: ResearchReportView) => r.status === "queued" || r.status === "running";
const isTemp = (r: ResearchReportView) => r.id.startsWith("temp-");

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ResearchGrid({ initialReports, canCreate }: { initialReports: ResearchReportView[]; canCreate: boolean }) {
  const [reports, setReports] = useState(initialReports);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const polling = reports.some(isActive);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/research", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { reports: ResearchReportView[] };
        // Keep optimistic cards whose POST hasn't come back yet.
        setReports((prev) => [...prev.filter(isTemp), ...data.reports]);
      } catch {
        // Offline or a deploy in flight: try again next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  async function create() {
    const text = topic.trim();
    if (!text || busy) return;
    const temp: ResearchReportView = {
      id: `temp-${Date.now()}`,
      title: titleFromTopic(text),
      topic: text,
      status: "queued",
      summary: null,
      pdfUrl: null,
      pageCount: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    setBusy(true);
    setNote(null);
    setReports((prev) => [temp, ...prev]);
    setTopic("");
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: text }),
      });
      const data = (await res.json().catch(() => ({}))) as { report?: ResearchReportView; error?: string };
      if (!res.ok || !data.report) throw new Error(data.error || "Couldn't queue that report.");
      const saved = data.report;
      setReports((prev) => prev.map((r) => (r.id === temp.id ? saved : r)));
    } catch (e) {
      setReports((prev) => prev.filter((r) => r.id !== temp.id));
      setTopic(text);
      setNote(e instanceof Error ? e.message : "Couldn't queue that report.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(report: ResearchReportView) {
    if (!window.confirm(`Delete "${report.title}"?`)) return;
    const before = reports;
    setReports((prev) => prev.filter((r) => r.id !== report.id));
    const res = await fetch(`/api/research/${report.id}`, { method: "DELETE" }).catch(() => null);
    if (!res || (!res.ok && res.status !== 404)) {
      setReports(before);
      setNote("Couldn't delete that report.");
    }
  }

  return (
    <div>
      {canCreate ? (
        <div className="mb-5 max-w-3xl">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void create();
              }
            }}
            rows={3}
            aria-label="New report topic"
            placeholder="What should Claude research? A designer, a movement, a market, a question…"
            className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => void create()}
              disabled={busy || !topic.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 min-h-[36px]"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              New report
            </button>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Runs on your Mac and usually takes 20 to 40 minutes.
            </span>
          </div>
          {note ? <p role="alert" className="mt-1 text-xs text-rose-500">{note}</p> : null}
        </div>
      ) : note ? (
        <p role="alert" className="mb-3 text-xs text-rose-500">{note}</p>
      ) : null}

      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {canCreate ? "No reports yet. Describe a topic above to start one." : "Report generation isn't enabled for this account."}
        </div>
      ) : (
        <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <li key={r.id} data-report={r.id} className="group relative">
              <ReportCard report={r} />
              {!isTemp(r) ? (
                <button
                  onClick={() => void remove(r)}
                  aria-label={`Delete ${r.title}`}
                  className="absolute top-2 right-2 rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ report: r }: { report: ResearchReportView }) {
  const meta = (
    <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)] flex items-center gap-1.5 flex-wrap">
      <span suppressHydrationWarning>{formatDate(r.createdAt)}</span>
      {r.pageCount ? <span>· {r.pageCount} pages</span> : null}
      {r.status !== "ready" ? <StatusPill status={r.status} error={r.error} /> : null}
    </div>
  );
  const body = (
    <>
      <div className="flex items-start gap-2 pr-6">
        <FileText className="size-4 mt-0.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <div className="font-medium leading-snug break-words">{r.title}</div>
      </div>
      {meta}
      {r.status === "ready" && r.summary ? (
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)] line-clamp-1" title={r.summary}>{r.summary}</p>
      ) : r.status === "queued" ? (
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">Waiting for the research worker on your Mac.</p>
      ) : r.status === "running" ? (
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">Researching and writing. This page updates when it&apos;s done.</p>
      ) : null}
      {r.status === "failed" ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-rose-500">What went wrong</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-muted-foreground)]">{r.error || "No details were recorded."}</p>
        </details>
      ) : null}
    </>
  );
  const card = "block h-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition";
  if (r.status === "ready" && r.pdfUrl) {
    return (
      <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" className={`${card} hover:bg-[var(--color-accent)]/40`}>
        {body}
      </a>
    );
  }
  return <div className={card}>{body}</div>;
}

function StatusPill({ status, error }: { status: ResearchReportView["status"]; error: string | null }) {
  const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none";
  if (status === "failed") return <span className={`${pill} border-rose-500/40 text-rose-500`} title={error ?? undefined}>Failed</span>;
  if (status === "running") {
    return (
      <span className={`${pill} border-[var(--color-border)]`}>
        <Loader2 className="size-3 animate-spin" />
        Researching
      </span>
    );
  }
  return <span className={`${pill} border-[var(--color-border)]`}>Queued</span>;
}
