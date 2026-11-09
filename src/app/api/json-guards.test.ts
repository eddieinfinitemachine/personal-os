// The write routes the server-api reference listed as reading request.json()
// unguarded: a malformed body is now 400 "invalid json", not a 500.
// PATCH /api/todos/[id] is covered in its own test file.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const model = () => new Proxy({}, { get: () => mocks.db });
  return { prisma: { todo: model(), list: model(), project: model(), note: model(), attachment: model(), asset: model() } };
});
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifySharedListAdd: vi.fn() }));
import { POST as createTodo } from "./todos/route";
import { POST as createNote } from "./notes/route";
import { PATCH as editNote } from "./notes/[id]/route";
import { POST as createAttachment } from "./attachments/route";

const req = (body: string) => new Request("https://example.invalid/api/x", { method: "POST", body });
const ctx = { params: Promise.resolve({ id: "n1" }) };

const routes: [string, (body: string) => Promise<Response>][] = [
  ["POST /api/todos", (b) => createTodo(req(b))],
  ["POST /api/notes", (b) => createNote(req(b))],
  ["PATCH /api/notes/[id]", (b) => editNote(req(b), ctx)],
  ["POST /api/attachments", (b) => createAttachment(req(b))],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
});

describe.each(routes)("%s", (_name, call) => {
  it.each(["{", "not json", "", "[]", "null", "42"])("400s %j as invalid json without touching the database", async (body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("still 401s when signed out", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await call("{")).status).toBe(401);
  });
});

describe("valid bodies still reach the route's own checks", () => {
  it("POST /api/todos without a title", async () => {
    const res = await createTodo(req("{}"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "title required" });
  });

  it("POST /api/notes without a project", async () => {
    const res = await createNote(req('{"title":"x"}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "projectId required" });
  });

  it("POST /api/attachments without an owner", async () => {
    const res = await createAttachment(req('{"url":"https://example.com"}'));
    expect(res.status).toBe(400);
  });

  it("PATCH /api/notes/[id] on a missing note", async () => {
    mocks.db.mockResolvedValue({ count: 0 });
    const res = await editNote(req('{"title":"x"}'), ctx);
    expect(res.status).toBe(404);
  });
});
