import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  claude: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { exerciseVideo: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));
vi.mock("@/lib/claude", () => ({ callClaudeWithServerTools: mocks.claude }));
import { buildVideoPrompt, findExerciseVideo, parseVideoReply } from "./workout-video";
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
  it("still finds a video when the cache table is not there yet, and rethrows other errors", async () => {
    const missing = Object.assign(new Error("table does not exist"), { code: "P2021" });
    mocks.findUnique.mockRejectedValue(missing);
    mocks.upsert.mockRejectedValue(missing);
    mocks.claude.mockResolvedValue(reply('{"url": "https://youtu.be/dQw4w9WgXcQ", "title": "T"}'));
    expect(await findExerciseVideo("Plank", "bodyweight")).toMatchObject({ youtubeId: "dQw4w9WgXcQ" });
    mocks.findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(findExerciseVideo("Plank", "bodyweight")).rejects.toThrow("connection refused");
  });
});
