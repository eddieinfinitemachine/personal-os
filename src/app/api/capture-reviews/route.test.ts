import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), get: vi.fn(), dismiss: vi.fn(), correct: vi.fn(), pending: vi.fn(), calendar: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.auth }));
vi.mock("@/lib/capture-review/read", () => ({ listCaptureReviews: mocks.list, getCaptureReview: mocks.get }));
vi.mock("@/lib/capture-review/mutate", async importOriginal => ({ ...await importOriginal<object>(), setReviewDismissal: mocks.dismiss }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/capture-review/correct", () => ({ correctCaptureReview: mocks.correct }));
vi.mock("@/lib/capture-review/calendar", () => ({ reconcilePendingReviewCalendars: mocks.pending, reconcileReviewCalendar: mocks.calendar }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<object>(), after: mocks.after }));
import { CaptureReviewError } from "@/lib/capture-review/types";
import { GET as LIST } from "./route";
import { GET, PATCH } from "./[id]/route";
import { POST } from "./[id]/correct/route";
const context = () => ({ params: Promise.resolve({ id: "review-1" }) });
const req = (body?: unknown, method = "POST") => new Request("https://example.test/api/capture-reviews/review-1", { method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue("owner");
  mocks.list.mockResolvedValue({ items: [{ id: "review-1" }], total: 1, hasMore: false });
  mocks.get.mockResolvedValue({ id: "review-1" });
  mocks.dismiss.mockResolvedValue({ id: "review-1", revision: 2 });
  mocks.correct.mockResolvedValue({ id: "review-1", revision: 2 });
});
describe("Capture Inbox API boundaries", () => {
  it("authenticates every method before reading a body or private data", async () => {
    mocks.auth.mockResolvedValue(null);
    const bad = req("{not JSON");
    const read = vi.spyOn(bad, "json");
    for (const response of [await LIST(new Request("https://example.test/api/capture-reviews")), await GET(bad, context()), await PATCH(bad, context()), await POST(bad, context())]) expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(bad.bodyUsed).toBe(false);
    for (const fn of [mocks.list, mocks.get, mocks.dismiss, mocks.correct, mocks.after]) expect(fn).not.toHaveBeenCalled();
  });
  it("scopes lists and background calendar work to the authenticated owner", async () => {
    const res = await LIST(new Request("https://example.test/api/capture-reviews?state=dismissed&offset=20&limit=10", { headers: { "x-user-id": "stranger" } }));
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledWith("owner", { state: "dismissed", offset: 20, limit: 10 });
    await mocks.after.mock.calls[0][0](); expect(mocks.pending).toHaveBeenCalledWith("owner", ["review-1"]);
  });
  it.each(["state=all", "offset=-1", "limit=NaN", "offset=1.5", "offset=9007199254740992"])("rejects malformed pagination %s", async query => {
    expect((await LIST(new Request(`https://example.test/api/capture-reviews?${query}`))).status).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not reveal another owner's review", async () => {
    mocks.get.mockResolvedValue(null);
    expect((await GET(req(), context())).status).toBe(404); expect(mocks.get).toHaveBeenCalledWith("owner", "review-1");
  });
  it.each(["{", [], null, { action: "delete", revision: 1 }, { action: "dismiss", revision: 0 }, { action: "restore", revision: "1" }])("rejects an invalid dismissal action %j", async body => {
    expect((await PATCH(req(body, "PATCH"), context())).status).toBe(400); expect(mocks.dismiss).not.toHaveBeenCalled();
  });
  it("passes owner and revision through dismissal without touching correction", async () => {
    const res = await PATCH(req({ action: "dismiss", revision: 1 }, "PATCH"), context());
    expect(res.status).toBe(200); expect(mocks.dismiss).toHaveBeenCalledWith("owner", "review-1", 1, true); expect(mocks.correct).not.toHaveBeenCalled();
  });
  it.each(["{", [], null])("rejects malformed correction JSON %j", async body => {
    expect((await POST(req(body), context())).status).toBe(400); expect(mocks.correct).not.toHaveBeenCalled();
  });
  it("bounds actual incoming bytes even without a Content-Length header", async () => {
    for (const method of ["POST", "PATCH"]) {
      const request = req(JSON.stringify({ text: "x".repeat(500_000) }), method);
      const res = method === "POST" ? await POST(request, context()) : await PATCH(request, context());
      expect(res.status).toBe(413);
    }
    expect(mocks.correct).not.toHaveBeenCalled(); expect(mocks.dismiss).not.toHaveBeenCalled();
  });
  it("returns a stale correction as 409 and schedules no calendar write", async () => {
    mocks.correct.mockRejectedValue(new CaptureReviewError(409, "This capture changed."));
    const res = await POST(req({ revision: 1, proposal: { type: "todo", title: "Changed" } }), context());
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "This capture changed." }); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("returns fresh correction state and scopes its calendar hook", async () => {
    const body = { revision: 1, proposal: { type: "todo", title: "Changed" } };
    const res = await POST(req(body), context());
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store"); expect(mocks.correct).toHaveBeenCalledWith("owner", "review-1", body);
    await mocks.after.mock.calls[0][0](); expect(mocks.calendar).toHaveBeenCalledWith("owner", "review-1");
  });
});
