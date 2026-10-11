import { prisma } from "@/lib/prisma";
import { callClaudeWithServerTools, type ClaudeResponseBlock } from "@/lib/claude";
import { youtubeId } from "@/lib/board-embed";
import { videoKey, type ExerciseVideo } from "@/lib/workout";

// One short YouTube demo per exercise so the user can see the movement, not
// just the stick figure. Claude's web search finds it; the result is cached
// by exercise name for everyone, since a demo is not personal data.

export const VIDEO_MAX_NAME = 80;

export function buildVideoPrompt(name: string, equipment: string): string {
  return `Find one YouTube video that demonstrates how to do the exercise "${name}"${
    equipment && equipment !== "bodyweight" ? ` with ${equipment}` : ""
  } with good form.

Requirements:
- A real, public YouTube video (youtube.com/watch?v=… or youtu.be/…), ideally under 5 minutes, from a reputable coach, physiotherapist or fitness channel.
- It must show this exact movement, not a full workout or a variation with different equipment.
- Prefer a clear side or three-quarter view of the whole movement.

Reply with only this JSON, nothing else:
{"url": "<the YouTube URL>", "title": "<video title>", "channel": "<channel name or null>"}
If you cannot find a suitable video, reply with {"url": null}.`;
}

// Only the answer after the last search counts; earlier text is narration.
export function parseVideoReply(content: ClaudeResponseBlock[]): ExerciseVideo | null {
  let from = 0;
  content.forEach((b, i) => {
    if (b.type === "web_search_tool_result") from = i + 1;
  });
  const text = content
    .slice(from)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const start = text.lastIndexOf('{"url"') >= 0 ? text.lastIndexOf('{"url"') : text.indexOf("{");
  const end = text.indexOf("}", start);
  if (start < 0 || end <= start) return null;
  let data: { url?: unknown; title?: unknown; channel?: unknown };
  try {
    data = JSON.parse(text.slice(start, end + 1)) as typeof data;
  } catch {
    return null;
  }
  const id = typeof data.url === "string" ? youtubeId(data.url) : null;
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  const title = typeof data.title === "string" ? data.title.trim().slice(0, 200) : "";
  const channel = typeof data.channel === "string" ? data.channel.trim().slice(0, 120) : "";
  return { youtubeId: id, title: title || "Demonstration", channel: channel || null };
}

// The cache table is additive and shared, so the app creates it itself the
// first time a database is missing it (Prisma P2021): the same
// CREATE TABLE IF NOT EXISTS a hand migration would run, nothing else.
export const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "ExerciseVideo" (
  "key" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "youtubeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "channel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function missingTable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2021";
}

let tableEnsured: Promise<boolean> | null = null;
/** Create the table once per process; false when the database refuses. */
export function ensureExerciseVideoTable(): Promise<boolean> {
  tableEnsured ??= prisma
    .$executeRawUnsafe(CREATE_TABLE_SQL)
    .then(() => true)
    .catch((error: unknown) => {
      console.error("[workout/video] could not create ExerciseVideo", error instanceof Error ? error.message : error);
      tableEnsured = null;
      return false;
    });
  return tableEnsured;
}

/** Run a cache operation; when the table is missing, create it and try once more. */
async function withTable<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!missingTable(error)) throw error;
    if (!(await ensureExerciseVideoTable())) return fallback;
    try {
      return await work();
    } catch (again) {
      if (missingTable(again)) return fallback;
      throw again;
    }
  }
}

export async function cachedExerciseVideo(key: string): Promise<ExerciseVideo | null> {
  return withTable(async () => {
    const row = await prisma.exerciseVideo.findUnique({ where: { key } });
    return row ? { youtubeId: row.youtubeId, title: row.title, channel: row.channel } : null;
  }, null);
}

async function remember(key: string, name: string, video: ExerciseVideo): Promise<void> {
  await withTable(async () => {
    await prisma.exerciseVideo.upsert({
      where: { key },
      create: { key, name, ...video },
      update: {},
    });
  }, undefined);
}

/** The cached demo for this exercise, or a fresh search; null when none is found. */
export async function findExerciseVideo(name: string, equipment: string): Promise<ExerciseVideo | null> {
  const key = videoKey(name);
  if (!key) return null;
  const cached = await cachedExerciseVideo(key);
  if (cached) return cached;
  const { content } = await callClaudeWithServerTools({
    user: buildVideoPrompt(name, equipment),
    maxTokens: 600,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    effort: "low",
    maxContinuations: 1,
    timeoutMs: 40_000,
  });
  const video = parseVideoReply(content);
  if (video) await remember(key, name, video);
  return video;
}
