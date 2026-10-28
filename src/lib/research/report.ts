// Shared shape and input rules for research reports (/research, the API and
// the Mac worker). Client-safe: no Prisma or Node imports.

export type ResearchStatus = "queued" | "running" | "ready" | "failed";

export const MAX_TOPIC_CHARS = 4000;
export const MAX_TITLE_CHARS = 80;

/** What the page and GET /api/research send to the browser. */
export type ResearchReportView = {
  id: string;
  title: string;
  topic: string;
  status: ResearchStatus;
  summary: string | null;
  pdfUrl: string | null;
  pageCount: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export const RESEARCH_REPORT_SELECT = {
  id: true,
  title: true,
  topic: true,
  status: true,
  summary: true,
  pdfUrl: true,
  pageCount: true,
  error: true,
  createdAt: true,
  completedAt: true,
} as const;

type ReportRow = Omit<ResearchReportView, "status" | "createdAt" | "completedAt"> & {
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};

export function toResearchReportView(row: ReportRow): ResearchReportView {
  return {
    ...row,
    status: row.status as ResearchStatus,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/** One line, at most MAX_TITLE_CHARS; the worker may replace it with the report's own title. */
export function titleFromTopic(topic: string): string {
  const line = topic.replace(/\s+/g, " ").trim();
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}

/** Validates a POST body's `topic`. */
export function parseTopic(body: unknown): { topic: string } | { error: string } {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).topic : undefined;
  if (typeof raw !== "string" || !raw.trim()) return { error: "topic required" };
  const topic = raw.trim();
  if (topic.length > MAX_TOPIC_CHARS) return { error: `topic too long (max ${MAX_TOPIC_CHARS} characters)` };
  return { topic };
}
