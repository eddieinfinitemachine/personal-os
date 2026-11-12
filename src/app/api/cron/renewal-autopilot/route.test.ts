import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findList: vi.fn(),
  aggregate: vi.fn(),
  createMany: vi.fn(),
  vehicles: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ id: "founder" })) },
    list: { findFirst: mocks.findList },
    todo: { findMany: vi.fn(async () => []), aggregate: mocks.aggregate, createMany: mocks.createMany },
    vehicle: { findMany: mocks.vehicles },
    petVaccination: { findMany: vi.fn(async () => []) },
    serviceItem: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
import { GET } from "./route";

const vehicle = (id: string, days: number) => ({
  id,
  policyExpires: new Date(Date.now() + days * 86_400_000),
  insurer: null,
  insurerPhone: null,
  policyNumber: null,
  project: { id: `project-${id}`, name: `Car ${id}` },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-secret");
  // The founder has both To Do and the capture Inbox.
  mocks.findList.mockImplementation(async ({ where }: { where: { name: string; isDefault: boolean } }) =>
    where.isDefault && where.name === "To Do" ? { id: "todo" } : where.name === "Inbox" ? { id: "inbox" } : null,
  );
  mocks.aggregate.mockResolvedValue({ _max: { position: 8 } });
  mocks.vehicles.mockResolvedValue([vehicle("a", 3), vehicle("b", 5)]);
});

describe("GET /api/cron/renewal-autopilot", () => {
  it("still files into To Do (not the capture Inbox), after its existing todos, in order", async () => {
    const res = await GET(new Request("https://example.invalid/api/cron/renewal-autopilot", { headers: { authorization: "Bearer test-secret" } }));
    expect(res.status).toBe(200);
    expect(mocks.findList).toHaveBeenCalledWith({ where: { userId: "founder", isDefault: true, name: "To Do" } });
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { listId: "todo", parentId: null }, _max: { position: true } });
    const { data } = mocks.createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(data.map((row) => [row.listId, row.position, row.projectId])).toEqual([
      ["todo", 9, "project-a"],
      ["todo", 10, "project-b"],
    ]);
  });
});
