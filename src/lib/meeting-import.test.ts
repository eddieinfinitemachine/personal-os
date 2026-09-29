import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lists: vi.fn(),
  createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
  upsert: vi.fn((args: unknown) => ({ op: "upsert", args })),
  transaction: vi.fn(),
  claude: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findMany: mocks.lists },
    todo: { createMany: mocks.createMany },
    granolaImport: { upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/lists", () => ({
  CAPTURE_LIST_NAME: "To Do",
  ensureDefaultLists: vi.fn(),
  ensureInboxProject: vi.fn().mockResolvedValue("inbox-project"),
}));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
import type { GranolaNote } from "@/lib/granola";
import { commitItems, extractFromNote, provenanceLine } from "@/lib/meeting-import";

const LISTS = [
  { id: "todo", name: "To Do", isDefault: true, userId: "founder" },
  { id: "ob", name: "EC/OB", isDefault: false, userId: "founder" },
  { id: "dv", name: "EC/DV", isDefault: false, userId: "founder" },
];

const base = {
  userId: "founder",
  meetingTitle: "GTM Meeting 9/28",
  meetingDate: "2026-09-28",
  sourceUrl: "https://notes.granola.ai/d/note-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lists.mockResolvedValue(LISTS);
  mocks.transaction.mockImplementation(async (ops: { op: string; args: { data?: unknown[] } }[]) =>
    ops.map((o) => (o.op === "createMany" ? { count: o.args.data!.length } : { id: "gi" })),
  );
});

describe("commitItems", () => {
  it("routes items, falls back to To Do + Inbox, and stamps the provenance line", async () => {
    const res = await commitItems({
      ...base,
      source: "manual",
      items: [
        { title: "Automate no-show texts", notes: "Keep states consistent", listId: "ob", dueDate: "2026-10-01" },
        { title: "Design the $5 ad", listId: null },
        { title: "Ghost list", listId: "someone-elses" },
        { title: "   " },
      ],
    });
    const { data, skipDuplicates } = mocks.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({
      listId: "ob",
      projectId: null,
      dueDate: new Date("2026-10-01"),
      notes: "Keep states consistent\nFrom meeting: GTM Meeting 9/28 (2026-09-28)\nhttps://notes.granola.ai/d/note-1",
      autopilotKey: null,
    });
    expect(data[1]).toMatchObject({ listId: "todo", projectId: "inbox-project" });
    expect(data[1].notes).toBe("From meeting: GTM Meeting 9/28 (2026-09-28)\nhttps://notes.granola.ai/d/note-1");
    expect(data[2]).toMatchObject({ listId: "todo", projectId: "inbox-project" });
    expect(mocks.upsert).not.toHaveBeenCalled(); // no noteId, no GranolaImport row
    expect(res).toEqual({
      created: 3,
      byList: [
        { listId: "ob", listName: "EC/OB", count: 1 },
        { listId: "todo", listName: "To Do", count: 2 },
      ],
    });
  });

  it("keys auto-imported todos granola:{noteId}:{index} and records the import in the same transaction", async () => {
    await commitItems({
      ...base,
      noteId: "not_Zh3xFsvZIANAtk",
      source: "auto",
      folder: "GTM",
      items: [{ title: "A", listId: "ob" }, { title: "B", listId: "dv" }],
    });
    const { data } = mocks.createMany.mock.calls[0][0] as { data: { autopilotKey: string }[] };
    expect(data.map((d) => d.autopilotKey)).toEqual(["granola:not_Zh3xFsvZIANAtk:0", "granola:not_Zh3xFsvZIANAtk:1"]);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_noteId: { userId: "founder", noteId: "not_Zh3xFsvZIANAtk" } },
      create: {
        userId: "founder",
        noteId: "not_Zh3xFsvZIANAtk",
        title: "GTM Meeting 9/28",
        folder: "GTM",
        source: "auto",
        itemCount: 2,
      },
      update: { itemCount: { increment: 2 } },
    });
    const ops = mocks.transaction.mock.calls[0][0] as { op: string }[];
    expect(ops.map((o) => o.op)).toEqual(["createMany", "upsert"]);
  });

  it("gives manual imports a per-commit key segment so a deliberate re-import is never dropped", async () => {
    await commitItems({ ...base, noteId: "not_Zh3xFsvZIANAtk", source: "manual", items: [{ title: "A" }] });
    const { data } = mocks.createMany.mock.calls[0][0] as { data: { autopilotKey: string }[] };
    expect(data[0].autopilotKey).toMatch(/^granola:not_Zh3xFsvZIANAtk:m[0-9a-z]+:0$/);
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ create: { source: "manual", folder: null } });
  });

  it("records a zero-item note without creating todos", async () => {
    const res = await commitItems({ ...base, noteId: "not_emptyemptyempt", source: "auto", folder: "C2", items: [] });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ create: { itemCount: 0, folder: "C2" } });
    expect(res).toEqual({ created: 0, byList: [] });
  });

  it("throws when the To Do list is missing", async () => {
    mocks.lists.mockResolvedValue(LISTS.slice(1));
    await expect(commitItems({ ...base, source: "auto", items: [{ title: "x" }] })).rejects.toThrow(
      "default To Do list missing",
    );
  });
});

describe("provenanceLine", () => {
  it("drops non-http links and a missing date", () => {
    expect(provenanceLine("M", null, "javascript:alert(1)")).toBe("From meeting: M");
    expect(provenanceLine(null, null, null)).toBeNull();
    expect(provenanceLine(null, null, " https://x.test/a ")).toBe("https://x.test/a");
  });
});

describe("extractFromNote", () => {
  const NOTE = {
    id: "not_Zh3xFsvZIANAtk",
    title: null,
    created_at: "2026-09-28T20:00:00Z",
    updated_at: "2026-09-28T21:00:00Z",
    owner: { name: "Obie Odom", email: "obie@example.com" },
    web_url: "https://notes.granola.ai/d/note-1",
    calendar_event: { event_title: "GTM Meeting 9/28", scheduled_start_time: "2026-09-28T14:00:00Z" },
    attendees: [{ name: "Obie Odom", email: "obie@example.com" }],
    summary_text: "",
    summary_markdown: "# Next Steps\n- Deposit backlog cleanup (Dave)",
    private_notes_text: null,
    private_notes_markdown: null,
    transcript: [{ speaker: { source: "speaker", name: "Obi" }, text: "I'll automate the no-show texts." }],
  } satisfies GranolaNote;

  it("reads the note once and returns routed items with the meeting header", async () => {
    mocks.claude.mockResolvedValue({
      items: [
        { title: "Automate no-show texts", owner: "Obi", listName: null },
        { title: "Deposit backlog cleanup", owner: "Dave", listName: null },
        { title: "Book the venue", owner: null, listName: null },
      ],
    });
    const ext = await extractFromNote({ userId: "founder", note: NOTE, lists: LISTS });
    expect(ext).toMatchObject({
      meetingTitle: "GTM Meeting 9/28",
      meetingDate: "2026-09-28",
      webUrl: "https://notes.granola.ai/d/note-1",
    });
    expect(ext.items.map((i) => i.listName)).toEqual(["EC/OB", "EC/DV", null]);
    const call = mocks.claude.mock.calls[0][0];
    expect(call.user).toContain("Meeting: GTM Meeting 9/28\nDate: 2026-09-28\nAttendees: Obie Odom");
    expect(call.user).toContain("Obi: I'll automate the no-show texts.");
  });
});
