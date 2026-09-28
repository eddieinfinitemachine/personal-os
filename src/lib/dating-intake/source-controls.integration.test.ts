import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/dating/sources/route";
import { claimPairing, connector, createPairing } from "./auth";

const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55442" ||
    url.pathname !== "/dating_intake"
  )
    throw new Error("Scratch database required");
}
describe.skipIf(!enabled)("source disconnection and pairing", () => {
  let userId: string;
  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.invalid` },
    });
  });
  afterEach(() => prisma.user.deleteMany({ where: { id: userId } }));
  afterAll(() => prisma.$disconnect());
  it("disconnects every EC Pad credential including an unused replacement code", async () => {
    const first = await createPairing(userId);
    const paired = await claimPairing(first.code, "library-source-control");
    const replacement = await createPairing(userId);
    const response = await POST(
      new Request("http://localhost/api/dating/sources", {
        method: "POST",
        headers: { "x-user-id": userId },
        body: JSON.stringify({
          action: "disconnect",
          source: "ecpad",
          id: paired.stateId,
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(
      claimPairing(replacement.code, "library-replacement"),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      connector(
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${paired.token}` },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await prisma.datingSourceState.count({
        where: { userId, enabled: true },
      }),
    ).toBe(0);
    const fresh = await createPairing(userId);
    expect(
      (await claimPairing(fresh.code, "library-new-connection")).token,
    ).toHaveLength(64);
  });
  it("does not disconnect another owner's source", async () => {
    const paired = await claimPairing(
      (await createPairing(userId)).code,
      "library-owner",
    );
    const response = await POST(
      new Request("http://localhost/api/dating/sources", {
        method: "POST",
        headers: { "x-user-id": "different-owner" },
        body: JSON.stringify({
          action: "disconnect",
          source: "ecpad",
          id: paired.stateId,
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(
      (
        await connector(
          new Request("http://localhost", {
            headers: { Authorization: `Bearer ${paired.token}` },
          }),
        )
      ).enabled,
    ).toBe(true);
  });
});
