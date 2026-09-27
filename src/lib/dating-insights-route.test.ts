import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.capture }));
vi.mock("@/lib/dating-insights", () => ({ refreshDatingInsights: mocks.refresh }));
import { POST } from "@/app/api/capture/dating/insights/route";

const request = (body: unknown) => new Request("http://localhost/api/capture/dating/insights", {
  method: "POST", body: JSON.stringify(body), headers: { authorization: "Bearer test-token" },
});

describe("capture insight refresh contract", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.capture.mockResolvedValue("owner"); });
  it("requires capture authentication before attempting a refresh", async () => {
    mocks.capture.mockResolvedValue(null);
    const res = await POST(request({ personId: "p" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ refreshed: false });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects missing, empty and non-string person ids", async () => {
    for (const body of [null, {}, { personId: [] }, { personId: "  " }, { personId: "x".repeat(201) }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("refreshes only within the token owner's scope and returns source coverage", async () => {
    const sources = { messageCount: 5, analyzedMessageCount: 5, messageSources: { whatsapp: 5 } };
    mocks.refresh.mockResolvedValue({ ok: true, refreshed: true, reason: "refreshed", person: { id: "p", insightsAt: new Date("2026-09-27") }, sources });
    const res = await POST(request({ personId: "p" }));
    expect(mocks.refresh).toHaveBeenCalledWith("owner", "p", { onlyIfStale: true });
    expect(await res.json()).toMatchObject({ personId: "p", refreshed: true, sources });
  });
  it("returns a normal success when current imports are already covered", async () => {
    mocks.refresh.mockResolvedValue({ ok: true, refreshed: false, reason: "fresh", person: { id: "p", insightsAt: new Date("2026-09-27") } });
    const res = await POST(request({ personId: "p" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ refreshed: false, reason: "fresh" });
  });
  it("returns not found for another owner's person", async () => {
    mocks.refresh.mockResolvedValue({ ok: false, status: 404, error: "not found" });
    expect((await POST(request({ personId: "foreign" }))).status).toBe(404);
  });
  it("never exposes raw provider or database errors", async () => {
    mocks.refresh.mockRejectedValue(new Error("secret provider response"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(request({ personId: "p" }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Could not refresh this summary; try again", refreshed: false });
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
    } finally { log.mockRestore(); }
  });
});
