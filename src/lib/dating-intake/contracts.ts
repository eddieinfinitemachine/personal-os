import { createHash } from "node:crypto";
import { normalizeHandle } from "@/lib/dating";

export const SEGMENT_SIZE = 12_000;
export const MAX_SEGMENTS = 128;
export class IntakeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
export function safeURL(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2000)
    throw new IntakeError("Invalid source link");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new IntakeError("Source links must use HTTPS");
  }
}
export function segments(text: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + SEGMENT_SIZE, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    out.push(text.slice(start, end));
    start = end;
  }
  if (!out.length) out.push("");
  if (out.length > MAX_SEGMENTS)
    throw new IntakeError(
      "Document exceeds the supported size; split it into smaller notes",
      413,
    );
  return out;
}
export type Envelope = {
  version: 1;
  externalId: string;
  revision: string;
  documentVersion: number;
  segmentIndex: number;
  segmentCount: number;
  text: string;
  title: string;
  occurredAt: string | null;
  url: string | null;
  identities: string[];
  evidenceFamily: string | null;
};
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new IntakeError("Expected an object");
  return input as Record<string, unknown>;
}
export function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new IntakeError("Invalid version or segment number");
  return value;
}
export function string(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    value.includes("\u0000")
  )
    throw new IntakeError("Invalid source text");
  // Prevent JS/Swift UTF-8 encoding disagreement on isolated UTF-16 surrogates.
  if (value !== value.toWellFormed())
    throw new IntakeError("Invalid Unicode text");
  return value;
}
export function aliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new IntakeError("Invalid contact identities");
  return [
    ...new Set(
      value.map((v) => {
        const raw = string(v, 200);
        const normalized = normalizeHandle(raw);
        if (!normalized || normalized !== raw)
          throw new IntakeError(
            "Contact identities must be normalized phones or emails",
          );
        return normalized;
      }),
    ),
  ].sort();
}
export function envelope(input: unknown): Envelope {
  const o = object(input);
  if (o.version !== 1) throw new IntakeError("Unsupported intake version");
  const revision = string(o.revision, 64);
  if (!/^[a-f0-9]{64}$/.test(revision))
    throw new IntakeError("Invalid content revision");
  const count = integer(o.segmentCount, 1, MAX_SEGMENTS);
  let occurredAt: string | null = null;
  if (o.occurredAt != null) {
    const value = string(o.occurredAt, 40);
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new IntakeError("Invalid source date");
    occurredAt = new Date(value).toISOString();
  }
  return {
    version: 1,
    externalId: string(o.externalId, 200),
    revision,
    documentVersion: integer(o.documentVersion, 1, 2147483647),
    segmentIndex: integer(o.segmentIndex, 0, count - 1),
    segmentCount: count,
    text: string(o.text, SEGMENT_SIZE, true),
    title: string(o.title, 200),
    occurredAt,
    url: safeURL(o.url),
    identities: aliases(o.identities ?? []),
    evidenceFamily:
      o.evidenceFamily == null ? null : string(o.evidenceFamily, 200),
  };
}
export async function readJSON(request: Request, limit = 65536) {
  const reader = request.body?.getReader();
  if (!reader) throw new IntakeError("Body required");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new IntakeError("Request too large", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof IntakeError) throw e;
    throw new IntakeError("Invalid JSON");
  }
}
