// Failure classes for the /projects run. Logs and the run row carry these,
// never a message body (2026-10-05 lesson).

/** A collector failed; `source` says which one. */
export class SourceError extends Error {
  constructor(
    readonly source: string,
    readonly cause: unknown,
  ) {
    super(`${source} failed`);
    this.name = "SourceError";
  }
}

/** Runs `fn`, tagging any failure with the source it came from. */
export async function fromSource<T>(source: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof SourceError ? e : new SourceError(source, e);
  }
}

/** "gmail: HTTP 429", "claude: timeout", "parse", "validation", "storage"… */
export function failureClass(e: unknown): string {
  if (e instanceof SourceError) return `${e.source}: ${failureClass(e.cause)}`;
  const err = e as { name?: string; status?: number; message?: string } | null;
  if (typeof err?.status === "number") return `HTTP ${err.status}`;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  if (e instanceof SyntaxError || err?.message === "model did not return JSON") return "parse";
  if (err?.name === "ValidationError") return "validation";
  if (err?.name?.startsWith("PrismaClient")) return "storage";
  if (err?.name === "NotConfigured") return "not configured";
  return err?.name || "error";
}

export function notConfigured(what: string): Error {
  return Object.assign(new Error(`${what} not configured`), { name: "NotConfigured" });
}
