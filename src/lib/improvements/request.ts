// Shared shape and input rules for Improve requests (the sidebar dialog, the
// API and the Mac improve worker). Client-safe: no Prisma or Node imports.

export const IMPROVEMENT_STATUSES = ["queued", "running", "needs_review", "approved", "shipped", "failed"] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

/** Statuses the worker still has to act on; the dialog polls while any are present. */
export const IN_FLIGHT_STATUSES: readonly ImprovementStatus[] = ["queued", "running", "approved"];

export const MAX_REQUEST_CHARS = 4000;

/** `window.dispatchEvent(new CustomEvent(OPEN_IMPROVE_EVENT))` opens the dialog. */
export const OPEN_IMPROVE_EVENT = "personalos:improve:open";

/** What the dialog attaches: the page you were on, your window size and the build. */
export type ImprovementContext = {
  path: string | null;
  title: string | null;
  viewport: { width: number; height: number } | null;
  version: string | null;
  userAgent: string | null;
};

/** What GET /api/improvements sends to the browser. */
export type ImprovementView = {
  id: string;
  request: string;
  context: ImprovementContext | null;
  status: ImprovementStatus;
  summary: string | null;
  reviewReason: string | null;
  prUrl: string | null;
  previewUrl: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export const IMPROVEMENT_SELECT = {
  id: true,
  request: true,
  context: true,
  status: true,
  summary: true,
  reviewReason: true,
  prUrl: true,
  previewUrl: true,
  error: true,
  createdAt: true,
  completedAt: true,
} as const;

type ImprovementRow = Omit<ImprovementView, "status" | "context" | "createdAt" | "completedAt"> & {
  status: string;
  context: unknown;
  createdAt: Date;
  completedAt: Date | null;
};

export function toImprovementView(row: ImprovementRow): ImprovementView {
  return {
    ...row,
    status: row.status as ImprovementStatus,
    context: parseContext(row.context),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const dimension = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null;

/** Keeps only the known context fields, trimmed and capped; null when nothing usable is left. */
export function parseContext(raw: unknown): ImprovementContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const v = r.viewport && typeof r.viewport === "object" ? (r.viewport as Record<string, unknown>) : null;
  const width = dimension(v?.width);
  const height = dimension(v?.height);
  const path = text(r.path, 300);
  const context: ImprovementContext = {
    path: path?.startsWith("/") ? path : null,
    title: text(r.title, 200),
    viewport: width && height ? { width, height } : null,
    version: text(r.version, 60),
    userAgent: text(r.userAgent, 300),
  };
  return Object.values(context).some((value) => value !== null) ? context : null;
}

/** Validates a POST body: `request` (required) and optional `context`. */
export function parseImprovementInput(body: unknown): { request: string; context: ImprovementContext | null } | { error: string } {
  const r = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof r.request !== "string" || !r.request.trim()) return { error: "request required" };
  const request = r.request.trim();
  if (request.length > MAX_REQUEST_CHARS) return { error: `request too long (max ${MAX_REQUEST_CHARS} characters)` };
  return { request, context: parseContext(r.context) };
}
