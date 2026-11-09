import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  projectFind: vi.fn(),
  listFindMany: vi.fn(),
  todoFindMany: vi.fn(),
  noteCount: vi.fn(),
  attachmentCount: vi.fn(),
  vehicleFind: vi.fn(),
  petFind: vi.fn(),
  ensureDefaultLists: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mocks.projectFind },
    list: { findMany: mocks.listFindMany },
    todo: { findMany: mocks.todoFindMany },
    note: { count: mocks.noteCount },
    attachment: { count: mocks.attachmentCount },
    vehicle: { findUnique: mocks.vehicleFind },
    pet: { findUnique: mocks.petFind },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/lists", () => ({ ensureDefaultLists: mocks.ensureDefaultLists }));
import { GET } from "./route";

const call = (id = "p1") => GET(new Request(`https://example.invalid/api/projects/${id}`), { params: Promise.resolve({ id }) });
const t = new Date("2026-03-04T05:06:07.000Z");
const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Errands",
  kind: "generic",
  archived: false,
  createdAt: t,
  updatedAt: t,
  userId: "u1",
  vehicle: null,
  pet: null,
  human: null,
  ...over,
});
const list = (id: string, name: string, position: number) => ({ id, name, color: "blue", position, isDefault: true, userId: "u1", createdAt: t, updatedAt: t });
const todo = (id: string, listId: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  notes: null,
  dueDate: null,
  completedAt: null,
  createdAt: t,
  snoozedUntil: null,
  projectId: "p1",
  listId,
  subtasks: [],
  _count: { attachments: 0 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.projectFind.mockResolvedValue(project());
  mocks.ensureDefaultLists.mockResolvedValue(undefined);
  mocks.listFindMany.mockResolvedValue([list("l0", "To Do", 0), list("l1", "Monitor", 1), list("l2", "Later", 2)]);
  mocks.todoFindMany.mockResolvedValue([
    todo("call", "l0", { dueDate: new Date("2026-11-12T00:00:00.000Z"), _count: { attachments: 1 } }),
    todo("on-a-custom-list", "l-custom"),
  ]);
  mocks.noteCount.mockResolvedValue(3);
  mocks.attachmentCount.mockResolvedValue(2);
});

describe("GET /api/projects/[id]", () => {
  it("401s when signed out", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.projectFind).not.toHaveBeenCalled();
  });

  it("404s on another user's project and reads nothing else", async () => {
    mocks.projectFind.mockResolvedValue(project({ userId: "someone-else" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    for (const m of [mocks.todoFindMany, mocks.noteCount, mocks.attachmentCount, mocks.vehicleFind, mocks.petFind]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it("404s on a missing project", async () => {
    mocks.projectFind.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
  });

  it("gives a generic project's header, counts and Tasks tab", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.project).toEqual({
      id: "p1",
      name: "Errands",
      kind: "generic",
      archived: false,
      createdAt: "2026-03-04T05:06:07.000Z",
      updatedAt: "2026-03-04T05:06:07.000Z",
      hasDashboard: false,
      vehicleId: null,
      petId: null,
      humanId: null,
    });
    expect(body.notesCount).toBe(3);
    expect(body.attachmentsCount).toBe(2);
    expect(mocks.noteCount).toHaveBeenCalledWith({ where: { userId: "u1", projectId: "p1" } });
    expect(mocks.attachmentCount).toHaveBeenCalledWith({ where: { userId: "u1", projectId: "p1" } });
    // The page's rule: default lists only, so the custom-list todo is left out.
    expect(body.tasks.map((g: { list: { name: string }; totalCount: number }) => [g.list.name, g.totalCount])).toEqual([
      ["To Do", 1],
      ["Monitor", 0],
      ["Later", 0],
    ]);
    expect(body.tasks[0].todos).toEqual([
      {
        id: "call",
        title: "call",
        notes: null,
        dueDate: "2026-11-12T00:00:00.000Z",
        completedAt: null,
        createdAt: "2026-03-04T05:06:07.000Z",
        snoozedUntil: null,
        attachmentCount: 1,
        projectId: "p1",
        subtasks: [],
      },
    ]);
    expect(body.vehicle).toBeNull();
    expect(body.pet).toBeNull();
    expect(mocks.vehicleFind).not.toHaveBeenCalled();
    expect(mocks.petFind).not.toHaveBeenCalled();
  });

  it("adds a vehicle's dashboard with each service item's due status", async () => {
    mocks.projectFind.mockResolvedValue(project({ kind: "vehicle", vehicle: { id: "v1" } }));
    mocks.vehicleFind.mockResolvedValue({
      id: "v1",
      make: "Volvo",
      currentMileage: 50_500,
      serviceItems: [{ id: "tires", name: "Tires", intervalMonths: null, intervalMileage: 1_000, lastPerformedAt: null, lastPerformedMileage: 50_000 }],
      serviceRecords: [],
      contacts: [],
      photos: [],
      shoppingItems: [],
      recommendations: [],
      drives: [],
    });
    const body = await (await call()).json();
    expect(mocks.vehicleFind.mock.calls[0][0].where).toEqual({ projectId: "p1" });
    expect(body.project).toMatchObject({ kind: "vehicle", hasDashboard: true, vehicleId: "v1" });
    expect(body.vehicle).toMatchObject({ id: "v1", make: "Volvo" });
    expect(body.vehicle.serviceItems[0]).toMatchObject({ id: "tires", due: { status: "due-soon", dueMileage: 51_000, milesFromNow: 500 } });
    expect(body.pet).toBeNull();
    expect(mocks.petFind).not.toHaveBeenCalled();
  });

  it("adds a pet's dashboard with each vaccination's booster status", async () => {
    mocks.projectFind.mockResolvedValue(project({ kind: "pet", pet: { id: "pet1" } }));
    mocks.petFind.mockResolvedValue({
      id: "pet1",
      name: "Miso",
      weights: [],
      vaccinations: [{ id: "rabies", name: "Rabies", boosterDueAt: null }],
      vetVisits: [],
      photos: [],
      shoppingItems: [],
      recommendations: [],
    });
    const body = await (await call()).json();
    expect(mocks.petFind.mock.calls[0][0].where).toEqual({ projectId: "p1" });
    expect(body.pet).toMatchObject({ id: "pet1", name: "Miso", vaccinations: [{ id: "rabies", due: { status: "unknown", daysFromNow: null } }] });
    expect(body.vehicle).toBeNull();
  });

  it("gives a vehicle project without a vehicle record a null dashboard, as the page shows it empty", async () => {
    mocks.projectFind.mockResolvedValue(project({ kind: "vehicle" }));
    mocks.vehicleFind.mockResolvedValue(null);
    const body = await (await call()).json();
    expect(body.project.hasDashboard).toBe(true);
    expect(body.vehicle).toBeNull();
  });
});
