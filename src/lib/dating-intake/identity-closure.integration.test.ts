import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { fingerprint, listReview, resolveIdentity, reviewCandidate } from "./review";
import { acceptRecord, lockOwner } from "./store";
import { hash } from "./contracts";
import { processSource } from "./extract";

const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (url.hostname !== "127.0.0.1" || url.port !== "55442" || url.pathname !== "/dating_intake") throw new Error("Scratch database required");
}

describe.skipIf(!enabled)("transitive verified identity resolution", () => {
  let userId: string;
  let other: string;
  const a = "+15555550101";
  const b = "robin@example.invalid";
  const c = "+15555550103";
  beforeEach(async () => {
    userId = randomUUID(); other = randomUUID();
    await prisma.user.createMany({ data: [userId, other].map((id) => ({ id, email: `${id}@example.invalid` })) });
  });
  afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, other] } } }); });
  afterAll(() => prisma.$disconnect());
  const resolve = (aliases: string[]) => prisma.$transaction(async (tx) => { await lockOwner(tx, userId); return resolveIdentity(tx, userId, aliases); });

  it("excludes and restores all A[a,b]/B[b,c]/C[c] candidates from either end", async () => {
    const rows = [];
    for (const [name, identities] of [["A", [a, b]], ["B", [b, c]], ["C", [c]]] as const) {
      rows.push(await prisma.datingCandidate.create({ data: { userId, identityKey: `source:${name}`, name, identities: [...identities], reviewedFingerprint: JSON.stringify({ dismissed: [`prior-${name}`] }) } }));
    }
    const foreign = await prisma.datingCandidate.create({ data: { userId: other, identityKey: "source:other", name: "Other owner", identities: [a, b, c] } });
    const empty = fingerprint([]);
    await reviewCandidate(userId, rows[2].id, { action: "exclude", fingerprint: empty });
    expect((await prisma.datingCandidate.findMany({ where: { userId } })).every((row) => row.status === "excluded")).toBe(true);
    for (const row of await prisma.datingCandidate.findMany({ where: { userId } })) {
      expect(JSON.parse(row.reviewedFingerprint!).dismissed).toEqual(expect.arrayContaining(["prior-A", "prior-B", "prior-C"]));
    }
    const fromA = await resolve([a]);
    expect(fromA.excluded).toBe(true);
    expect(new Set(fromA.matches.map((row) => row.id))).toEqual(new Set(rows.map((row) => row.id)));
    await reviewCandidate(userId, rows[0].id, { action: "restore", fingerprint: empty });
    // Restored people can be suggested again; a dismissal would be final.
    expect((await prisma.datingCandidate.findMany({ where: { userId } })).every((row) => row.status === "pending")).toBe(true);
    expect((await prisma.datingCandidate.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("pending");
  });

  it("follows profile handle aliases and detects conflicting profiles at the far end", async () => {
    const first = await prisma.datingPerson.create({ data: { userId, name: "First", handles: [a, b] } });
    await prisma.datingCandidate.create({ data: { userId, identityKey: "source:bridge", name: "Bridge", identities: [b, c], status: "excluded" } });
    const result = await resolve([a]);
    expect(result.personId).toBe(first.id); expect(result.excluded).toBe(true);
    await prisma.datingPerson.create({ data: { userId, name: "Second", handles: [c] } });
    await expect(resolve([a])).rejects.toMatchObject({ status: 409 });
  });

  it("retains approved source keys and leaves overlapping unreviewed evidence visible", async () => {
    const state = await prisma.datingSourceState.create({ data: { userId, source: "granola", enabled: true } });
    const upload = async (externalId: string, identities: string[] = [], documentVersion = 1) => {
      const text = `I went on a date with Robin. ${externalId} revision ${documentVersion}.`;
      await acceptRecord(userId, state.id, { version: 1, externalId, revision: hash(text), documentVersion, segmentIndex: 0, segmentCount: 1, text, title: externalId, occurredAt: null, url: null, identities, evidenceFamily: null });
    };
    const process = () => processSource(userId, state.id, { extract: async (record) => ({ mentions: [{ name: "Robin", summary: "Date with Robin", quote: record.text, eventDate: null, correspondent: true }] }) });
    await upload("journal-one"); await upload("journal-two"); await upload("contact", [a]);
    await process();
    const initial = (await listReview(userId)).candidates;
    const journals = initial.filter((row) => row.evidence[0].title?.startsWith("journal"));
    const pending = initial.find((row) => row.evidence[0].title === "contact")!;
    for (const journal of journals) await reviewCandidate(userId, journal.id, { action: "add", fingerprint: journal.fingerprint, draft: { name: "Robin", handles: [a] } });
    expect(await prisma.datingPerson.count({ where: { userId } })).toBe(1);
    const before = await prisma.datingCandidate.findMany({ where: { userId, id: { in: journals.map((row) => row.id) } } });
    await upload("new-contact", [a]); await process();
    const retained = await prisma.datingCandidate.findMany({ where: { userId, identityKey: { in: before.map((row) => row.identityKey) } } });
    expect(retained).toHaveLength(2);
    expect((await listReview(userId)).candidates.map((row) => row.id)).toEqual([pending.id]);
    expect((await listReview(userId)).candidates[0].evidence.map((row) => row.id)).toEqual(pending.evidence.map((row) => row.id));
    await upload("journal-one", [], 2); await upload("journal-two", [], 2); await process();
    expect((await listReview(userId)).candidates.map((row) => row.id)).toEqual([pending.id]);
    for (const externalId of ["journal-one", "journal-two"]) {
      const evidence = await prisma.datingSuggestion.findFirstOrThrow({ where: { userId, sourceRecord: { externalId, documentVersion: 2 } } });
      expect(evidence.status).toBe("added"); expect(evidence.personId).toBe(before[0].personId);
    }
  });

  it("does not connect same-name source-only candidates without a verified alias", async () => {
    await prisma.datingCandidate.createMany({ data: ["one", "two"].map((key) => ({ userId, identityKey: `source:${key}`, name: "Robin", status: key === "one" ? "excluded" : "pending" })) });
    const result = await prisma.$transaction((tx) => resolveIdentity(tx, userId, [], "source:two"));
    expect(result.matches).toHaveLength(1); expect(result.excluded).toBe(false);
    expect(result.matches[0].identityKey).toBe("source:two");
  });
});
