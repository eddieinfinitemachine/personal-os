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
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: async () => session.userId }));
import { prisma } from "@/lib/prisma";
import {
  actOnContactLookup,
  getContactLookup,
  recordContactLookup,
} from "./dating-contact-lookup";
import {
  GET as captureGet,
  POST as capturePost,
} from "@/app/api/capture/dating/contacts/route";
import { GET, POST } from "@/app/api/dating/[id]/contact-lookup/route";
const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const u = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    u.hostname !== "127.0.0.1" ||
    u.port !== "55442" ||
    u.pathname !== "/dating_intake"
  )
    throw Error("Scratch required");
}
describe.skipIf(!enabled)(
  "automatic contact lookup against real PostgreSQL",
  () => {
    let userId: string, otherId: string, personId: string;
    const name = "Ana Reyes";
    const candidates = [
      {
        name: "Ana Reyes",
        phones: ["(415) 555-0134"],
        emails: ["ANA@example.test"],
      },
      { name: "Ana Reyes", phones: ["+44 7590 100000"], emails: [] },
    ];
    const report = (extra: Record<string, unknown> = {}) =>
      recordContactLookup(userId, {
        personId,
        name,
        status: "ambiguous",
        candidates,
        ...extra,
      });
    const lookup = () => getContactLookup(userId, personId);
    const choose = async (index = 0) =>
      actOnContactLookup(userId, personId, {
        action: "choose",
        index,
        checkedAt: (await lookup()).lookup.checkedAt,
      });
    const person = () =>
      prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    beforeEach(async () => {
      userId = randomUUID();
      otherId = randomUUID();
      await prisma.user.createMany({
        data: [userId, otherId].map((id) => ({
          id,
          email: `${id}@example.invalid`,
        })),
      });
      personId = (
        await prisma.datingPerson.create({
          data: {
            userId,
            name,
            notes: "Keep my notes",
            insights: { summary: "Old summary" },
            insightsAt: new Date(),
          },
        })
      ).id;
      session.userId = userId;
      vi.stubEnv("CAPTURE_TOKEN", "contact-lookup-scratch");
      vi.stubEnv("FOUNDER_EMAIL", `${userId}@example.invalid`);
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      session.userId = null;
      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherId] } },
      });
    });
    afterAll(() => prisma.$disconnect());
    it("starts pending and stores normalized scoped choices without enabling message discovery", async () => {
      expect(await lookup()).toEqual({
        lookup: {
          status: "pending",
          name,
          checkedAt: null,
          messagesCheckedAt: null,
          messagesError: false,
          candidates: [],
        },
        messageCount: 0,
        lastMessageAt: null,
      });
      await report();
      expect((await lookup()).lookup).toMatchObject({
        status: "ambiguous",
        candidates: [
          { name, phones: ["+14155550134"], emails: ["ana@example.test"] },
          { name, phones: ["+447590100000"], emails: [] },
        ],
      });
      expect(
        await prisma.datingSourceState.findFirst({ where: { userId } }),
      ).toMatchObject({ source: "texts", scope: "default", enabled: false });
      expect((await person()).handles).toEqual([]);
    });
    it("merges source configuration and preserves approvals against unchanged polling", async () => {
      await prisma.datingSourceState.create({
        data: {
          userId,
          source: "texts",
          scope: "default",
          enabled: true,
          config: { discoveryEnabled: true, keep: "saved" },
          cursor: { position: "123" },
        },
      });
      await report();
      const first = (await lookup()).lookup;
      await report();
      expect((await lookup()).lookup.checkedAt).toBe(first.checkedAt);
      await choose();
      expect(await person()).toMatchObject({
        handles: ["+14155550134", "ana@example.test"],
        notes: "Keep my notes",
        insights: null,
        insightsAt: null,
      });
      expect(
        await prisma.datingSourceState.findFirst({ where: { userId } }),
      ).toMatchObject({
        enabled: true,
        config: { discoveryEnabled: true, keep: "saved" },
        cursor: { position: "123" },
      });
      expect((await lookup()).lookup.status).toBe("matched");
    });
    it("invalidates choices when the match list, name or manual phone changes", async () => {
      await report();
      const stale = (await lookup()).lookup.checkedAt;
      await report({ candidates: [candidates[1]] });
      await expect(
        actOnContactLookup(userId, personId, {
          action: "choose",
          index: 0,
          checkedAt: stale,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await prisma.datingPerson.update({
        where: { id: personId },
        data: { name: "Ana Newname" },
      });
      expect((await lookup()).lookup.status).toBe("pending");
      await expect(report()).rejects.toMatchObject({ status: 409 });
      await prisma.datingPerson.update({
        where: { id: personId },
        data: { name, handles: ["+14155550999"] },
      });
      await expect(choose()).rejects.toMatchObject({ status: 409 });
      expect(await report({ handles: ["+14155550134"] })).toEqual({
        resolved: false,
        reason: "already_set",
      });
      expect((await person()).handles).toEqual(["+14155550999"]);
    });
    it("allows explicit selection for duplicate names but rejects automatic same-name resolution", async () => {
      await prisma.datingPerson.create({
        data: { userId, name: "  ANA   REYES " },
      });
      expect(await report({ handles: ["+14155550134"] })).toEqual({
        resolved: false,
        reason: "ambiguous_name",
      });
      await report();
      await choose();
      expect((await person()).handles).toContain("+14155550134");
    });
    it.each(["profile", "excluded"])(
      "rejects a candidate newly claimed by %s between report and approval",
      async (mode) => {
        await report();
        if (mode === "profile")
          await prisma.datingPerson.create({
            data: { userId, name: "Someone Else", handles: ["+14155550134"] },
          });
        else
          await prisma.datingCandidate.create({
            data: {
              userId,
              name: "Do not import",
              identityKey: "excluded-fixture",
              identities: ["+14155550134"],
              status: "excluded",
            },
          });
        await expect(choose()).rejects.toMatchObject({ status: 409 });
        expect(await report({ handles: ["+14155550134"] })).toEqual({
          resolved: false,
          reason: "shared_contact",
        });
        expect((await person()).handles).toEqual([]);
      },
    );
    it("serializes automatic competing assignments and leaves another account independent", async () => {
      const second = await prisma.datingPerson.create({
        data: { userId, name: "Bea Martin" },
      });
      const results = await Promise.all([
        report({ handles: ["+14155550134"] }),
        report({
          personId: second.id,
          name: second.name,
          handles: ["+14155550134"],
        }),
      ]);
      expect(results.filter((r) => r.resolved)).toHaveLength(1);
      expect(
        results.filter((r) => "reason" in r && r.reason === "shared_contact"),
      ).toHaveLength(1);
      const foreign = await prisma.datingPerson.create({
        data: { userId: otherId, name },
      });
      expect(
        await recordContactLookup(otherId, {
          personId: foreign.id,
          name,
          handles: ["+14155550134"],
        }),
      ).toEqual({ resolved: true });
    });
    it("tracks completed message checks only for the same name and exact handles", async () => {
      await report({ handles: ["+14155550134"] });
      expect((await lookup()).lookup.messagesCheckedAt).toBeNull();
      await report({ status: "messages_checked", handles: ["+14155550134"] });
      expect((await lookup()).lookup.messagesCheckedAt).toEqual(
        expect.any(String),
      );
      const lastCheck = (await lookup()).lookup.messagesCheckedAt;
      await report({
        status: "messages_unavailable",
        handles: ["+14155550134"],
      });
      expect((await lookup()).lookup).toMatchObject({
        messagesError: true,
        messagesCheckedAt: lastCheck,
      });
      await report({ status: "messages_checked", handles: ["+14155550134"] });
      expect((await lookup()).lookup.messagesError).toBe(false);
      await prisma.datingPerson.update({
        where: { id: personId },
        data: { handles: ["+14155550999"] },
      });
      expect((await lookup()).lookup.messagesCheckedAt).toBeNull();
      await expect(
        report({ status: "messages_checked", handles: ["+14155550134"] }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it.each(["not_found", "unavailable", "insufficient_name"])(
      "reports %s and retries without changing profile",
      async (status) => {
        await report({ status, candidates: [] });
        expect((await lookup()).lookup.status).toBe(status);
        await actOnContactLookup(userId, personId, { action: "retry" });
        expect((await lookup()).lookup.status).toBe("pending");
        expect(await person()).toMatchObject({
          name,
          handles: [],
          notes: "Keep my notes",
        });
      },
    );
    it("returns to pending when a previously matched phone is removed", async () => {
      await report({ handles: ["+14155550134"] });
      await prisma.datingPerson.update({
        where: { id: personId },
        data: { handles: [] },
      });
      expect((await lookup()).lookup).toMatchObject({
        status: "pending",
        messagesCheckedAt: null,
        messagesError: false,
      });
    });
    it("merges simultaneous reports for separate people without losing either choice", async () => {
      const second = await prisma.datingPerson.create({
        data: { userId, name: "Bea Martin" },
      });
      await Promise.all([
        report(),
        report({ personId: second.id, name: second.name }),
      ]);
      expect((await lookup()).lookup.status).toBe("ambiguous");
      expect((await getContactLookup(userId, second.id)).lookup.status).toBe(
        "ambiguous",
      );
    });
    it("persists explicit message retries, scopes them to the owner, and clears them on completion", async () => {
      await report({ handles: ["+14155550134"] });
      await report({ status: "messages_checked", handles: ["+14155550134"] });
      await actOnContactLookup(userId, personId, { action: "retry" });
      expect((await lookup()).lookup).toMatchObject({
        status: "matched",
        messagesCheckedAt: null,
        messagesError: false,
      });
      const capture = () =>
        new Request("http://localhost/api/capture/dating/contacts", {
          headers: { authorization: "Bearer contact-lookup-scratch" },
        });
      const foreign = await prisma.datingPerson.create({
        data: {
          userId: otherId,
          name: "Foreign Contact",
          handles: ["+14155550888"],
        },
      });
      await actOnContactLookup(otherId, foreign.id, { action: "retry" });
      const expected = [{ id: personId, name, handles: ["+14155550134"] }];
      expect(
        (await (await captureGet(capture())).json()).messageRetries,
      ).toEqual(expected);
      expect(
        (await (await captureGet(capture())).json()).messageRetries,
      ).toEqual(expected);
      await report({ status: "messages_checked", handles: ["+14155550134"] });
      expect(
        (await (await captureGet(capture())).json()).messageRetries ?? [],
      ).toEqual([]);
      expect((await lookup()).lookup.messagesCheckedAt).toEqual(
        expect.any(String),
      );
      await actOnContactLookup(userId, personId, { action: "retry" });
      await prisma.datingPerson.update({
        where: { id: personId },
        data: { handles: ["+14155550999"] },
      });
      expect(
        (await (await captureGet(capture())).json()).messageRetries ?? [],
      ).toEqual([]);
    });
    it("bounds candidate data and choices", async () => {
      for (const extra of [
        { candidates: Array(6).fill(candidates[0]) },
        { candidates: [{ name: "x", phones: ["invalid"], emails: [] }] },
        { status: "not_found" },
        {
          candidates: [
            { name: "x", phones: Array(21).fill("+14155550134"), emails: [] },
          ],
        },
      ])
        await expect(report(extra)).rejects.toMatchObject({ status: 400 });
      await report();
      await expect(choose(5)).rejects.toMatchObject({ status: 400 });
    });
    it("enforces both capture and owner-route authentication and cross-account ownership", async () => {
      const context = { params: Promise.resolve({ id: personId }) };
      const request = () =>
        new Request("http://localhost/api/dating/person/contact-lookup");
      session.userId = null;
      expect((await GET(request(), context)).status).toBe(401);
      expect((await POST(request(), context)).status).toBe(401);
      expect((await captureGet(request())).status).toBe(401);
      expect((await capturePost(request())).status).toBe(401);
      session.userId = otherId;
      expect((await GET(request(), context)).status).toBe(404);
      expect(
        (
          await POST(
            new Request(request(), {
              method: "POST",
              body: JSON.stringify({ action: "retry" }),
            }),
            context,
          )
        ).status,
      ).toBe(404);
      await expect(
        recordContactLookup(otherId, {
          personId,
          name,
          handles: ["+14155550134"],
        }),
      ).rejects.toMatchObject({ status: 404 });
      const capture = new Request(
        "http://localhost/api/capture/dating/contacts",
        { headers: { authorization: "Bearer contact-lookup-scratch" } },
      );
      expect(await (await captureGet(capture)).json()).toEqual({
        people: [{ id: personId, name }],
      });
      expect(
        await (
          await capturePost(
            new Request(capture, {
              method: "POST",
              body: JSON.stringify({
                personId,
                name,
                handles: ["+14155550134"],
              }),
            }),
          )
        ).json(),
      ).toEqual({ resolved: true });
    });
  },
);
