import { createHash } from "node:crypto";

export const MAX_MOBILE_REQUEST_BYTES = 3_500_000;
export const MAX_MOBILE_FILES = 10;
export const MAX_MOBILE_TEXT_LENGTH = 50_000;
export const MOBILE_QUOTA_BYTES = 1024 * 1024 * 1024;

export class MobileCaptureError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "MobileCaptureError"; }
}
export interface MobileCaptureInput { requestId: string; text: string; url: string | null; files: File[] }

export async function readMobileCapture(request: Request): Promise<MobileCaptureInput> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_MOBILE_REQUEST_BYTES) throw new MobileCaptureError(413, "Capture too large. Maximum request size is 3,500,000 bytes.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_MOBILE_REQUEST_BYTES) {
          await reader.cancel();
          throw new MobileCaptureError(413, "Capture too large. Maximum request size is 3,500,000 bytes.");
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = Buffer.concat(chunks);
  const contentType = request.headers.get("content-type") || "";
  let fields: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
    } catch { throw new MobileCaptureError(400, "Invalid multipart capture."); }
    for (const key of ["requestId", "text", "url"]) {
      if (form.getAll(key).length > 1) throw new MobileCaptureError(400, `Only one ${key} field is allowed.`);
    }
    const attachments = form.getAll("file");
    if (attachments.some(file => !(file instanceof File))) throw new MobileCaptureError(400, "Invalid file attachment.");
    files = attachments as File[];
    fields = { requestId: form.get("requestId"), text: form.get("text") ?? "", url: form.get("url") };
  } else if (contentType.toLowerCase().startsWith("application/json")) {
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      fields = parsed as Record<string, unknown>;
    } catch { throw new MobileCaptureError(400, "Invalid JSON capture."); }
  } else { throw new MobileCaptureError(415, "Use application/json or multipart/form-data."); }
  if (typeof fields.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.requestId)) {
    throw new MobileCaptureError(400, "requestId must be a UUID.");
  }
  if (fields.text !== undefined && typeof fields.text !== "string") throw new MobileCaptureError(400, "text must be a string.");
  const text = ((fields.text as string | undefined) ?? "").trim();
  if (text.length > MAX_MOBILE_TEXT_LENGTH) throw new MobileCaptureError(400, "Text must be 50,000 characters or fewer.");
  let url: string | null = null;
  if (fields.url !== undefined && fields.url !== null && fields.url !== "") {
    if (typeof fields.url !== "string" || fields.url.length > 8192) throw new MobileCaptureError(400, "Invalid URL.");
    try {
      const parsed = new URL(fields.url.trim());
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      url = parsed.href;
    } catch { throw new MobileCaptureError(400, "Only http and https URLs can be captured."); }
  }
  if (files.length > MAX_MOBILE_FILES) throw new MobileCaptureError(400, "Share at most 10 files at a time.");
  if (files.some(file => file.size === 0)) throw new MobileCaptureError(400, "Empty files cannot be captured.");
  if (!text && !url && files.length === 0) throw new MobileCaptureError(400, "Share some text, a link, or a file.");
  return { requestId: fields.requestId.toLowerCase(), text, url, files };
}

export function mobileReceiptId(userId: string, requestId: string): string {
  return createHash("sha256").update(JSON.stringify([userId, requestId.toLowerCase()])).digest("hex");
}
export async function mobileCaptureHash(input: MobileCaptureInput): Promise<string> {
  const hash = createHash("sha256").update(JSON.stringify([input.text, input.url, input.files.map(file => [file.name, file.type, file.size])]));
  for (const file of input.files) hash.update(Buffer.from(await file.arrayBuffer()));
  return hash.digest("hex");
}
