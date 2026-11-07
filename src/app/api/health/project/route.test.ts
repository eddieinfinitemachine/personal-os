import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), projectFind: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: mocks.projectFind } } }));

import { GET } from "./route";

const call = () => GET(new Request("https://example.invalid/api/health/project"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.projectFind.mockResolvedValue({ id: "p1" });
});

describe("GET /api/health/project", () => {
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.projectFind).not.toHaveBeenCalled();
  });

  it("is null for someone with no health record", async () => {
    mocks.projectFind.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projectId: null });
  });

  it("returns the oldest live human project of the signed-in person", async () => {
    const res = await call();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ projectId: "p1" });
    expect(mocks.projectFind.mock.calls[0][0]).toEqual({
      where: { userId: "u1", kind: "human", archived: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  });
});
