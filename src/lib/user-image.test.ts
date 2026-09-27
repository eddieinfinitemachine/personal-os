import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { deleteUserImageStrict, readUserImage, storeUserImage } from "./user-image";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); });
const photo = () => sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();

describe("private dating storage", () => {
  it("fails closed in production even when the public board token exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "public-token");
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "");
    await expect(storeUserImage("u", "dating/p", await photo())).rejects.toThrow("Private dating photo storage is not configured");
    expect(blob.put).not.toHaveBeenCalled();
  });
  it("uses the dedicated private token for dating and preserves public board uploads", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "public-token");
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "private-token");
    blob.put.mockResolvedValue({ url: "https://s.private.blob.vercel-storage.com/users/u/dating/p/a.webp" });
    await storeUserImage("u", "dating/p", await photo());
    expect(blob.put).toHaveBeenLastCalledWith(expect.any(String), expect.any(Buffer), expect.objectContaining({ access: "private", token: "private-token" }));
    await storeUserImage("u", "board", await photo());
    expect(blob.put).toHaveBeenLastCalledWith(expect.any(String), expect.any(Buffer), expect.objectContaining({ access: "public" }));
  });
  it("keeps local bytes outside public and still reads/deletes them", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "");
    const dir = await mkdtemp(join(tmpdir(), "dating-private-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const stored = await storeUserImage("u", "dating/p", await photo());
      expect(stored!.imageUrl).toMatch(/^private-local:\/dating\/u\/p\//);
      expect(await readUserImage("u", "dating/p", stored!.imageUrl)).toBeInstanceOf(Buffer);
      expect(await readUserImage("other", "dating/p", stored!.imageUrl)).toBeNull();
      await deleteUserImageStrict("u", "dating/p", stored!.imageUrl);
      expect(await readUserImage("u", "dating/p", stored!.imageUrl)).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("authenticates private reads and deletions; rejects wrong ownership", async () => {
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "private-token");
    const url = "https://s.private.blob.vercel-storage.com/users/u/dating/p/a.webp";
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response("bytes").body });
    expect((await readUserImage("u", "dating/p", url))?.toString()).toBe("bytes");
    expect(blob.get).toHaveBeenCalledWith(url, expect.objectContaining({ access: "private", token: "private-token" }));
    await deleteUserImageStrict("other", "dating/p", url);
    expect(blob.del).not.toHaveBeenCalled();
    await deleteUserImageStrict("u", "dating/p", url);
    expect(blob.del).toHaveBeenCalledWith(url, { token: "private-token" });
  });
  it("retains legacy public reads and cleanup without using the private token", async () => {
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "private-token");
    const fetcher = vi.fn(async () => new Response("legacy"));
    vi.stubGlobal("fetch", fetcher);
    for (const folder of ["board", "dating/p"]) {
      const url = `https://s.public.blob.vercel-storage.com/users/u/${folder}/a.webp`;
      expect((await readUserImage("u", folder, url))?.toString()).toBe("legacy");
      await deleteUserImageStrict("u", folder, url);
      expect(blob.del).toHaveBeenLastCalledWith(url);
    }
    expect(blob.get).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
