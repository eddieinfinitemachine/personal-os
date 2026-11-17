import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), resizeImage: vi.fn() }));
// Never a real database or Blob store from a unit test.
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { throw new Error("no database in tests"); } } }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchReport } from "@prisma/client";
import { allowedEmails, padProjectDir, parseWorkerFlags, processReport, sendReadyReportsToPad, timeoutMs, type Context } from "./research-worker";
import { PAD_RETRY_MS, parseSipsSize } from "./lib/research-pad";

let root: string;
let pad: string;
let stop: (() => void) | null;

function fakeClaude(body: string): string {
  const bin = join(root, "fake-claude.sh");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "$PWD/../args.txt"\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const WRITE_OUTPUTS = `printf '%%PDF-1.4\\n' > report.pdf
head -c 4096 /dev/zero >> report.pdf
printf '\\n%%%%EOF\\n' >> report.pdf
printf 'Shaker furniture: a primer\\n' > title.txt
printf 'A short summary.\\n' > summary.txt
printf '[{"title":"W","url":"https://example.test/w"}]' > sources.json
printf '{"type":"result","is_error":false,"result":"done","total_cost_usd":2.5}\\n'`;

function ctx(bin: string, over: Partial<Context> = {}): Context {
  return {
    prisma: { researchReport: { updateMany: mocks.updateMany, findMany: mocks.findMany } } as never,
    blobToken: "blob-token",
    bin,
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 20_000,
    skillPath: null,
    root,
    registerStop: (fn) => { stop = fn; },
    log: () => {},
    retryMs: 0,
    padProjectDir: pad,
    resizeImage: mocks.resizeImage,
    ...over,
  };
}

const report = { id: "r1", userId: "u1", title: "Shaker furniture", topic: "Shaker furniture", status: "running" } as ResearchReport;

beforeEach(() => {
  vi.resetAllMocks(); // also drops unused mock*Once values so they cannot leak into the next test
  root = mkdtempSync(join(tmpdir(), "research-worker-test-"));
  pad = mkdtempSync(join(tmpdir(), "research-pad-test-"));
  stop = null;
  mocks.put.mockResolvedValue({ url: "https://blob.example.invalid/users/u1/research/r1/1-report.pdf" });
  mocks.del.mockResolvedValue(undefined);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findMany.mockResolvedValue([]);
  mocks.resizeImage.mockResolvedValue(undefined);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(pad, { recursive: true, force: true });
});

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

  it("sends notes to EC Pad's Research project unless RESEARCH_PAD_PROJECT_DIR says otherwise", () => {
    expect(padProjectDir({})).toMatch(/\/Library\/Mobile Documents\/iCloud~com~eddie~ecpad\/Documents\/Projects\/Research$/);
    expect(padProjectDir({ RESEARCH_PAD_PROJECT_DIR: "/tmp/example-pad" })).toBe("/tmp/example-pad");
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
    expect(update.data.error).toMatch(/without a complete report\.pdf \(exit 3\)/);
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

  it("publishes a complete PDF even when the timeout fires after it was written", async () => {
    const result = await processReport(ctx(fakeClaude(`${WRITE_OUTPUTS}\nsleep 30 & wait`), { timeoutMs: 1_500 }), report);
    expect(result).toBe("ready");
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ready", title: "Shaker furniture: a primer" });
  });

  it("fails a PDF that was cut off mid-write", async () => {
    const result = await processReport(ctx(fakeClaude("printf '%%PDF-1.4\\n' > report.pdf; head -c 4096 /dev/zero >> report.pdf")), report);
    expect(result).toBe("failed");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.updateMany.mock.calls[0][0].data.error).toMatch(/without a complete report\.pdf \(exit 0\)/);
  });

  it("retries the upload and the save while the network is down", async () => {
    const offline = Object.assign(new Error("Can't reach database server"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    mocks.put.mockRejectedValueOnce(new TypeError("fetch failed"));
    mocks.updateMany.mockRejectedValueOnce(offline);
    const lines: string[] = [];
    const result = await processReport(ctx(fakeClaude(WRITE_OUTPUTS), { log: (line) => lines.push(line) }), report);
    expect(result).toBe("ready");
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(mocks.put.mock.calls[1][0]).toBe(mocks.put.mock.calls[0][0]);
    expect(mocks.put.mock.calls[1][2]).toMatchObject({ allowOverwrite: true });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(lines).toContain("Research r1: upload failed (TypeError); retrying");
    expect(lines).toContain("Research r1: saving the report failed (PrismaClientKnownRequestError P1001); retrying");
    expect(lines.join("\n")).not.toContain("Can't reach");
  });

  it("retries saving a failure instead of leaving the row running", async () => {
    mocks.updateMany.mockRejectedValueOnce(Object.assign(new Error("closed"), { code: "P1017" }));
    expect(await processReport(ctx(fakeClaude("exit 3")), report)).toBe("failed");
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany.mock.calls[1][0].data.status).toBe("failed");
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

describe("sendReadyReportsToPad", () => {
  const COMPLETE_PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4096), Buffer.from("\n%%EOF\n")]);
  const SAMPLE_MD = "# Sample topic: a primer\n\nOpening.\n\n![Hero](images/hero.jpg)\n\n*The signature piece. A caption.*\n\n![Detail](images/detail.png)\n\n![Gone](images/missing.jpg)\n";
  const notes = () => join(pad, "Claude Code");
  const readyRow = (id: string, title = "Sample topic: a primer") => ({
    id, title, status: "ready", pdfUrl: `https://blob.example.invalid/${id}.pdf`, pageCount: 12, completedAt: new Date(2026, 10, 17, 9),
  });

  function workDir(id: string, options: { md?: string | null; pdf?: Buffer; images?: string[] } = {}) {
    const dir = join(root, id);
    mkdirSync(join(dir, "images"), { recursive: true });
    writeFileSync(join(dir, "report.pdf"), options.pdf ?? COMPLETE_PDF);
    if (options.md !== null) writeFileSync(join(dir, "report.md"), options.md ?? SAMPLE_MD);
    for (const file of options.images ?? ["hero.jpg", "detail.png"]) writeFileSync(join(dir, "images", file), `picture ${file}`);
    return dir;
  }
  const withProject = () => writeFileSync(join(pad, "project.md"), "# Research\n");
  const marker = (id: string) => JSON.parse(readFileSync(join(root, id, "sent-to-pad.json"), "utf8"));

  it("waits without touching the database while the Research project is missing, and says so once", async () => {
    workDir("r1");
    const lines: string[] = [];
    const c = ctx("", { log: (line) => lines.push(line) });
    await sendReadyReportsToPad(c);
    await sendReadyReportsToPad(c);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(lines).toEqual(["Research worker: EC Pad Research project not found; finished reports wait until it exists"]);
    expect(existsSync(notes())).toBe(false);
    expect(existsSync(join(pad, "project.md"))).toBe(false);
  });

  it("treats an evicted iCloud project.md as the project being there", async () => {
    writeFileSync(join(pad, ".project.md.icloud"), "");
    workDir("r1");
    mocks.findMany.mockResolvedValueOnce([readyRow("r1")]);
    await sendReadyReportsToPad(ctx(""));
    expect(existsSync(join(notes(), "Sample topic a primer.md"))).toBe(true);
  });

  it("skips the database when no work dir has report.md and a complete PDF", async () => {
    withProject();
    workDir("no-md", { md: null });
    workDir("cut-off", { pdf: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4096)]) });
    await sendReadyReportsToPad(ctx(""));
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("writes the note and its pictures, then marks the report sent", async () => {
    withProject();
    workDir("r1");
    mocks.findMany.mockResolvedValueOnce([readyRow("r1")]);
    const lines: string[] = [];
    await sendReadyReportsToPad(ctx("", { log: (line) => lines.push(line) }));

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1"] } },
      select: { id: true, title: true, status: true, pdfUrl: true, pageCount: true, completedAt: true },
    });
    expect(readdirSync(notes()).sort()).toEqual(["Sample topic a primer.md", "images"]);
    const note = readFileSync(join(notes(), "Sample topic a primer.md"), "utf8");
    expect(note).toBe(
      "# Sample topic: a primer\n\n[Illustrated PDF](https://blob.example.invalid/r1.pdf) · 12 pages\n\nOpening.\n\n" +
        "![Hero](images/r1/hero.jpg)\n\n*The signature piece. A caption.*\n\n![Detail](images/r1/detail.png)\n\n" +
        "![Gone](images/r1/missing.jpg)\n\nFrom Claude Code · 2026-11-17 · research report r1\n",
    );
    expect(readdirSync(join(notes(), "images", "r1")).sort()).toEqual(["detail.png", "hero.jpg"]);
    expect(readFileSync(join(notes(), "images", "r1", "hero.jpg"), "utf8")).toBe("picture hero.jpg");
    expect(mocks.resizeImage.mock.calls.map(([path]) => path).sort()).toEqual([
      join(notes(), "images", "r1", "detail.png"), join(notes(), "images", "r1", "hero.jpg"),
    ]);
    expect(marker("r1")).toEqual({ note: "Claude Code/Sample topic a primer.md", at: expect.any(String) });
    expect(lines).toEqual(["Research r1: 1 referenced picture(s) missing", "Research r1: sent to EC Pad"]);

    // Sent once: the marker keeps it from going again.
    mocks.findMany.mockClear();
    await sendReadyReportsToPad(ctx(""));
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("never overwrites an existing note: a taken name gets ' 2'", async () => {
    withProject();
    mkdirSync(notes());
    const annotated = "# Sample topic: a primer\n\nEddie's highlights ==here==.\n";
    writeFileSync(join(notes(), "Sample topic a primer.md"), annotated);
    workDir("r1");
    mocks.findMany.mockResolvedValueOnce([readyRow("r1")]);
    await sendReadyReportsToPad(ctx(""));
    expect(readFileSync(join(notes(), "Sample topic a primer.md"), "utf8")).toBe(annotated);
    expect(readFileSync(join(notes(), "Sample topic a primer 2.md"), "utf8")).toContain("research report r1");
    expect(marker("r1").note).toBe("Claude Code/Sample topic a primer 2.md");
  });

  it("marks a deleted report skipped and leaves one that isn't ready for the next poll", async () => {
    withProject();
    workDir("gone");
    workDir("failed");
    mocks.findMany.mockResolvedValueOnce([{ ...readyRow("failed"), status: "failed" }]);
    await sendReadyReportsToPad(ctx(""));
    expect(marker("gone")).toEqual({ skipped: "report deleted", at: expect.any(String) });
    expect(existsSync(join(root, "failed", "sent-to-pad.json"))).toBe(false);
    expect(existsSync(notes())).toBe(false);

    mocks.findMany.mockResolvedValueOnce([readyRow("failed")]);
    await sendReadyReportsToPad(ctx(""));
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["failed"] } });
    expect(marker("failed").note).toBe("Claude Code/Sample topic a primer.md");
  });

  it("keeps going after one report fails, and waits ten minutes before retrying it", async () => {
    withProject();
    workDir("r1");
    workDir("r2");
    mkdirSync(join(notes(), "images"), { recursive: true });
    writeFileSync(join(notes(), "images", "r1"), "a file where r1's picture folder should be");
    mocks.findMany.mockResolvedValue([readyRow("r1", "First example"), readyRow("r2", "Second example")]);
    const lines: string[] = [];
    const c = ctx("", { log: (line) => lines.push(line) });
    const now = Date.now();
    await sendReadyReportsToPad(c, now);
    expect(lines.some((line) => /^Research r1: EC Pad send failed \(Error E\w+\)$/.test(line))).toBe(true);
    expect(lines).toContain("Research r2: sent to EC Pad");
    expect(existsSync(join(root, "r1", "sent-to-pad.json"))).toBe(false);
    expect(readdirSync(notes()).filter((f) => f.startsWith("."))).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/example/i);

    lines.length = 0;
    mocks.findMany.mockClear();
    await sendReadyReportsToPad(c, now + 60_000);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(lines).toEqual([]);

    rmSync(join(notes(), "images", "r1"));
    await sendReadyReportsToPad(c, now + PAD_RETRY_MS + 1);
    expect(lines).toContain("Research r1: sent to EC Pad");
    expect(marker("r1").note).toBe("Claude Code/First example.md");
  });

  it("keeps a picture full size when resizing fails", async () => {
    withProject();
    workDir("r1");
    mocks.findMany.mockResolvedValueOnce([readyRow("r1")]);
    mocks.resizeImage.mockRejectedValue(Object.assign(new Error("sips failed"), { code: "ENOENT" }));
    const lines: string[] = [];
    await sendReadyReportsToPad(ctx("", { log: (line) => lines.push(line) }));
    expect(readFileSync(join(notes(), "images", "r1", "hero.jpg"), "utf8")).toBe("picture hero.jpg");
    expect(lines).toContain("Research r1: picture kept full size, resize failed (Error ENOENT)");
    expect(lines).toContain("Research r1: sent to EC Pad");
  });

  it("never throws out of the poll loop", async () => {
    withProject();
    workDir("r1");
    mocks.findMany.mockRejectedValueOnce(Object.assign(new Error("Can't reach database server"), { name: "PrismaClientKnownRequestError", code: "P1001" }));
    const lines: string[] = [];
    await expect(sendReadyReportsToPad(ctx("", { log: (line) => lines.push(line) }))).resolves.toBeUndefined();
    expect(lines).toEqual(["Research worker: EC Pad check failed (PrismaClientKnownRequestError P1001)"]);
  });

  it("reads the picture size from sips", () => {
    expect(parseSipsSize("/tmp/x.jpg\n  pixelWidth: 3000\n  pixelHeight: 2000\n")).toEqual({ width: 3000, height: 2000 });
    expect(parseSipsSize("/tmp/x.jpg\n  pixelWidth: 3000\n")).toBeNull();
    expect(parseSipsSize("")).toBeNull();
  });
});
