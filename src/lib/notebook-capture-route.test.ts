import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), capture: vi.fn(), after: vi.fn(), attachmentFind: vi.fn(), attachmentDelete: vi.fn(), attachmentCount: vi.fn(), attachmentMany: vi.fn(), assetDelete: vi.fn(), session: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/notebook-capture", () => ({ captureNotebook: mocks.capture }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.session }));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
vi.mock("@/lib/prisma", () => ({ prisma: { attachment: { findUnique: mocks.attachmentFind, delete: mocks.attachmentDelete, count: mocks.attachmentCount, findMany: mocks.attachmentMany }, asset: { delete: mocks.assetDelete } } }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "@/app/api/capture/mobile/notebook/route";
import { DELETE } from "@/app/api/attachments/[id]/route";
import { deleteAssetWithBlobs } from "@/lib/asset-delete";
import { middleware } from "@/middleware";
import { MobileCaptureError } from "@/lib/mobile-capture-input";

const requestId = "12345678-1234-4234-8234-123456789abc";
const PATH = "https://example.com/api/capture/mobile/notebook";
function multipart(fields: Record<string, string>, files: File[] = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append("file", file);
  return new Request(PATH, { method: "POST", headers: { authorization: "Bearer example" }, body: form });
}
const page = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "page.jpg", { type: "image/jpeg" });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue("user-1"); });

describe("notebook capture route", () => {
  it("checks credentials before reading the body", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(multipart({ requestId }, [page()]));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("passes the parsed page to the service, returns its result uncached, and syncs the calendar afterward", async () => {
    const result = { ok: true, id: "todo-1", type: "todo", title: "1 item from your notebook", destination: "To Do", path: "/", items: [{ id: "todo-1", title: "Call plumber", dueDate: null }], skipped: [] };
    mocks.capture.mockResolvedValue(result);
    const response = await POST(multipart({ requestId, text: "" }, [page()]));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.capture).toHaveBeenCalledWith("user-1", expect.objectContaining({ requestId, text: "", url: null, files: [expect.any(File)] }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it("maps service errors to the shared error shape, with no calendar sync", async () => {
    for (const [status, message] of [[400, "bad"], [409, "reused"], [413, "big"], [415, "type"], [422, "empty"], [502, "failed"]] as const) {
      mocks.capture.mockRejectedValueOnce(new MobileCaptureError(status, message));
      const response = await POST(multipart({ requestId }, [page()]));
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: message });
    }
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects an invalid requestId and an oversized body before the service", async () => {
    expect((await POST(multipart({ requestId: "nope" }, [page()]))).status).toBe(400);
    const big = new Request(PATH, { method: "POST", headers: { "content-length": "3500001", "content-type": "multipart/form-data; boundary=x" }, body: "x" });
    expect((await POST(big)).status).toBe(413);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});

describe("middleware", () => {
  it("lets a bearer request with no session reach the route, instead of redirecting to login", async () => {
    const response = await middleware(new NextRequest(PATH, { method: "POST", headers: { authorization: "Bearer example" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });
  it("still redirects a gated route, so the check above means something", async () => {
    const response = await middleware(new NextRequest("https://example.com/api/todos", { method: "POST" }));
    expect(response.status).toBe(307); expect(response.headers.get("location")).toContain("/login");
  });
});

describe("deleting an attachment on a shared page photo", () => {
  const blob = "https://blob.example.com/page.jpg";
  const del = (id: string) => DELETE(new Request(`https://example.com/api/attachments/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
  beforeEach(() => { mocks.session.mockResolvedValue("user-1"); mocks.attachmentFind.mockResolvedValue({ id: "a", userId: "user-1", kind: "file", url: blob }); });
  it("keeps the blob while another attachment points at it", async () => {
    mocks.attachmentCount.mockResolvedValue(2);
    expect((await del("a")).status).toBe(200);
    expect(mocks.attachmentDelete).toHaveBeenCalledWith({ where: { id: "a" } });
    expect(mocks.attachmentCount).toHaveBeenCalledWith({ where: { userId: "user-1", url: blob } });
    expect(mocks.del).not.toHaveBeenCalled();
  });
  it("deletes the blob once nothing else points at it", async () => {
    mocks.attachmentCount.mockResolvedValue(0);
    expect((await del("a")).status).toBe(200);
    expect(mocks.del).toHaveBeenCalledWith(blob);
  });
  it("never deletes a blob for a link attachment", async () => {
    mocks.attachmentFind.mockResolvedValue({ id: "b", userId: "user-1", kind: "link", url: blob });
    expect((await del("b")).status).toBe(200);
    expect(mocks.del).not.toHaveBeenCalled();
  });
  it("keeps a shared blob when its asset is deleted, counting rows with no asset", async () => {
    mocks.attachmentMany.mockResolvedValue([{ url: blob }]); mocks.attachmentCount.mockResolvedValue(1);
    await deleteAssetWithBlobs("asset-1");
    expect(mocks.attachmentCount).toHaveBeenCalledWith({ where: { url: blob, OR: [{ assetId: null }, { assetId: { not: "asset-1" } }] } });
    expect(mocks.del).not.toHaveBeenCalled(); expect(mocks.assetDelete).toHaveBeenCalled();
  });
});
