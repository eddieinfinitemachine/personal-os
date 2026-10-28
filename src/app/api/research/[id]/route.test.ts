import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  remove: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { researchReport: { findFirst: mocks.findFirst, delete: mocks.remove } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
import { DELETE } from "./route";

const req = () => new Request("https://example.invalid/api/research/r1", { method: "DELETE" });
const ctx = { params: Promise.resolve({ id: "r1" }) };
const pdfUrl = "https://blob.example.invalid/users/founder/research/r1/1-report.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.findFirst.mockResolvedValue({ id: "r1", pdfUrl });
  mocks.remove.mockResolvedValue({});
  mocks.del.mockResolvedValue(undefined);
});

describe("DELETE /api/research/[id]", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await DELETE(req(), ctx)).status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("404s for a report the caller doesn't own", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.findFirst.mockResolvedValueOnce(null);
    expect((await DELETE(req(), ctx)).status).toBe(404);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "r1", userId: "friend" });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("deletes the row and its PDF", async () => {
    expect((await DELETE(req(), ctx)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(mocks.del).toHaveBeenCalledWith(pdfUrl);
  });

  it("still succeeds when the blob delete fails, and skips it when there's no PDF", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.del.mockRejectedValueOnce(new Error("blob down"));
    expect((await DELETE(req(), ctx)).status).toBe(200);
    mocks.findFirst.mockResolvedValueOnce({ id: "r1", pdfUrl: null });
    mocks.del.mockClear();
    expect((await DELETE(req(), ctx)).status).toBe(200);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
