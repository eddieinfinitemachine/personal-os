import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), claude: vi.fn(), dating: vi.fn(), contacts: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.auth }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingPerson: { findMany: mocks.dating }, person: { findMany: mocks.contacts } } }));
import { POST } from "@/app/api/dating/prepare/route";
const call = (body: unknown) => POST(new Request("http://localhost/api/dating/prepare", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("owner");
  mocks.dating.mockResolvedValue([]);
  mocks.contacts.mockResolvedValue([]);
  mocks.claude.mockResolvedValue({ name: "Diana Rose", handles: [], instagram: null });
});
describe("prepare dating route", () => {
  it("requires authentication before reading records or calling the model", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await call({ text: "Diana Rose", today: "2026-09-27" })).status).toBe(401);
    expect(mocks.dating).not.toHaveBeenCalled();
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { text: 4 }, { text: " " }, { text: "Diana", today: "2026-02-30" }])("rejects invalid input %j", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("rejects an oversized paragraph before contacting the model", async () => {
    expect((await call({ text: "x".repeat(20001), today: "2026-09-27" })).status).toBe(413);
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("uses an exact owner-scoped CRM full name and returns verified contact details", async () => {
    mocks.contacts.mockResolvedValue([{ firstName: "Diana", lastName: "Rose", phone: "4155550134", email: null, socialUrls: { instagram: "diana.rose" }, city: "Brooklyn", role: null, company: null, howWeMet: null }]);
    const result = await call({ text: "Diana Rose is an architect.", today: "2026-09-27" });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ draft: { name: "Diana Rose", handles: ["+14155550134"], instagram: "diana.rose", notes: "Diana Rose is an architect." } });
    expect(mocks.dating.mock.calls[0][0].where).toEqual({ userId: "owner" });
    expect(mocks.contacts.mock.calls[0][0]).toMatchObject({ where: { userId: "owner", archived: false, OR: [{ firstName: { equals: "Diana", mode: "insensitive" }, lastName: { equals: "Rose", mode: "insensitive" } }] }, take: 2 });
  });
  it("never broadens a first-name paragraph to a contact lookup", async () => {
    mocks.claude.mockResolvedValue({ name: "Diana" });
    expect((await call({ text: "Diana is an architect.", today: "2026-09-27" })).status).toBe(200);
    expect(mocks.contacts).not.toHaveBeenCalled();
  });
  it("does not use contact data when two records have the same full name", async () => {
    mocks.contacts.mockResolvedValue([1, 2].map((n) => ({ firstName: "Diana", lastName: "Rose", phone: `415555013${n}`, email: null, socialUrls: null })));
    const result = await call({ text: "Diana Rose is an architect.", today: "2026-09-27" });
    expect((await result.json()).draft.handles).toEqual([]);
  });
  it("sends only paragraph-matching saved history and the local day to the model", async () => {
    mocks.dating.mockResolvedValue([
      { id: "diana", name: "Diana Rose", notes: "Authorized matching history", metAt: new Date("2024-01-01"), endedAt: null },
      { id: "other", name: "Unrelated Person", notes: "Do not send this", metAt: null, endedAt: null },
      { id: "first-only", name: "Diana", notes: "Do not send this first-name-only history", metAt: null, endedAt: null },
    ]);
    const result = await call({ text: "Diana Rose is an architect.", today: "2026-09-27" });
    const prompt = mocks.claude.mock.calls[0][0].user;
    expect(prompt).toContain("2026-09-27");
    expect(prompt).toContain("Authorized matching history");
    expect(prompt).not.toContain("Do not send this");
    expect(await result.json()).toMatchObject({ existingPerson: { id: "diana", name: "Diana Rose" } });
  });
  it("returns a recoverable error for model failures and performs no writes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claude.mockRejectedValueOnce(new Error("unavailable"));
    try {
      const result = await call({ text: "Diana Rose", today: "2026-09-27" });
      expect(result.status).toBe(502);
      expect((await result.json()).error).toContain("Try again");
      expect(mocks.contacts).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("dating prepare failed");
    } finally { log.mockRestore(); }
  });
});
