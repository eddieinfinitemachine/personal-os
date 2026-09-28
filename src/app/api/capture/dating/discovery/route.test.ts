import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), state: vi.fn(), people: vi.fn(), candidates: vi.fn(), records: vi.fn(), retire: vi.fn(), accept: vi.fn(), update: vi.fn(), health: vi.fn(), process: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/prisma", () => {
  const tx = { datingSourceState: { findFirst: mocks.state, update: mocks.update }, datingPerson: { findMany: mocks.people }, datingCandidate: { findMany: mocks.candidates }, datingSourceRecord: { findMany: mocks.records, updateMany: mocks.retire } };
  return { prisma: { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } };
});
vi.mock("@/lib/dating-intake/store", () => ({ acceptRecord: mocks.accept, updateHealth: mocks.health, lockOwner: vi.fn(), json: (value: unknown) => value }));
vi.mock("@/lib/dating-intake/extract", () => ({ processSource: mocks.process }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
import { GET, POST } from "./route";
import { discoveryEnvelopes } from "@/lib/dating-intake/message-discovery";
const record = discoveryEnvelopes({ id: "1", source: "imessage", handle: "+15551234567", oneToOne: true }, [{ position: { date: "1", id: 1 }, guid: "m", sentAt: "2026-09-27T00:00:00Z", fromMe: false, text: "Would you like another date?" }], 1, 1)[0];
const req = (body: unknown) => new Request("https://example.invalid/api/capture/dating/discovery", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue("owner"); mocks.state.mockResolvedValue({ id: "owned-source", cursor: {} });
  mocks.people.mockResolvedValue([]); mocks.candidates.mockResolvedValue([]); mocks.records.mockResolvedValue([]);
  mocks.accept.mockResolvedValue({ accepted: true });
});
describe("capture discovery authorization and progress", () => {
  it("requires capture authorization and explicit enablement without exposing handles", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://example.invalid"))).status).toBe(401);
    mocks.state.mockResolvedValue(null);
    expect(await (await GET(new Request("https://example.invalid"))).json()).toMatchObject({ enabled: false });
    expect(mocks.people).not.toHaveBeenCalled();
    expect((await POST(req({ action: "record", envelope: record }))).status).toBe(409);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("returns approved/excluded exact handles and bounded expired source IDs only for the owner", async () => {
    mocks.people.mockResolvedValue([{ handles: ["+15557654321"] }]);
    mocks.candidates.mockResolvedValue([{ identities: ["+15559876543"] }]);
    mocks.records.mockResolvedValue([{ externalId: record.externalId }]);
    const result = await (await GET(new Request("https://example.invalid"))).json();
    expect(result.excludedHandles).toEqual(["+15557654321", "+15559876543"]);
    expect(result.refetchIds).toEqual([record.externalId]);
    expect(mocks.records).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner", stateId: "owned-source", status: "expired", title: { notIn: ["+15557654321", "+15559876543"] } }, take: 100 }));
  });
  it("rejects claimed names and excluded identities, then passes only the owned source to intake", async () => {
    expect((await POST(req({ action: "record", envelope: { ...record, title: "guessed name" } }))).status).toBe(400);
    mocks.people.mockResolvedValueOnce([{ handles: [record.title] }]);
    expect((await POST(req({ action: "record", envelope: record }))).status).toBe(409);
    const response = await POST(req({ action: "record", envelope: record, userId: "other", stateId: "other-source" }));
    expect(response.status).toBe(200);
    expect(mocks.accept).toHaveBeenCalledWith("owner", "owned-source", { ...record, occurredAt: "2026-09-27T00:00:00.000Z" });
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("retires expired retries for excluded identities and does not globally suppress a deleted profile", async () => {
    mocks.candidates.mockResolvedValue([{ identities: [record.title] }]);
    await POST(req({ action: "progress", complete: true, error: false, remaining: 0, coverageStart: "2026-08-28T00:00:00Z", coverageEnd: "2026-09-27T00:00:00Z" }));
    expect(mocks.candidates).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner", OR: [{ status: "excluded" }, { status: "approved", personId: { not: null } }] } }));
    expect(mocks.retire).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner", stateId: "owned-source", status: "expired", title: { in: [record.title] } }, data: expect.objectContaining({ status: "withdrawn" }) }));
  });
  it("does not claim completed coverage while there is unuploaded work", async () => {
    const progress = { action: "progress", complete: true, error: false, remaining: 2, coverageStart: "2026-08-28T00:00:00Z", coverageEnd: "2026-09-27T00:00:00Z" };
    expect((await POST(req(progress))).status).toBe(400);
    expect((await POST(req({ ...progress, complete: false }))).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ manifest: { complete: false }, cursor: { adapterBacklog: 2, adapterError: null } });
    expect(mocks.update.mock.calls[0][0].data.coverageStart).toBeUndefined();
    expect(mocks.after).toHaveBeenCalledOnce();
  });
});
