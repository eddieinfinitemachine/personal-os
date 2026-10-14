import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { person: { findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
import { POST } from "./route";

const req = (body: unknown) => new Request("https://example.invalid/api/capture/people/birthdays", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("owner");
  mocks.findMany.mockResolvedValue([
    { id: "p1", phone: "+15551234567", email: null, externalId: null, birthday: null },
    { id: "p2", phone: null, email: "blake@example.com", externalId: null, birthday: new Date("1980-01-01T00:00:00Z") },
  ]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/capture/people/birthdays", () => {
  it("requires capture auth and a valid body", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(req({ birthdays: [] }))).status).toBe(401);
    expect((await POST(req({ birthdays: [{ cardId: "A1", birthday: "soon" }] }))).status).toBe(400);
    expect((await POST(req("x".repeat(210 * 1024)))).status).toBe(413);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("fills only blank birthdays on the owner's active people and answers with counts", async () => {
    const res = await POST(req({ birthdays: [
      { cardId: "A1", phones: ["555-123-4567"], birthday: "1990-03-05" },
      { cardId: "B2", emails: ["Blake@Example.com"], birthday: "1991-04-06" },
      { cardId: "C3", phones: ["555-000-0000"], birthday: "1992-05-07" },
    ] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ filled: 1, alreadySet: 1, unmatched: 1, ambiguous: 0, conflicting: 0 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner", archived: false } }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", userId: "owner", birthday: null },
      data: { birthday: new Date("1990-03-05T00:00:00.000Z") },
    });
  });
  it("counts a birthday set in the CRM meanwhile as not filled", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(req({ birthdays: [{ cardId: "A1", phones: ["555-123-4567"], birthday: "1990-03-05" }] }));
    expect((await res.json()).filled).toBe(0);
  });
});
