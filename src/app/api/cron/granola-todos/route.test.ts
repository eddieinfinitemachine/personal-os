import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  founder: vi.fn(),
  fromEnv: vi.fn(),
  listFolders: vi.fn(),
  listNotes: vi.fn(),
  getNote: vi.fn(),
  imports: vi.fn(),
  lists: vi.fn(),
  extract: vi.fn(),
  commit: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@/lib/cron", async (orig) => ({ ...(await orig<typeof import("@/lib/cron")>()), getFounderUser: mocks.founder }));
vi.mock("@/lib/prisma", () => ({ prisma: { granolaImport: { findMany: mocks.imports } } }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: mocks.sync }));
vi.mock("@/lib/granola", async (orig) => ({ ...(await orig<typeof import("@/lib/granola")>()), granolaFromEnv: mocks.fromEnv }));
vi.mock("@/lib/meeting-import", () => ({
  importLists: mocks.lists,
  extractFromNote: mocks.extract,
  commitItems: mocks.commit,
}));
import { GET } from "./route";

const req = (auth?: string) =>
  new Request("https://example.invalid/api/cron/granola-todos", auth ? { headers: { authorization: auth } } : {});

const folder = (id: string, name: string, parentFolderId: string | null = null) => ({ id, name, parentFolderId });
const summary = (id: string, created_at: string, title = id) => ({
  id, title, created_at, updated_at: created_at, owner: { name: "Obie Odom", email: "obie@example.com" },
});

const FOLDERS = [
  folder("fol_gtm", "GTM"),
  folder("fol_gtmweekly", "GTM Weekly Review"),
  folder("fol_standup", "GTM Daily Standup"),
  folder("fol_c2", "c2"),
  folder("fol_c2ben", "C2-Ben"),
  folder("fol_leads", " Leads "),
  folder("fol_fl", "Functional Leads Meetings"),
];

let notesByFolder: Record<string, ReturnType<typeof summary>[]>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
  mocks.founder.mockResolvedValue({ id: "founder", email: "e@x.com" });
  mocks.fromEnv.mockReturnValue({ listFolders: mocks.listFolders, listNotes: mocks.listNotes, getNote: mocks.getNote });
  mocks.listFolders.mockResolvedValue(FOLDERS);
  notesByFolder = {
    fol_gtm: [summary("not_gtm1", "2026-09-28T17:00:00Z", "GTM Meeting 9/28")],
    fol_c2: [summary("not_c21", "2026-09-27T17:00:00Z")],
    fol_leads: [],
  };
  mocks.listNotes.mockImplementation(async ({ folderId }: { folderId: string }) => notesByFolder[folderId] ?? []);
  mocks.getNote.mockImplementation(async (id: string) => ({ id, web_url: `https://notes.granola.ai/d/${id}` }));
  mocks.imports.mockResolvedValue([]);
  mocks.lists.mockResolvedValue([{ id: "ob", name: "EC/OB", isDefault: false, userId: "founder" }]);
  mocks.extract.mockImplementation(async ({ note }: { note: { id: string; web_url: string } }) => ({
    meetingTitle: `Title ${note.id}`,
    meetingDate: "2026-09-28",
    webUrl: note.web_url,
    items: [{ title: "Do it", owner: "Obie", notes: null, dueDate: null, listId: "ob", listName: "EC/OB" }],
  }));
  mocks.commit.mockImplementation(async ({ items }: { items: unknown[] }) => ({
    created: items.length,
    byList: items.length ? [{ listId: "ob", listName: "EC/OB", count: items.length }] : [],
  }));
});

describe("GET /api/cron/granola-todos", () => {
  it("requires the cron secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(mocks.fromEnv).not.toHaveBeenCalled();
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("does nothing without a Granola key", async () => {
    mocks.fromEnv.mockReturnValue(null);
    const res = await GET(req());
    expect(await res.json()).toEqual({ skipped: "GRANOLA_API_KEY not set" });
    expect(mocks.founder).not.toHaveBeenCalled();
  });

  it("matches GTM / C2 / Leads exactly (any case), not their look-alikes, over a 3-day window", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.folders).toEqual(["GTM", "c2", " Leads "]);
    expect(mocks.listNotes.mock.calls.map((c) => c[0].folderId)).toEqual(["fol_gtm", "fol_c2", "fol_leads"]);
    const since: Date = mocks.listNotes.mock.calls[0][0].createdAfter;
    expect(Date.now() - since.getTime()).toBeGreaterThan(2.9 * 86400_000);
    expect(Date.now() - since.getTime()).toBeLessThan(3.1 * 86400_000);
  });

  it("imports new notes oldest first as source auto with the folder name, then syncs the calendar", async () => {
    const body = await (await GET(req())).json();
    expect(body.imported.map((i: { noteId: string }) => i.noteId)).toEqual(["not_c21", "not_gtm1"]);
    expect(body.imported[1]).toEqual({
      noteId: "not_gtm1", title: "Title not_gtm1", folder: "GTM", items: 1, byList: [{ listName: "EC/OB", count: 1 }],
    });
    expect(mocks.getNote).toHaveBeenCalledWith("not_c21", { transcript: true });
    expect(mocks.commit.mock.calls[1][0]).toEqual({
      userId: "founder",
      items: [expect.objectContaining({ title: "Do it", listId: "ob" })],
      meetingTitle: "Title not_gtm1",
      meetingDate: "2026-09-28",
      sourceUrl: "https://notes.granola.ai/d/not_gtm1",
      noteId: "not_gtm1",
      source: "auto",
      folder: "GTM",
    });
    expect(body).toMatchObject({ checked: 2, skipped: 0, deferred: 0, errors: [] });
    expect(mocks.sync).toHaveBeenCalledOnce();
  });

  it("skips notes that already have a GranolaImport row", async () => {
    mocks.imports.mockResolvedValue([{ noteId: "not_gtm1" }, { noteId: "not_c21" }]);
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ checked: 2, skipped: 2, imported: [], errors: [] });
    expect(mocks.imports.mock.calls[0][0].where).toEqual({ userId: "founder", noteId: { in: ["not_gtm1", "not_c21"] } });
    expect(mocks.getNote).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("dedupes a note filed in two matched folders (first folder wins)", async () => {
    notesByFolder.fol_c2.push(summary("not_gtm1", "2026-09-28T17:00:00Z"));
    const body = await (await GET(req())).json();
    expect(body.checked).toBe(2);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(body.imported.find((i: { noteId: string }) => i.noteId === "not_gtm1").folder).toBe("GTM");
  });

  it("leaves out notes from a non-matching child folder of a matched one", async () => {
    mocks.listFolders.mockResolvedValue([...FOLDERS, folder("fol_child", "GTM Weekly Review", "fol_gtm")]);
    notesByFolder.fol_child = [summary("not_gtm1", "2026-09-28T17:00:00Z")];
    const body = await (await GET(req())).json();
    expect(body.checked).toBe(1);
    expect(body.imported.map((i: { noteId: string }) => i.noteId)).toEqual(["not_c21"]);
  });

  it("still records a zero-item note so it is not re-read", async () => {
    mocks.extract.mockImplementation(async () => ({ meetingTitle: "Quiet", meetingDate: null, webUrl: null, items: [] }));
    const body = await (await GET(req())).json();
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.commit.mock.calls[0][0]).toMatchObject({ items: [], noteId: "not_c21", source: "auto", folder: "c2" });
    expect(body.imported.map((i: { items: number }) => i.items)).toEqual([0, 0]);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("processes at most 4 new notes per tick, oldest first", async () => {
    notesByFolder.fol_leads = Array.from({ length: 6 }, (_, i) =>
      summary(`not_lead${i}`, new Date(Date.UTC(2026, 8, 27, 10 - i)).toISOString()),
    );
    const body = await (await GET(req())).json();
    expect(body.checked).toBe(8);
    expect(body.imported).toHaveLength(4);
    expect(body.deferred).toBe(4);
    expect(body.imported.map((i: { noteId: string }) => i.noteId)).toEqual(["not_lead5", "not_lead4", "not_lead3", "not_lead2"]);
  });

  it("reports a failing note without blocking the others, and writes no row for it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.extract.mockRejectedValueOnce(new Error("model did not return JSON"));
    const body = await (await GET(req())).json();
    expect(body.errors).toEqual([{ noteId: "not_c21", title: "not_c21", error: "model did not return JSON" }]);
    expect(body.imported.map((i: { noteId: string }) => i.noteId)).toEqual(["not_gtm1"]);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].join(" ")).toContain("not_c21");
    expect(spy.mock.calls[0].join(" ")).not.toContain("synthetic");
    spy.mockRestore();
  });

  it("returns 502 when Granola can't list folders", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listFolders.mockRejectedValue(new Error("Granola 500 on /folders"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    expect(mocks.commit).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
