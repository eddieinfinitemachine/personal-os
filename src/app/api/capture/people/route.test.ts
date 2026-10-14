import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findMany: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { person: { findMany: mocks.findMany, create: mocks.create } } }));
import { POST } from "./route";

const req = (body: unknown) => new Request("https://example.invalid/api/capture/people", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const avery = { cardId: "A1", firstName: "Avery", lastName: "Example", phones: ["555-123-4567"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("owner");
  mocks.findMany.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }: { data: { externalId: string } }) => ({ id: "p-" + data.externalId }));
});

describe("POST /api/capture/people", () => {
  it("requires capture auth", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(req({ people: [avery] }))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("rejects bad bodies and oversized requests", async () => {
    expect((await POST(req({ people: "x" }))).status).toBe(400);
    expect((await POST(req("x".repeat(210 * 1024)))).status).toBe(413);
  });
  it("creates owner-scoped people and reports skips", async () => {
    mocks.findMany.mockResolvedValue([{ id: "e1", firstName: "Blake", lastName: "Sample", phone: null, email: "blake@example.com", externalId: null, archived: false }]);
    const res = await POST(req({ people: [avery, { cardId: "B2", firstName: "Blake", emails: ["Blake@Example.com"] }] }));
    expect(await res.json()).toEqual({ created: [{ cardId: "A1", personId: "p-contacts:A1" }], skipped: [{ cardId: "B2", reason: "email-match" }] });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner" } }));
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "owner", phone: "+15551234567", tags: ["from-contacts"], externalId: "contacts:A1" }), select: { id: true } });
  });
  it("treats a unique externalId race as already existing", async () => {
    mocks.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    expect(await (await POST(req({ people: [avery] }))).json()).toEqual({ created: [], skipped: [{ cardId: "A1", reason: "exists" }] });
  });
});
