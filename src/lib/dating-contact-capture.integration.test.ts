import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/capture/dating/contacts/route";
import { prisma } from "@/lib/prisma";

const enabled = process.env.RUN_DATING_CONTACT_CAPTURE_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.port !== "55441" || url.pathname !== "/dating_natural_add") {
    throw new Error("Contact integration requires the local dating_natural_add scratch database on port 55441");
  }
}

// Real capture-token auth, route handlers, PostgreSQL row guards and advisory
// locks. Only the test simulating a mid-request manual edit wraps a DB method.
describe.skipIf(!enabled)("capture contact resolution with real Postgres", () => {
  let userId: string;
  let otherId: string;
  const token = "contact-regression-owner-token";
  const otherToken = "contact-regression-other-token";
  const address = "http://localhost/api/capture/dating/contacts";
  const person = (name: string, handles: string[] = [], owner = userId) => prisma.datingPerson.create({ data: { userId: owner, name, handles } });
  const get = (auth: string | null = token) => GET(new Request(address, { headers: auth ? { authorization: `Bearer ${auth}` } : {} }));
  const post = (p: { id: string; name: string }, handles = ["+14155550134"], auth: string | null = token) => POST(new Request(address, {
    method: "POST", headers: auth ? { authorization: `Bearer ${auth}` } : {}, body: JSON.stringify({ personId: p.id, name: p.name, handles }),
  }));
  beforeEach(async () => {
    userId = `contact-regression-${randomUUID()}`;
    otherId = `contact-regression-${randomUUID()}`;
    await prisma.user.createMany({ data: [userId, otherId].map((id) => ({ id, email: `${id}@example.invalid` })) });
    vi.stubEnv("CAPTURE_TOKEN", token);
    vi.stubEnv("FOUNDER_EMAIL", `${userId}@example.invalid`);
    vi.stubEnv("CAPTURE_TOKENS", JSON.stringify({ [otherToken]: `${otherId}@example.invalid` }));
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });
  afterAll(() => prisma.$disconnect());

  it("requires a valid token and scopes discovery and writes to its owner", async () => {
    const own = await person("Ana Reyes"); const foreign = await person("Bea Smith", [], otherId);
    for (const auth of [null, "invalid-token"]) {
      expect((await get(auth)).status).toBe(401);
      expect((await post(own, undefined, auth)).status).toBe(401);
    }
    expect(await (await get()).json()).toEqual({ people: [{ id: own.id, name: own.name }], refreshContacts: true });
    expect(await (await get(otherToken)).json()).toEqual({ people: [{ id: foreign.id, name: foreign.name }], refreshContacts: true });
    expect((await post(foreign)).status).toBe(404);
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: foreign.id } })).handles).toEqual([]);
  });

  it.each([false, true])("rejects duplicate normalized full names even when sibling already has handles=%s", async (hasHandles) => {
    const own = await person("Zoë Martin");
    await person("  ZOE\u0308   MARTIN ", hasHandles ? ["+14155550999"] : []);
    expect(await (await get()).json()).toEqual({ people: [] });
    expect(await (await post(own)).json()).toEqual({ resolved: false, reason: "ambiguous_name" });
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: own.id } })).handles).toEqual([]);
  });

  it("normalizes and saves only the target contact, preserving explicit international prefixes", async () => {
    const own = await person("Ana Reyes"); const other = await person("Bea Smith");
    expect(await (await post(own, ["+354 123 4567", "ANA@example.test", "ANA@example.test"])).json()).toEqual({ resolved: true });
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: own.id } })).handles).toEqual(["+3541234567", "ana@example.test"]);
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: other.id } })).handles).toEqual([]);
  });

  it("declines shared handles without blocking another account's independent contacts", async () => {
    const own = await person("Ana Reyes"); await person("Bea Smith", ["+14155550134"]);
    expect(await (await post(own)).json()).toEqual({ resolved: false, reason: "shared_contact" });
    const foreign = await person("Ana Reyes", [], otherId);
    expect(await (await post(foreign, undefined, otherToken)).json()).toEqual({ resolved: true });
  });

  it("assigns a shared handle to at most one profile during simultaneous resolutions", async () => {
    const first = await person("Ana Reyes"); const second = await person("Bea Smith");
    const results = await Promise.all([post(first), post(second)]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((r) => r.resolved)).toHaveLength(1);
    expect(bodies.filter((r) => r.reason === "shared_contact")).toHaveLength(1);
    expect(await prisma.datingPerson.count({ where: { userId, handles: { has: "+14155550134" } } })).toBe(1);
  });

  it("does not replace a phone or name manually edited after discovery", async () => {
    const own = await person("Ana Reyes"); await get();
    await prisma.datingPerson.update({ where: { id: own.id }, data: { name: "Ana Gomez" } });
    expect((await post(own)).status).toBe(409);
    await prisma.datingPerson.update({ where: { id: own.id }, data: { name: own.name, handles: ["+14155550999"] } });
    expect(await (await post(own)).json()).toEqual({ resolved: false, reason: "already_set" });
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: own.id } })).handles).toEqual(["+14155550999"]);
  });

  it.each(["name", "handles"] as const)("conditional write preserves a manual %s edit arriving after transaction reads", async (field) => {
    const own = await person("Ana Reyes");
    const edit = field === "name" ? { name: "Ana Gomez" } : { handles: ["+14155550999"] };
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((fn: (tx: Prisma.TransactionClient) => unknown) =>
      transaction(async (tx) => {
        const wrapped = new Proxy(tx, { get(target, key) {
          if (key !== "datingPerson") return Reflect.get(target, key);
          return new Proxy(tx.datingPerson, { get(delegate, method) {
            if (method !== "updateMany") return Reflect.get(delegate, method);
            return async (args: Parameters<typeof tx.datingPerson.updateMany>[0]) => {
              await prisma.datingPerson.update({ where: { id: own.id }, data: edit });
              return tx.datingPerson.updateMany(args);
            };
          } });
        } });
        return fn(wrapped);
      })
    ) as typeof prisma.$transaction);
    expect(await (await post(own)).json()).toEqual({ resolved: false });
    expect(await prisma.datingPerson.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject(edit);
  });
});
