import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findLists: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { list: { findMany: mocks.findLists } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/lists", () => ({ ensureDefaultLists: vi.fn(), isListColor: () => true }));
import { GET } from "./route";

const req = () => new Request("https://example.invalid/api/lists");
const created = new Date("2026-11-01T09:00:00Z");
const eddie = { id: "eddie", name: "Eddie", email: "eddie@example.invalid" };
const shane = { id: "shane", name: null, email: "shane@example.invalid" };

const listRow = (over: Record<string, unknown>) => ({
  name: "List",
  color: "zinc",
  position: 0,
  isDefault: false,
  createdAt: created,
  updatedAt: created,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("eddie");
  mocks.findLists.mockResolvedValue([
    // Eddie's private default list.
    listRow({ id: "todo", name: "To Do", isDefault: true, userId: "eddie", user: eddie, members: [], _count: { members: 0 } }),
    // Eddie's list shared with Shane and Maya.
    listRow({
      id: "wedding",
      name: "Wedding",
      color: "rose",
      userId: "eddie",
      user: eddie,
      members: [
        { userId: "shane", color: "sky", user: { name: null, email: "shane@example.invalid" } },
        { userId: "maya", color: null, user: { name: "Maya", email: "maya@example.invalid" } },
      ],
      _count: { members: 2 },
    }),
    // Shane's list that Eddie is a member of, with Eddie's own tile color.
    listRow({
      id: "garage",
      name: "Garage",
      color: "amber",
      userId: "shane",
      user: shane,
      members: [
        { userId: "maya", color: "lime", user: { name: "Maya", email: "maya@example.invalid" } },
        { userId: "eddie", color: "violet", user: { name: "Eddie", email: "eddie@example.invalid" } },
      ],
      _count: { members: 2 },
    }),
  ]);
});

describe("GET /api/lists", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(401);
    expect(mocks.findLists).not.toHaveBeenCalled();
  });

  it("says whether each list has members, and who, as on the web Home", async () => {
    const { lists } = await (await GET(req())).json();
    expect(lists.map((l: Record<string, unknown>) => [l.id, l.shared, l.ownerName, l.collaborative, l.sharedWithNames])).toEqual([
      ["todo", false, null, false, []],
      ["wedding", false, null, true, ["shane@example.invalid", "Maya"]],
      // A member sees the owner, not the other members.
      ["garage", true, "shane@example.invalid", true, []],
    ]);
  });

  it("keeps every existing field, and a member's own tile color", async () => {
    const { lists } = await (await GET(req())).json();
    expect(lists[1]).toEqual({
      id: "wedding",
      name: "Wedding",
      color: "rose",
      position: 0,
      isDefault: false,
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      userId: "eddie",
      shared: false,
      ownerName: null,
      collaborative: true,
      sharedWithNames: ["shane@example.invalid", "Maya"],
    });
    // Eddie's own color on Shane's list, not Maya's (the first member row).
    expect(lists[2].color).toBe("violet");
    // The owner keeps the list color even when a member recolored their tile.
    expect(lists[1].color).toBe("rose");
  });

  it("loads every member with names and the member count", async () => {
    await GET(req());
    expect(mocks.findLists.mock.calls[0][0].include).toMatchObject({
      members: { select: { userId: true, color: true, user: { select: { name: true, email: true } } } },
      _count: { select: { members: true } },
    });
    expect(mocks.findLists.mock.calls[0][0].include.members.where).toBeUndefined();
  });
});
