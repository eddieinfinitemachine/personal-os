import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  isForceType,
  parseCapture,
  requiredTypeBlock,
  validateProposal,
} from "./smart-capture";

describe("requiredTypeBlock", () => {
  it("adds nothing when no type is forced", () => {
    expect(requiredTypeBlock(undefined)).toEqual([]);
  });

  it("keeps the trip and inventory blocks", () => {
    const trip = requiredTypeBlock("trip").join("\n");
    expect(trip).toContain('REQUIRED TYPE: trip');
    expect(trip).toContain('Classify this capture as "trip"');
    const inv = requiredTypeBlock("inventory", ["watch", "camera"]).join("\n");
    expect(inv).toContain('REQUIRED TYPE: asset/inventory');
    expect(inv).toContain('assetKind "inventory"');
    expect(inv).toContain("watch, camera");
    expect(requiredTypeBlock("inventory").join("\n")).toContain("(none yet)");
  });

  it.each([
    ["media", "Media"],
    ["place", "Places"],
    ["investment", "Investments"],
    ["practice", "Best practices"],
  ] as const)("pins %s to an asset of that kind", (kind, noun) => {
    const [blank, line] = requiredTypeBlock(kind);
    expect(blank).toBe("");
    expect(line).toContain(`REQUIRED TYPE: asset/${kind}`);
    expect(line).toContain(`Return type "asset" with assetKind "${kind}"`);
    expect(line).toContain(`${noun} tracker`);
  });

  it("asks media to identify the work, strip the verb and map it to status", () => {
    const line = requiredTypeBlock("media").join("\n");
    expect(line).toContain("web_search");
    expect(line).toMatch(/creator/);
    expect(line).toMatch(/releaseYear/);
    expect(line).toMatch(/genre/);
    expect(line).toContain('"Watch:"');
    expect(line).toContain('"Listen to"');
    expect(line).toContain('"watch" → "to-watch"');
    expect(line).toContain('"read" → "to-read"');
    expect(line).toContain('"listen" → "to-listen"');
  });

  it("asks places to identify the place with city and country", () => {
    const line = requiredTypeBlock("place").join("\n");
    expect(line).toContain("web_search");
    expect(line).toMatch(/city, country/);
  });

  it("reuses category hints for the new kinds when given", () => {
    expect(requiredTypeBlock("media", ["film", "book"]).join("\n")).toContain("film, book");
    expect(requiredTypeBlock("media").join("\n")).not.toContain("existing categories");
  });
});

describe("isForceType", () => {
  it("accepts the seven forced types only", () => {
    for (const t of ["trip", "inventory", "media", "place", "investment", "practice", "call_sheet"]) {
      expect(isForceType(t)).toBe(true);
    }
    for (const t of ["todo", "asset", "", null, 3]) expect(isForceType(t)).toBe(false);
  });
});

describe("call_sheet captures", () => {
  it("pins the call sheet quick-add to call_sheet without searching", () => {
    const line = requiredTypeBlock("call_sheet").join("\n");
    expect(line).toContain('REQUIRED TYPE: call_sheet');
    expect(line).toContain('Return type "call_sheet"');
    expect(line).toContain("Do not search");
  });

  it("accepts and normalises a call_sheet proposal", () => {
    expect(
      validateProposal({
        type: "call_sheet",
        firstName: " Alex ",
        lastName: "Rivera",
        date: "2026-10-06",
        note: " the lease ",
      }),
    ).toEqual({
      type: "call_sheet",
      firstName: "Alex",
      lastName: "Rivera",
      date: "2026-10-06",
      note: "the lease",
    });
    expect(
      validateProposal({ type: "call_sheet", firstName: "Sam", date: "2026-09-29" }),
    ).toEqual({
      type: "call_sheet",
      firstName: "Sam",
      lastName: null,
      date: "2026-09-29",
      note: null,
    });
  });

  it.each([
    { type: "call_sheet", firstName: "", date: "2026-10-06" },
    { type: "call_sheet", date: "2026-10-06" },
    { type: "call_sheet", firstName: "Alex", date: "Tuesday" },
    { type: "call_sheet", firstName: "Alex", date: "2026-02-30" },
    { type: "call_sheet", firstName: "Alex" },
    { type: "call_sheet", firstName: "Alex", lastName: 4, date: "2026-10-06" },
    { type: "call_sheet", firstName: "Alex", date: "2026-10-06", note: ["x"] },
    { type: "reminder", firstName: "Alex", date: "2026-10-06" },
  ])("rejects %j", (shape) => {
    expect(() => validateProposal(shape)).toThrow("unexpected shape");
  });

  it("leaves sibling proposals untouched", () => {
    const todo = { type: "todo", title: "remind me to call Alex Tuesday" };
    expect(validateProposal(todo)).toBe(todo);
  });

  it("teaches the classifier the call sheet rules and keeps the todo rule", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: '{"type":"call_sheet","firstName":"Alex","lastName":"Rivera","date":"2026-10-06","note":null}',
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const proposal = await parseCapture({
        text: "Alex Rivera Tuesday",
        today: "2026-10-01",
        activeProjects: [],
        forceType: "call_sheet",
      });
      expect(proposal).toMatchObject({ type: "call_sheet", date: "2026-10-06" });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
      expect(body.system).toContain("SIX structured record types");
      expect(body.system).toContain('"call_sheet"  — put a person on their daily Call Sheet');
      expect(body.system).toContain("call_sheet ONLY when the text explicitly mentions the call sheet");
      expect(body.system).toContain('"Remind me to call Alex Tuesday" with no call-sheet mention is a todo');
      expect(body.system).toContain('"Remind me to …" / "todo: …" / "I need to …" → todo');
      expect(body.system).toContain("next occurrence strictly AFTER 2026-10-01");
      expect(body.messages[0].content[0].text).toContain("REQUIRED TYPE: call_sheet");
      await parseCapture({ text: "x", today: "2026-10-01", activeProjects: [] });
      expect(JSON.parse(fetch.mock.calls[1][1].body).tools).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
