import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Real signed sessions, handlers, files and PostgreSQL; only Next's request
// cookie context is supplied directly because these aren't HTTP-server tests.
const cookies = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookies.token ? { value: cookies.token } : undefined }) }));
import { signSession } from "./auth";
import { prisma } from "./prisma";
import { GET } from "@/app/api/dating/photos/[photoId]/content/route";
import { POST } from "@/app/api/dating/[id]/photos/route";
import { DELETE } from "@/app/api/dating/photos/[photoId]/route";
import { migrateDatingPhoto, type PhotoMigrationEntry } from "./dating-photo-migration";

const enabled = process.env.RUN_DATING_PHOTO_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55439" || url.pathname !== "/dating_outstanding") {
    throw new Error("Photo tests require the local dating_outstanding scratch database on port 55439");
  }
}

describe.skipIf(!enabled)("private dating photos with real Postgres and local storage", () => {
  const userId = `photo-regression-${randomUUID()}`;
  const otherId = `photo-regression-${randomUUID()}`;
  let personId: string;
  let ownerToken: string;
  let otherToken: string;
  const request = (method = "GET", bytes?: Buffer) => new Request("http://localhost/api/dating/test", {
    method, ...(bytes ? { body: new Uint8Array(bytes), headers: { "Content-Type": "image/png" } } : {}),
  });
  const upload = async () => POST(request("POST", await sharp({ create: { width: 3, height: 3, channels: 3, background: "red" } }).png().toBuffer()), { params: Promise.resolve({ id: personId }) });
  const context = (photoId: string) => ({ params: Promise.resolve({ photoId }) });
  beforeAll(async () => {
    vi.stubEnv("DATING_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("VERCEL", "");
    await prisma.user.createMany({ data: [userId, otherId].map((id) => ({ id, email: `${id}@example.invalid` })) });
    personId = (await prisma.datingPerson.create({ data: { userId, name: "Photo Regression" } })).id;
    ownerToken = await signSession({ id: userId, email: `${userId}@example.invalid` });
    otherToken = await signSession({ id: otherId, email: `${otherId}@example.invalid` });
  });
  afterEach(() => { cookies.token = ""; });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await rm(join(process.cwd(), ".private-uploads", "dating", userId), { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("uploads privately, serves only its owner with no-store, and deletes the bytes", async () => {
    cookies.token = ownerToken;
    const response = await upload();
    expect(response.status).toBe(200);
    const { photo } = await response.json();
    expect(photo.url).toBe(`/api/dating/photos/${photo.id}/content`);
    expect((await prisma.datingPhoto.findUniqueOrThrow({ where: { id: photo.id } })).url).toMatch(/^private-local:/);
    const owned = await GET(request(), context(photo.id));
    expect(owned.status).toBe(200);
    expect(owned.headers.get("cache-control")).toBe("private, no-store");
    expect(owned.headers.get("content-type")).toBe("image/webp");
    expect((await owned.arrayBuffer()).byteLength).toBeGreaterThan(0);
    cookies.token = otherToken;
    expect((await GET(request(), context(photo.id))).status).toBe(404);
    cookies.token = "invalid-token";
    expect((await GET(request(), context(photo.id))).status).toBe(401);
    cookies.token = "";
    const forged = new Request("http://localhost/test", { headers: { "x-user-id": userId } });
    expect((await GET(forged, context(photo.id))).status).toBe(401);
    cookies.token = ownerToken;
    expect((await DELETE(request("DELETE"), context(photo.id))).status).toBe(200);
    expect((await GET(request(), context(photo.id))).status).toBe(404);
  });

  it("rejects non-owner upload and fails closed without private storage in production", async () => {
    cookies.token = otherToken;
    expect((await upload()).status).toBe(404);
    cookies.token = ownerToken;
    vi.stubEnv("NODE_ENV", "production");
    try { expect((await upload()).status).toBe(503); }
    finally { vi.stubEnv("NODE_ENV", "test"); }
    expect(await prisma.datingPhoto.count({ where: { personId } })).toBe(0);
  });

  it("resumes a real DB URL swap after storage cleanup fails", async () => {
    const photo = await prisma.datingPhoto.create({ data: { userId, personId, url: "legacy" } });
    let entry: PhotoMigrationEntry | undefined;
    const deps = {
      readSource: async () => Buffer.from("image"), copyPrivate: async () => "private",
      readTarget: async () => Buffer.from("image"),
      currentUrl: async (id: string) => (await prisma.datingPhoto.findUnique({ where: { id } }))?.url ?? null,
      switchUrl: async (p: typeof photo, url: string) => (await prisma.datingPhoto.updateMany({ where: { id: p.id, userId: p.userId, url: p.url }, data: { url } })).count === 1,
      deleteSource: vi.fn(async () => {}).mockRejectedValueOnce(new Error("temporary")),
      save: async (e: PhotoMigrationEntry) => { entry = { ...e }; },
    };
    await expect(migrateDatingPhoto(photo, undefined, deps)).rejects.toThrow("temporary");
    expect((await prisma.datingPhoto.findUniqueOrThrow({ where: { id: photo.id } })).url).toBe("private");
    await migrateDatingPhoto(photo, entry, deps);
    expect(entry?.stage).toBe("complete");
    await prisma.datingPhoto.delete({ where: { id: photo.id } });
  });
});
