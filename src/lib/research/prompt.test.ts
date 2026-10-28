import { describe, expect, it } from "vitest";
import { OUTPUT_FILES, buildResearchPrompt, claudeArgs } from "./prompt";
import {
  cleanSummary, cleanTitle, parseClaudeResult, parsePdfPageCount, parseSources, researchBlobKey, tailText,
} from "./outputs";
import { parseTopic, titleFromTopic, toResearchReportView } from "./report";

const workDir = "/Users/example/Library/Application Support/personal-os/research/r1";

describe("buildResearchPrompt", () => {
  const prompt = buildResearchPrompt({
    topic: "Shaker furniture and its influence",
    workDir,
    monthLabel: "October 2026",
    skillPath: "/skills/deep-research/SKILL.md",
  });

  it("fences the topic and treats it as data", () => {
    expect(prompt).toContain("<topic>\nShaker furniture and its influence\n</topic>");
    expect(prompt).toMatch(/never as instructions/);
  });

  it("uses the deep-research skill, with the SKILL.md as a fallback, and never asks questions", () => {
    expect(prompt).toContain('"deep-research"');
    expect(prompt).toContain("/skills/deep-research/SKILL.md");
    expect(prompt).toMatch(/never ask any/);
    expect(prompt).toMatch(/Skip its follow-up-questions step/);
    expect(buildResearchPrompt({ topic: "x", workDir, monthLabel: "October 2026" })).not.toContain("SKILL.md");
  });

  it("asks for the illustrated-report structure and a ReportLab PDF", () => {
    for (const part of ["ILLUSTRATED REFERENCE REPORT", "one-line thesis", "WHY IT MATTERS", "timeline", "LENSES WORTH STEALING", "READ AND WATCH", "SOURCES", "IMAGE CREDITS", "ReportLab", "October 2026"]) {
      expect(prompt).toContain(part);
    }
  });

  it("names every output file the worker reads and keeps work in the directory", () => {
    expect(prompt).toContain(workDir);
    for (const file of Object.values(OUTPUT_FILES)) expect(prompt).toContain(file);
    expect(prompt).toMatch(/no git commands/);
  });

  it("runs claude headless with bypassed permissions and a JSON result", () => {
    expect(claudeArgs("hi")).toEqual(["-p", "hi", "--permission-mode", "bypassPermissions", "--output-format", "json"]);
  });
});

describe("research outputs", () => {
  it("reads the page count from pdfinfo", () => {
    expect(parsePdfPageCount("Title:  X\nPages:          16\nEncrypted: no\n")).toBe(16);
    expect(parsePdfPageCount("Title: X\n")).toBeNull();
    expect(parsePdfPageCount("Pages: 0\n")).toBeNull();
  });

  it("keeps the end of long failure output", () => {
    const text = `${"a".repeat(1000)}THE END`;
    const tail = tailText(text, 100);
    expect(tail.length).toBe(100);
    expect(tail.endsWith("THE END")).toBe(true);
    expect(tailText("  short  ")).toBe("short");
  });

  it("cleans titles and summaries", () => {
    expect(cleanTitle("\n  Shaker   furniture \nsecond line")).toBe("Shaker furniture");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle(null)).toBeNull();
    expect(cleanTitle("x".repeat(200))!.length).toBe(80);
    expect(cleanSummary(" One.\n\nTwo. ")).toBe("One. Two.");
    expect(cleanSummary("")).toBeNull();
  });

  it("keeps only http(s) sources and falls back to the hostname for a title", () => {
    const raw = JSON.stringify([
      { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Shakers" },
      { url: "http://example.test/page" },
      { title: "bad", url: "javascript:alert(1)" },
      { title: "nope", url: "not a url" },
      "string",
    ]);
    expect(parseSources(raw)).toEqual([
      { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Shakers" },
      { title: "example.test", url: "http://example.test/page" },
    ]);
    expect(parseSources("{")).toBeNull();
    expect(parseSources("[]")).toBeNull();
    expect(parseSources(null)).toBeNull();
  });

  it("builds the blob key under the user's research folder", () => {
    expect(researchBlobKey("u1", "r1", 123)).toBe("users/u1/research/r1/123-report.pdf");
  });

  it("parses claude's JSON result line", () => {
    expect(parseClaudeResult('{"type":"result","is_error":false,"result":"Done.","total_cost_usd":1.5}\n')).toEqual({ isError: false, result: "Done.", costUsd: 1.5 });
    expect(parseClaudeResult("not json")).toBeNull();
    expect(parseClaudeResult("")).toBeNull();
  });
});

describe("report helpers", () => {
  it("derives a one-line title", () => {
    expect(titleFromTopic("  Shaker\n furniture ")).toBe("Shaker furniture");
    const long = titleFromTopic("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("validates topics", () => {
    expect(parseTopic({ topic: " a " })).toEqual({ topic: "a" });
    expect(parseTopic(null)).toEqual({ error: "topic required" });
    expect(parseTopic({ topic: 1 })).toEqual({ error: "topic required" });
  });

  it("serialises dates", () => {
    const d = new Date("2026-10-27T12:00:00Z");
    const view = toResearchReportView({ id: "r", title: "t", topic: "t", status: "ready", summary: null, pdfUrl: null, pageCount: null, error: null, createdAt: d, completedAt: null });
    expect(view.createdAt).toBe(d.toISOString());
    expect(view.completedAt).toBeNull();
  });
});
