import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), person: vi.fn(), events: vi.fn(), photos: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    datingPerson: { findFirst: mocks.person },
    datingEvent: { findMany: mocks.events },
    datingPhoto: { findMany: mocks.photos },
  },
}));
vi.mock("@/lib/user-image", () => ({ deleteUserImage: vi.fn() }));
vi.mock("@/lib/dating-intake/people", () => ({ updateWithIdentity: vi.fn(), removeWithIdentity: vi.fn() }));
vi.mock("@/lib/dating-insights", () => ({ refreshDatingInsights: vi.fn() }));
import { GET } from "@/app/api/dating/[id]/route";

const day = new Date("2026-09-12T12:00:00Z");
const person = {
  id: "p", userId: "owner", name: "Ada", handles: [], instagram: null, stage: "dating", metVia: null, metAt: day, endedAt: null,
  age: null, city: null, work: null, remember: [], greenFlags: [], redFlags: [], notes: null, lessons: null, insights: null,
  insightsAt: null, lastMessageAt: null, createdAt: day, updatedAt: day,
};
const get = () => GET(new Request("http://localhost/api/dating/p"), { params: Promise.resolve({ id: "p" }) });

describe("GET /api/dating/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue("owner");
    mocks.person.mockResolvedValue(person);
    mocks.events.mockResolvedValue([{ id: "e", userId: "owner", personId: "p", occurredAt: day, kind: "date", title: "Dinner", notes: null, vibe: 8, source: null, externalId: null, createdAt: day, sourceRecordId: "s", machineContentHash: null }]);
    mocks.photos.mockResolvedValue([{ id: "ph", url: "blob-path", caption: null, createdAt: day }]);
  });
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.person).not.toHaveBeenCalled();
  });
  it("is a 404 for someone else's person, before reading the timeline", async () => {
    mocks.person.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mocks.person).toHaveBeenCalledWith({ where: { id: "p", userId: "owner" } });
    expect(mocks.events).not.toHaveBeenCalled();
  });
  it("returns the profile, timeline and photos without storage paths or owner ids", async () => {
    const res = await get();
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.person).toMatchObject({ id: "p", name: "Ada", metAt: day.toISOString() });
    expect(body.person.userId).toBeUndefined();
    expect(body.events).toEqual([expect.objectContaining({ id: "e", title: "Dinner", vibe: 8, occurredAt: day.toISOString() })]);
    expect(body.events[0].userId).toBeUndefined();
    expect(body.events[0].sourceRecordId).toBeUndefined();
    expect(body.photos).toEqual([{ id: "ph", url: "/api/dating/photos/ph/content", caption: null, createdAt: day.toISOString() }]);
  });
});
