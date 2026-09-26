import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRecsPrompt, parseRecsReply, searchUrl } from "@/lib/board-recs";
import { callClaudeWithServerTools } from "@/lib/claude";

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
