import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { acceptRecord, acceptManifest } from "./store";
import { hash } from "./contracts";
import { processSource, validateExtraction } from "./extract";
import { listReview, reviewCandidate } from "./review";
import { claimPairing, createPairing, connector } from "./auth";
const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const u = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55442" ||
    u.pathname !== "/dating_intake"
  )
    throw new Error("Scratch database required");
}
describe.skipIf(!enabled)(
  "source review races and evidence preservation",
  () => {
    let userId: string, other: string, stateId: string;
    const text =
      "I went on a date with Robin on 2026-09-01 and want to see her again.";
    const env = (id = "n", identities: string[] = []) => ({
      version: 1 as const,
      externalId: id,
      revision: hash(text),
      documentVersion: 1,
      segmentIndex: 0,
      segmentCount: 1,
      text,
      title: "Robin",
      occurredAt: null,
      url: null,
      identities,
      evidenceFamily: null,
    });
    const extract = async () => ({
      mentions: [
        {
          name: "Robin",
          summary: "Wants another date with Robin",
          quote: text,
          eventDate: null,
          correspondent: true,
        },
      ],
    });
    beforeEach(async () => {
      userId = randomUUID();
      other = randomUUID();
      await prisma.user.createMany({
        data: [userId, other].map((id) => ({
          id,
          email: `${id}@example.invalid`,
        })),
      });
      stateId = (
        await prisma.datingSourceState.create({
          data: { userId, source: "texts", enabled: true },
        })
      ).id;
    });
    afterEach(async () => {
      await prisma.user.deleteMany({ where: { id: { in: [userId, other] } } });
    });
    afterAll(() => prisma.$disconnect());
    it("handles bounded work across runs, exact quotes and undated approval", async () => {
      for (let i = 0; i < 3; i++)
        await acceptRecord(userId, stateId, env(`n${i}`));
      expect(
        (await processSource(userId, stateId, { maxCalls: 1, extract }))
          .backlog,
      ).toBe(2);
      expect((await processSource(userId, stateId, { extract })).backlog).toBe(
        0,
      );
      const { candidates } = await listReview(userId);
      expect(candidates).toHaveLength(3);
      const c = candidates[0];
      expect(c.evidence[0].occurredAt).toBeNull();
      await expect(
        reviewCandidate(other, c.id, {
          action: "add",
          fingerprint: c.fingerprint,
        }),
      ).rejects.toMatchObject({ status: 404 });
      const result = await reviewCandidate(userId, c.id, {
        action: "add",
        fingerprint: c.fingerprint,
        draft: { name: "Robin", stage: "talking" },
      });
      const p = await prisma.datingPerson.findUniqueOrThrow({
        where: { id: result.personId! },
      });
      expect(p.metAt).toBeNull();
      expect(await prisma.datingEvent.count({ where: { userId } })).toBe(0);
      expect(
        await prisma.datingSourceRecord.count({
          where: { userId, status: "processed" },
        }),
      ).toBe(3);
    });
    it("never creates duplicate profiles for overlapping verified aliases", async () => {
      await acceptRecord(userId, stateId, env("one", ["+15555550101"]));
      await acceptRecord(
        userId,
        stateId,
        env("two", ["+15555550101", "robin@example.invalid"]),
      );
      await processSource(userId, stateId, { extract });
      const list = await listReview(userId);
      expect(list.candidates).toHaveLength(1);
      const c = list.candidates[0];
      await Promise.allSettled(
        [1, 2].map(() =>
          reviewCandidate(userId, c.id, {
            action: "add",
            fingerprint: c.fingerprint,
            draft: { name: "Robin" },
          }),
        ),
      );
      expect(await prisma.datingPerson.count({ where: { userId } })).toBe(1);
    });
    it("keeps exclusions across new mentions and restores explicitly", async () => {
      await acceptRecord(userId, stateId, env("one", ["+15555550101"]));
      await processSource(userId, stateId, { extract });
      const c = (await listReview(userId)).candidates[0];
      await reviewCandidate(userId, c.id, {
        action: "exclude",
        fingerprint: c.fingerprint,
      });
      await expect(
        acceptRecord(userId, stateId, env("two", ["+15555550101"])),
      ).rejects.toMatchObject({ status: 409 });
      expect((await listReview(userId)).candidates).toHaveLength(0);
      const x = (await listReview(userId)).excluded[0];
      await reviewCandidate(userId, x.id, {
        action: "restore",
        fingerprint: x.fingerprint,
      });
      expect((await listReview(userId)).excluded).toHaveLength(0);
    });
    it("preserves manually edited imported events when sources are withdrawn and clears stale insights", async () => {
      await acceptRecord(userId, stateId, env());
      await processSource(userId, stateId, {
        extract: async () => ({
          mentions: [
            {
              name: "Robin",
              summary: "Date with Robin",
              quote: text,
              eventDate: "2026-09-01",
              correspondent: false,
            },
          ],
        }),
      });
      const c = (await listReview(userId)).candidates[0];
      const result = await reviewCandidate(userId, c.id, {
        action: "add",
        fingerprint: c.fingerprint,
        draft: { name: "Robin" },
      });
      const event = await prisma.datingEvent.findFirstOrThrow({
        where: { userId },
      });
      await prisma.datingEvent.update({
        where: { id: event.id },
        data: { notes: "My edited reflection" },
      });
      await prisma.datingPerson.update({
        where: { id: result.personId! },
        data: {
          notes: "My own notes",
          stage: "dating",
          insights: { summary: "stale quote" },
          insightsAt: new Date(),
        },
      });
      await acceptManifest(userId, stateId, {
        version: 1,
        generation: 1,
        complete: true,
        documents: [],
        unavailableIds: [],
      });
      const p = await prisma.datingPerson.findUniqueOrThrow({
        where: { id: result.personId! },
      });
      expect(p.notes).toBe("My own notes");
      expect(p.stage).toBe("dating");
      expect(p.insights).toBeNull();
      expect(
        (
          await prisma.datingEvent.findUniqueOrThrow({
            where: { id: event.id },
          })
        ).notes,
      ).toBe("My edited reflection");
    });
    it("rejects fabricated quotes and recovers provider failures without advancing success", async () => {
      expect(() =>
        validateExtraction(
          {
            mentions: [
              {
                name: "Robin",
                summary: "Date",
                quote: "This is not in source",
                eventDate: null,
              },
            ],
          },
          env(),
        ),
      ).toThrow();
      await acceptRecord(userId, stateId, env());
      await processSource(userId, stateId, {
        extract: async () => {
          throw Error("provider");
        },
      });
      const state = await prisma.datingSourceState.findUniqueOrThrow({
        where: { id: stateId },
      });
      expect(state.lastSuccessAt).toBeNull();
      expect(state.status).toBe("needs_attention");
    });
    it("claims pairing only once and revokes the previous device token", async () => {
      const pair = await createPairing(userId);
      const outcomes = await Promise.allSettled(
        [1, 2].map(() => claimPairing(pair.code, "library-uuid-test")),
      );
      expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const one = outcomes.find((x) => x.status === "fulfilled")!;
      if (one.status !== "fulfilled") throw Error();
      const req = (token: string) =>
        new Request("https://example.invalid", {
          headers: { Authorization: `Bearer ${token}` },
        });
      expect((await connector(req(one.value.token))).userId).toBe(userId);
      const next = await createPairing(userId);
      await claimPairing(next.code, "library-uuid-test");
      await expect(connector(req(one.value.token))).rejects.toMatchObject({
        status: 401,
      });
    });
  },
);
