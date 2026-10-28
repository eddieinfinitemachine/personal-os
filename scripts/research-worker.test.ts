import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn(), updateMany: vi.fn() }));
// Never a real database or Blob store from a unit test.
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { throw new Error("no database in tests"); } } }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchReport } from "@prisma/client";
import { allowedEmails, parseWorkerFlags, processReport, timeoutMs, type Context } from "./research-worker";

let root: string;
let stop: (() => void) | null;

function fakeClaude(body: string): string {
  const bin = join(root, "fake-claude.sh");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "$PWD/../args.txt"\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const WRITE_OUTPUTS = `printf '%%PDF-1.4\\n' > report.pdf
head -c 4096 /dev/zero >> report.pdf
printf 'Shaker furniture: a primer\\n' > title.txt
printf 'A short summary.\\n' > summary.txt
printf '[{"title":"W","url":"https://example.test/w"}]' > sources.json
printf '{"type":"result","is_error":false,"result":"done","total_cost_usd":2.5}\\n'`;

function ctx(bin: string, over: Partial<Context> = {}): Context {
  return {
    prisma: { researchReport: { updateMany: mocks.updateMany } } as never,
    blobToken: "blob-token",
    bin,
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 20_000,
    skillPath: null,
    root,
    registerStop: (fn) => { stop = fn; },
    log: () => {},
    ...over,
  };
}

const report = { id: "r1", userId: "u1", title: "Shaker furniture", topic: "Shaker furniture", status: "running" } as ResearchReport;

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "research-worker-test-"));
  stop = null;
  mocks.put.mockResolvedValue({ url: "https://blob.example.invalid/users/u1/research/r1/1-report.pdf" });
  mocks.del.mockResolvedValue(undefined);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("research worker flags and env", () => {
  it("parses --once and rejects unknown flags", () => {
    expect(parseWorkerFlags([])).toEqual({ once: false });
    expect(parseWorkerFlags(["--once"])).toEqual({ once: true });
    expect(() => parseWorkerFlags(["--nope"])).toThrow(/Unknown option/);
  });

  it("defaults the allowlist to the founder and the timeout to 45 minutes", () => {
    expect(allowedEmails({ FOUNDER_EMAIL: "Founder@Example.test" })).toEqual(["founder@example.test"]);
    expect(allowedEmails({ RESEARCH_ALLOWED_EMAILS: "a@x.test, b@x.test", FOUNDER_EMAIL: "c@x.test" })).toEqual(["a@x.test", "b@x.test"]);
    expect(timeoutMs({})).toBe(45 * 60_000);
    expect(timeoutMs({ RESEARCH_TIMEOUT_MIN: "5" })).toBe(5 * 60_000);
    expect(timeoutMs({ RESEARCH_TIMEOUT_MIN: "junk" })).toBe(45 * 60_000);
  });
});

describe("processReport", () => {
  it("runs claude in the report's directory, uploads the PDF and marks the row ready", async () => {
    const result = await processReport(ctx(fakeClaude(WRITE_OUTPUTS)), report);
    expect(result).toBe("ready");
    const args = readFileSync(join(root, "args.txt"), "utf8");
    expect(args.startsWith("-p\n")).toBe(true);
    expect(args).toContain("<topic>\nShaker furniture\n</topic>");
    expect(args).toContain("--permission-mode\nbypassPermissions\n--output-format\njson");
    const [key, body, options] = mocks.put.mock.calls[0];
    expect(key).toMatch(/^users\/u1\/research\/r1\/\d+-report\.pdf$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(options).toMatchObject({ access: "public", contentType: "application/pdf", token: "blob-token" });
    const update = mocks.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: "r1", status: "running" });
    expect(update.data).toMatchObject({
      status: "ready",
      pdfUrl: "https://blob.example.invalid/users/u1/research/r1/1-report.pdf",
      title: "Shaker furniture: a primer",
      summary: "A short summary.",
      sourcesJson: [{ title: "W", url: "https://example.test/w" }],
      error: null,
    });
    expect(update.data.completedAt).toBeInstanceOf(Date);
  });

  it("clears a previous attempt's outputs before running", async () => {
    const dir = join(root, "r1");
    await processReport(ctx(fakeClaude(WRITE_OUTPUTS)), report);
    expect(existsSync(join(dir, "report.pdf"))).toBe(true);
    const result = await processReport(ctx(fakeClaude("echo boom >&2; exit 1")), report);
    expect(result).toBe("failed");
    expect(existsSync(join(dir, "report.pdf"))).toBe(false);
  });

  it("marks the row failed with the end of the output when no PDF appears", async () => {
    const result = await processReport(ctx(fakeClaude("echo 'web search quota hit' >&2; exit 3")), report);
    expect(result).toBe("failed");
    expect(mocks.put).not.toHaveBeenCalled();
    const update = mocks.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: "r1", status: "running" });
    expect(update.data.status).toBe("failed");
    expect(update.data.error).toMatch(/without report\.pdf \(exit 3\)/);
    expect(update.data.error).toContain("web search quota hit");
    expect(update.data.error.length).toBeLessThanOrEqual(500);
  });

  it("kills a run that exceeds the timeout, including its children", async () => {
    const started = Date.now();
    const result = await processReport(ctx(fakeClaude("sleep 30 & wait"), { timeoutMs: 300 }), report);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result).toBe("failed");
    expect(mocks.updateMany.mock.calls[0][0].data.error).toMatch(/Timed out/);
  });

  it("requeues the report when the worker is asked to stop mid-run", async () => {
    const run = processReport(ctx(fakeClaude("sleep 30 & wait")), report);
    await vi.waitFor(() => expect(stop).toBeTypeOf("function"));
    stop!();
    expect(await run).toBe("requeued");
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "r1", status: "running" }, data: { status: "queued", startedAt: null } });
  });

  it("removes the upload when the row was deleted while it ran", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await processReport(ctx(fakeClaude(WRITE_OUTPUTS)), report)).toBe("failed");
    expect(mocks.del).toHaveBeenCalledWith("https://blob.example.invalid/users/u1/research/r1/1-report.pdf", { token: "blob-token" });
  });
});
