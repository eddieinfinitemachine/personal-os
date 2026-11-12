import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  boardItem: { findMany: vi.fn(), findFirst: vi.fn() },
  boardRec: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  boardTaste: { update: vi.fn() },
  $transaction: vi.fn(),
}));
const resolveLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/board", () => ({ resolveLink }));

import {
  CLAUDE_DEADLINE_MS,
  SEARCHES_PER_RUN,
  buildRecsPrompt,
  describeFailure,
  generateRecs,
  parseRecsReply,
  searchUrl,
} from "@/lib/board-recs";
import { ClaudeAPIError, callClaudeWithServerTools } from "@/lib/claude";

describe("buildRecsPrompt", () => {
  it("lists the board, the kind mix, and feedback", () => {
    const prompt = buildRecsPrompt(
      [
        { kind: "music", title: "Blue Train", siteName: "Spotify", note: "morning   record", price: null, url: null },
        { kind: "product", title: "Wire Chair", siteName: null, note: null, price: "$450.00", url: null },
        { kind: "music", title: "Kind of Blue", siteName: null, note: null, price: null, url: null },
      ],
      { saved: ["Ethio-jazz comp by Mulatu"], dismissed: ["Neon desk lamp"], shown: ["Old pick"] },
      8,
    );
    expect(prompt).toContain("mix: music 2, product 1");
    expect(prompt).toContain('- [music] Blue Train (Spotify) note: "morning record"');
    expect(prompt).toContain("- [product] Wire Chair $450.00");
    expect(prompt).toContain("more like these):\n- Ethio-jazz comp by Mulatu");
    expect(prompt).toContain("less like these):\n- Neon desk lamp");
    expect(prompt).toContain("don't repeat:\n- Old pick");
    expect(prompt).toContain("Find 8 recommendations");
  });
  it("centers a seeded run on one item", () => {
    const seed = { kind: "video", title: "Koyaanisqatsi trailer", siteName: "YouTube", note: "the score", price: null, url: null };
    const prompt = buildRecsPrompt([seed], { saved: [], dismissed: [], shown: [] }, 8, seed);
    expect(prompt).toContain('more like this one item:\n- [video] Koyaanisqatsi trailer (YouTube) note: "the score"');
    expect(prompt).toContain("Find 8 recommendations close to");
    expect(prompt).not.toContain("board's mix of kinds");
  });
  it("omits empty feedback sections", () => {
    const prompt = buildRecsPrompt([{ kind: "link", title: "A", siteName: null, note: null, price: null, url: null }], {
      saved: [],
      dismissed: [],
      shown: [],
    });
    expect(prompt).not.toContain("Past picks");
    expect(prompt).not.toContain("Already shown");
  });
});

describe("parseRecsReply", () => {
  it("joins citation-split text and validates recs", () => {
    const json = JSON.stringify({
      taste: "You like warm, analog things.",
      recs: [
        { kind: "music", title: "Ethiopiques Vol. 4", creator: "Mulatu Astatke", reason: "Like Blue Train.", url: "https://open.spotify.com/album/abc" },
        { kind: "music", title: "ethiopiques vol. 4", creator: null, reason: "dupe", url: "https://x.test" },
        { kind: "note", title: "Kinda odd", creator: null, reason: "Kind coerced.", url: "javascript:alert(1)" },
        { kind: "video", title: "", reason: "no title" },
        { kind: "product", title: "No reason" },
      ],
    });
    const cut = 40;
    const out = parseRecsReply([
      { type: "server_tool_use", name: "web_search" },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "Here you go. " },
      { type: "text", text: json.slice(0, cut), citations: [{ url: "https://x" }] },
      { type: "text", text: json.slice(cut) },
    ]);
    expect(out.taste).toBe("You like warm, analog things.");
    expect(out.recs).toEqual([
      { kind: "music", title: "Ethiopiques Vol. 4", creator: "Mulatu Astatke", reason: "Like Blue Train.", url: "https://open.spotify.com/album/abc" },
      { kind: "link", title: "Kinda odd", creator: null, reason: "Kind coerced.", url: null },
    ]);
  });
  it("ignores narration before the last search and handles pretty-printed JSON", () => {
    const out = parseRecsReply([
      { type: "text", text: 'Let me search. Example shape: {"taste": "draft", "recs": []}' },
      { type: "server_tool_use", name: "web_search" },
      { type: "web_search_tool_result", content: [] },
      {
        type: "text",
        text: '{\n  "taste": "final",\n  "recs": [{"kind": "music", "title": "A", "reason": "B", "url": "https://x.test/a"}]\n}',
      },
    ]);
    expect(out.taste).toBe("final");
    expect(out.recs.map((r) => r.title)).toEqual(["A"]);
  });
  it("throws when there's no JSON", () => {
    expect(() => parseRecsReply([{ type: "text", text: "Sorry, no luck." }])).toThrow(/no JSON/);
  });
});

describe("searchUrl", () => {
  it("routes by kind", () => {
    expect(searchUrl("music", "So What", "Miles Davis")).toBe("https://open.spotify.com/search/So%20What%20Miles%20Davis");
    expect(searchUrl("video", "Koyaanisqatsi", null)).toBe("https://www.youtube.com/results?search_query=Koyaanisqatsi");
    expect(searchUrl("product", "Wire Chair", "Vitra")).toContain("tbm=shop");
  });
});

describe("callClaudeWithServerTools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resumes after pause_turn by echoing the partial assistant turn", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const first = [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
    ];
    const second = [{ type: "text", text: '{"taste":"t","recs":[]}' }];
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        const content = bodies.length === 1 ? first : second;
        const stop_reason = bodies.length === 1 ? "pause_turn" : "end_turn";
        return new Response(JSON.stringify({ content, stop_reason }), { status: 200 });
      }),
    );
    const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];
    const out = await callClaudeWithServerTools({ user: "hi", maxTokens: 100, tools });
    expect(out.stopReason).toBe("end_turn");
    expect(out.content).toEqual([...first, ...second]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ tools, thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(bodies[1].messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: first },
    ]);
  });

  it("surfaces API errors", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    await expect(callClaudeWithServerTools({ user: "hi", maxTokens: 10, tools: [] })).rejects.toThrow(/Claude error 529/);
  });
});

describe("generateRecs", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    kind: "music",
    title: `Record ${i}`,
    siteName: null,
    note: null,
    price: null,
    url: `https://board.test/${i}`,
  }));
  const reply = (recs: object[]) =>
    new Response(
      JSON.stringify({
        content: [
          { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
          { type: "text", text: JSON.stringify({ taste: "Warm and analog.", recs }) },
        ],
        stop_reason: "end_turn",
      }),
      { status: 200 },
    );

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    db.boardItem.findMany.mockResolvedValue(items);
    db.boardRec.findMany.mockResolvedValue([]);
    db.boardRec.deleteMany.mockReturnValue("delete");
    db.boardRec.createMany.mockReturnValue("create");
    db.boardTaste.update.mockReturnValue("taste");
    db.$transaction.mockResolvedValue([]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("runs a bounded turn and doesn't wait on a link that never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return reply([
          { kind: "music", title: "Fast", creator: null, reason: "Like Record 0.", url: "https://fast.test/a" },
          { kind: "music", title: "Hung", creator: "Band", reason: "Like Record 1.", url: "https://hung.test/b" },
        ]);
      }),
    );
    resolveLink.mockImplementation((url: string) =>
      url.startsWith("https://fast")
        ? Promise.resolve({ ok: true, kind: "music", url, imageSrc: "https://img.test/a.jpg", siteName: "Fast", price: null })
        : new Promise(() => {}),
    );

    const run = generateRecs("u1");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await run).toBe(2);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: SEARCHES_PER_RUN }],
      output_config: { effort: "low" },
    });
    expect(db.boardRec.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ title: "Fast", url: "https://fast.test/a", imageUrl: "https://img.test/a.jpg" }),
        expect.objectContaining({ title: "Hung", url: searchUrl("music", "Hung", "Band"), imageUrl: null }),
      ],
    });
    expect(db.boardTaste.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: expect.objectContaining({ status: "idle", error: null, profile: "Warm and analog." }),
    });
  });

  it("gives the Claude turn its deadline and reports running out of it", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted();
        return reply([]);
      }),
    );

    expect(await generateRecs("u1")).toBe(0);
    expect(timeout).toHaveBeenCalledWith(CLAUDE_DEADLINE_MS);
    expect(db.boardTaste.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { status: "error", error: "Searching for picks took too long. Try again." },
    });
    expect(console.error).toHaveBeenCalledWith(
      "[board-recs] generation failed",
      expect.objectContaining({ userId: "u1", cause: "timeout" }),
    );
  });

  it("reports an overloaded API as busy, not as a timeout, and doesn't log the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"type":"overloaded_error"}', { status: 529 })));

    expect(await generateRecs("u1")).toBe(0);
    expect(db.boardTaste.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { status: "error", error: "Claude is busy right now. Try again in a few minutes." },
    });
    const logged = vi.mocked(console.error).mock.calls[0];
    expect(logged[1]).toMatchObject({ cause: "claude 529" });
    expect(JSON.stringify(logged)).not.toContain("overloaded_error");
  });
});

describe("describeFailure", () => {
  it("keeps causes apart", () => {
    expect(describeFailure(new ClaudeAPIError(401, "bad key"))).toEqual({
      cause: "claude 401",
      error: "Couldn't get picks right now. Try again.",
    });
    expect(describeFailure(new Error("no JSON in reply")).cause).toBe("parse");
    expect(describeFailure(new SyntaxError("Unexpected token")).cause).toBe("parse");
    expect(describeFailure(new TypeError("fetch failed"))).toEqual({
      cause: "TypeError",
      error: "Couldn't get picks right now. Try again.",
    });
  });
});
