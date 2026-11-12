import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), capture: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/mobile-capture", () => ({ captureMobile: mocks.capture }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
import { GET, POST } from "@/app/api/capture/mobile/route";
const requestId = "12345678-1234-4234-8234-123456789abc";
const request = (body: unknown) => new Request("https://example.com/api/capture/mobile", { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer example" }, body: JSON.stringify(body) });
describe("mobile capture route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue("user-1"); mocks.user.mockResolvedValue({ email: "person@example.com" }); mocks.capture.mockResolvedValue({ ok: true, id: "todo-1", type: "todo", title: "Task", destination: "Inbox", path: "/", reviewId: "review-1" }); });
  it("checks credentials before parsing or saving", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(request({ requestId, text: "hello" }));
    expect(response.status).toBe(401); expect(mocks.capture).not.toHaveBeenCalled();
    expect((await GET(new Request("https://example.com"))).status).toBe(401);
  });
  it("returns authenticated identity and limits without caching", async () => {
    const response = await GET(new Request("https://example.com"));
    expect(await response.json()).toEqual({ ok: true, email: "person@example.com", maxFiles: 10, maxRequestBytes: 3_500_000 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.user).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { email: true } });
  });
  it("uses resolved user identity and returns the stable receipt result", async () => {
    const response = await POST(request({ requestId, text: "hello", userId: "victim" }));
    expect(response.status).toBe(200);
    expect(mocks.capture).toHaveBeenCalledWith("user-1", expect.objectContaining({ requestId, text: "hello" }));
    expect(await response.json()).toMatchObject({ ok: true, id: "todo-1", destination: "Inbox", reviewId: "review-1" });
  });
  it("rejects invalid payloads before calling the service", async () => {
    const response = await POST(request({ requestId, text: 42 }));
    expect(response.status).toBe(400); expect(mocks.capture).not.toHaveBeenCalled();
  });
});
