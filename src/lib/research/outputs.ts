// Parsing for what a research run leaves behind (worker and seed script).
import { MAX_TITLE_CHARS } from "./report";

export const MAX_ERROR_CHARS = 500;
const MAX_SUMMARY_CHARS = 1200;
const MAX_SOURCES = 200;

/** `pdfinfo` prints "Pages:          16". */
export function parsePdfPageCount(pdfinfo: string): number | null {
  const match = /^Pages:\s+(\d+)\s*$/m.exec(pdfinfo);
  const pages = match ? Number(match[1]) : NaN;
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

/** The last `max` characters, trimmed (failure output is most useful at the end). */
export function tailText(text: string, max = MAX_ERROR_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `…${trimmed.slice(-(max - 1))}` : trimmed;
}

/** First non-empty line, at most MAX_TITLE_CHARS; null when there is none. */
export function cleanTitle(raw: string | null): string | null {
  const line = raw?.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean);
  if (!line) return null;
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}

export function cleanSummary(raw: string | null): string | null {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…` : text;
}

export type ResearchSource = { title: string; url: string };

/** sources.json → [{ title, url }] with http(s) URLs only; null when unusable. */
export function parseSources(raw: string | null): ResearchSource[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const sources: ResearchSource[] = [];
  for (const item of value) {
    const r = item as Record<string, unknown> | null;
    if (!r || typeof r.url !== "string") continue;
    let url: URL;
    try {
      url = new URL(r.url.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const title = typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 300) : url.hostname;
    sources.push({ title, url: url.toString() });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources.length ? sources : null;
}

export function researchBlobKey(userId: string, reportId: string, now = Date.now()): string {
  return `users/${userId}/research/${reportId}/${now}-report.pdf`;
}

/** Claude's `--output-format json` result line, when it parses. */
export function parseClaudeResult(stdout: string): { isError: boolean; result: string | null; costUsd: number | null } | null {
  const line = stdout.trim().split(/\r?\n/).pop();
  if (!line) return null;
  try {
    const r = JSON.parse(line) as Record<string, unknown>;
    return {
      isError: r.is_error === true,
      result: typeof r.result === "string" ? r.result : null,
      costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    };
  } catch {
    return null;
  }
}
