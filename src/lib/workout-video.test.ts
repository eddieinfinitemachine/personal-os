import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  raw: vi.fn(),
  claude: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { exerciseVideo: { findUnique: mocks.findUnique, upsert: mocks.upsert }, $executeRawUnsafe: mocks.raw },
}));
vi.mock("@/lib/claude", () => ({ callClaudeWithServerTools: mocks.claude }));
import { buildVideoPrompt, CREATE_TABLE_SQL, findExerciseVideo, parseVideoReply } from "./workout-video";
import { videoKey } from "./workout";

const reply = (text: string) => ({
  content: [
    { type: "text", text: "Let me search." },
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [] },
    { type: "text", text },
  ],
  stopReason: "end_turn",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
  mocks.raw.mockResolvedValue(0);
});

describe("videoKey", () => {
  it("joins spellings of the same movement and drops asides", () => {
    expect(videoKey("Goblet Squat")).toBe("goblet squat");
    expect(videoKey("  goblet-squat (heels elevated) ")).toBe("goblet squat");
    expect(videoKey("Dumbbell RDL")).toBe("dumbbell rdl");
    expect(videoKey("x".repeat(100))).toHaveLength(80);
  });
});

describe("buildVideoPrompt", () => {
  it("names the exercise and its equipment, and asks for JSON only", () => {
    const prompt = buildVideoPrompt("Goblet squat", "kettlebell");
    expect(prompt).toContain('"Goblet squat" with kettlebell');
    expect(prompt).toContain('{"url": "<the YouTube URL>"');
    expect(buildVideoPrompt("Plank", "bodyweight")).not.toContain("with bodyweight");
  });
});

describe("parseVideoReply", () => {
  it("reads the JSON after the last search and the id from any YouTube URL form", () => {
    expect(
      parseVideoReply(
        reply('Here it is:\n{"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Goblet Squat Form", "channel": "Coach A"}').content,
      ),
    ).toEqual({ youtubeId: "dQw4w9WgXcQ", title: "Goblet Squat Form", channel: "Coach A" });
    expect(
      parseVideoReply(reply('{"url": "https://www.youtube.com/watch?v=abc123XYZ_-&t=4s", "title": "", "channel": null}').content),
    ).toEqual({ youtubeId: "abc123XYZ_-", title: "Demonstration", channel: null });
  });
  it("returns null for no video, non-YouTube links, and prose", () => {
    expect(parseVideoReply(reply('{"url": null}').content)).toBeNull();
    expect(parseVideoReply(reply('{"url": "https://example.com/video", "title": "x"}').content)).toBeNull();
    expect(parseVideoReply(reply("I could not find one.").content)).toBeNull();
    expect(parseVideoReply([{ type: "text", text: '{"url": "https://youtu.be/dQw4w9WgXcQ"' }])).toBeNull();
  });
  it("ignores narration before the search that happens to contain JSON", () => {
    const content = [
      { type: "text", text: '{"url": "https://youtu.be/OLDOLDOLD12"}' },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: '{"url": "https://youtu.be/NEWNEWNEW12", "title": "T"}' },
    ];
    expect(parseVideoReply(content)?.youtubeId).toBe("NEWNEWNEW12");
  });
});

describe("findExerciseVideo", () => {
  it("serves the cache without searching", async () => {
    mocks.findUnique.mockResolvedValue({ key: "goblet squat", youtubeId: "dQw4w9WgXcQ", title: "T", channel: null });
    expect(await findExerciseVideo("Goblet Squat", "kettlebell")).toEqual({ youtubeId: "dQw4w9WgXcQ", title: "T", channel: null });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { key: "goblet squat" } });
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("searches on a miss and remembers a hit for everyone", async () => {
    mocks.claude.mockResolvedValue(reply('{"url": "https://youtu.be/dQw4w9WgXcQ", "title": "T", "channel": "C"}'));
    expect(await findExerciseVideo("Goblet Squat", "kettlebell")).toEqual({ youtubeId: "dQw4w9WgXcQ", title: "T", channel: "C" });
    expect(mocks.claude.mock.calls[0][0]).toMatchObject({
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      effort: "low",
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: "goblet squat" },
      create: { key: "goblet squat", name: "Goblet Squat", youtubeId: "dQw4w9WgXcQ", title: "T", channel: "C" },
      update: {},
    });
  });
  it("does not remember a miss, and asks nothing for a blank name", async () => {
    mocks.claude.mockResolvedValue(reply('{"url": null}'));
    expect(await findExerciseVideo("Goblet Squat", "")).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await findExerciseVideo("  ( ) ", "")).toBeNull();
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });
  it("creates the cache table the first time a database lacks it, then uses it", async () => {
    const missing = Object.assign(new Error("table does not exist"), { code: "P2021" });
    mocks.findUnique.mockRejectedValueOnce(missing).mockResolvedValueOnce(null);
    mocks.claude.mockResolvedValue(reply('{"url": "https://youtu.be/dQw4w9WgXcQ", "title": "T"}'));
    expect(await findExerciseVideo("Plank", "bodyweight")).toMatchObject({ youtubeId: "dQw4w9WgXcQ" });
    expect(mocks.raw).toHaveBeenCalledTimes(1);
    expect(mocks.raw.mock.calls[0][0]).toBe(CREATE_TABLE_SQL);
    expect(CREATE_TABLE_SQL).toContain('CREATE TABLE IF NOT EXISTS "ExerciseVideo"');
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    // Once created in this process, a later miss goes straight to the table.
    mocks.findUnique.mockResolvedValue(null);
    await findExerciseVideo("Squat", "");
    expect(mocks.raw).toHaveBeenCalledTimes(1);
  });
  it("still finds a video when the table cannot be created, and rethrows other errors", async () => {
    vi.resetModules();
    const fresh = await import("./workout-video");
    const missing = Object.assign(new Error("table does not exist"), { code: "P2021" });
    mocks.findUnique.mockRejectedValue(missing);
    mocks.upsert.mockRejectedValue(missing);
    mocks.raw.mockRejectedValue(new Error("permission denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claude.mockResolvedValue(reply('{"url": "https://youtu.be/dQw4w9WgXcQ", "title": "T"}'));
    expect(await fresh.findExerciseVideo("Plank", "bodyweight")).toMatchObject({ youtubeId: "dQw4w9WgXcQ" });
    expect(mocks.raw).toHaveBeenCalledTimes(2);
    mocks.findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(fresh.findExerciseVideo("Plank", "bodyweight")).rejects.toThrow("connection refused");
  });
});
