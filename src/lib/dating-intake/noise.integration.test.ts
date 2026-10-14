import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const owner = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: async () => owner.id }));
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/capture/dating/discovery/route";
import { hash, type Envelope } from "./contracts";
import { acceptRecord } from "./store";
import { processSource } from "./extract";
import { listReview, publishMentions, reviewCandidate } from "./review";
import { discoveryEnvelopes, type DiscoveryMessage, type DiscoveryThread } from "./message-discovery";

const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (url.hostname !== "127.0.0.1" || url.port !== "55442" || url.pathname !== "/dating_intake") throw new Error("Scratch database required");
}

// Synthetic people only.
const handle = "+15555550142";
const thread: DiscoveryThread = { id: "chat-1", source: "imessage", handle, oneToOne: true };
const line = (n: number, text: string, fromMe = n % 2 === 0): DiscoveryMessage => ({
  position: { date: String(n), id: n }, guid: `m${n}`, sentAt: `2026-09-2${n}T20:00:00.000Z`, fromMe, text,
});
const lines = [
  line(1, "Hey, it was great meeting you at the climbing gym"),
  line(2, "Same! Would you like to get dinner with me Friday?"),
  line(3, "Yes, I would love a dinner date with you on Friday"),
  line(4, "Did you hear that Jordan started dating someone from work?"),
  line(5, "Ha, yes. Anyway I had a lovely time on our date last night"),
  line(6, "Me too, let's plan a second date next weekend"),
];
const quoteOf = (n: number) => lines[n - 1].text;
/** Mock model: the correspondent wherever their date lines appear, plus a discussed third person. */
const extract = async (e: Envelope) => ({
  mentions: [3, 5, 6].filter((n) => e.text.includes(quoteOf(n))).map((n) => ({
    name: handle, summary: "Dating the person in this thread", quote: quoteOf(n), eventDate: null, correspondent: true,
  })).concat(e.text.includes(quoteOf(4)) ? [{
    name: "Jordan", summary: "Jordan is dating someone", quote: quoteOf(4), eventDate: null, correspondent: false,
  }] : []),
});
const chunk = (messages: DiscoveryMessage[], sequence: number) => discoveryEnvelopes(thread, messages, sequence, 1)[0];
const pendingSuggestions = (userId: string) => prisma.datingSuggestion.findMany({ where: { userId, status: "pending" } });
const request = (body?: unknown) => new Request("https://example.invalid/api/capture/dating/discovery", body ? { method: "POST", body: JSON.stringify(body) } : {});

describe.skipIf(!enabled)("fewer, durable review suggestions", () => {
  let userId: string;
  let stateId: string;
  beforeEach(async () => {
    userId = randomUUID();
    owner.id = userId;
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.invalid` } });
  });
  afterEach(async () => { await prisma.user.deleteMany({ where: { id: userId } }); });
  afterAll(() => prisma.$disconnect());

  describe("texts", () => {
    beforeEach(async () => {
      stateId = (await prisma.datingSourceState.create({ data: { userId, source: "texts", scope: "default", enabled: true } })).id;
    });

    it("never suggests a third person discussed in a one-to-one thread", async () => {
      // Only the line about someone else: nothing about the correspondent.
      await acceptRecord(userId, stateId, chunk([lines[3]], 1));
      await processSource(userId, stateId, { extract });
      expect(await prisma.datingCandidate.count({ where: { userId } })).toBe(0);
      expect(await prisma.datingSuggestion.count({ where: { userId } })).toBe(0);
      // Already-stored extractions from before this rule are filtered at publish too.
      const record = await prisma.datingSourceRecord.findFirstOrThrow({ where: { userId, stateId } });
      await prisma.$transaction((tx) => publishMentions(tx, record, [{
        name: "Jordan", summary: "Jordan is dating someone", quote: quoteOf(4), eventDate: null, correspondent: false,
      }], [handle]));
      expect(await prisma.datingCandidate.count({ where: { userId } })).toBe(0);
    });

    it("keeps a dismissed correspondent dismissed and stops reading their thread", async () => {
      await acceptRecord(userId, stateId, chunk(lines.slice(0, 3), 1));
      await processSource(userId, stateId, { extract });
      const [candidate] = (await listReview(userId)).candidates;
      expect(candidate.identities).toEqual([handle]);
      // The next page was already uploaded (next sequence, new revision) when the owner dismissed.
      const next = chunk(lines.slice(1, 6), 2);
      expect(next.revision).not.toBe(chunk(lines.slice(0, 3), 1).revision);
      await acceptRecord(userId, stateId, next);
      await reviewCandidate(userId, candidate.id, { action: "dismiss", fingerprint: candidate.fingerprint });
      await processSource(userId, stateId, { extract });
      expect(await pendingSuggestions(userId)).toHaveLength(0);
      expect((await listReview(userId)).candidates).toHaveLength(0);
      expect((await prisma.datingCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("dismissed");
      // Discovery now skips the thread, and a stale worker's upload is refused.
      const config = await (await GET(request())).json();
      expect(config.excludedHandles).toContain(handle);
      const later = chunk(lines.slice(3, 6), 3);
      expect((await POST(request({ action: "record", envelope: later }))).status).toBe(409);
      await expect(acceptRecord(userId, stateId, later)).rejects.toMatchObject({ status: 409 });
    });

    it("does not duplicate evidence re-sent in the overlap of the next page", async () => {
      await acceptRecord(userId, stateId, chunk(lines.slice(0, 3), 1));
      await processSource(userId, stateId, { extract });
      // The worker re-sends the last three messages before the new ones.
      await acceptRecord(userId, stateId, chunk(lines.slice(0, 6), 2));
      await processSource(userId, stateId, { extract });
      const notes = (await pendingSuggestions(userId)).map((s) => s.note).sort();
      expect(notes).toEqual([quoteOf(3), quoteOf(5), quoteOf(6)].sort());
      expect((await listReview(userId)).candidates).toHaveLength(1);
    });
  });

  describe("journal", () => {
    const doc = (externalId: string, text: string, documentVersion = 1): Envelope => ({
      version: 1, externalId, revision: hash(text), documentVersion, segmentIndex: 0, segmentCount: 1,
      text, title: "Journal", occurredAt: null, url: null, identities: [], evidenceFamily: null,
    });
    const journalExtract = async (e: Envelope) => ({
      mentions: [...e.text.matchAll(/(?:date with|dinner with) ([A-ZÀ-Ý][\p{L}]+(?:\s+[A-ZÀ-Ý][\p{L}]+)?)/gu)].map((match) => ({
        name: match[1], summary: `Date with ${match[1]}`, quote: e.text, eventDate: null, correspondent: false,
      })),
    });
    const upload = async (externalId: string, text: string, version = 1) => {
      await acceptRecord(userId, stateId, doc(externalId, text, version));
      await processSource(userId, stateId, { extract: journalExtract });
    };
    beforeEach(async () => {
      stateId = (await prisma.datingSourceState.create({ data: { userId, source: "ecpad", enabled: true } })).id;
    });

    it("skips a name already dismissed but still attaches evidence for an approved person", async () => {
      await upload("monday", "Went on a date with Zoë Ríos and it felt flat.");
      const [dismissed] = (await listReview(userId)).candidates;
      await reviewCandidate(userId, dismissed.id, { action: "dismiss", fingerprint: dismissed.fingerprint });
      // Another entry, another spelling of the same name.
      await upload("tuesday", "Thinking about that date with Zoe  Rios again today.");
      expect((await listReview(userId)).candidates).toHaveLength(0);
      expect(await pendingSuggestions(userId)).toHaveLength(0);

      // An approved person keeps receiving evidence even when a namesake was dismissed.
      await upload("saturday", "Had a dinner with Robin at the market.");
      const robin = (await listReview(userId)).candidates.find((c) => c.name === "Robin")!;
      const { personId } = await reviewCandidate(userId, robin.id, { action: "add", fingerprint: robin.fingerprint, draft: { name: "Robin" } });
      await prisma.datingCandidate.create({ data: { userId, identityKey: "source:another-robin", name: "Robin", status: "dismissed" } });
      await upload("saturday", "Had a dinner with Robin at the market. We booked a second date.", 2);
      const attached = await prisma.datingSuggestion.findMany({ where: { userId, personId, sourceRecord: { documentVersion: 2 } } });
      expect(attached.map((s) => s.status)).toEqual(["added"]);
      // A new, unlinked entry about a dismissed name stays quiet.
      await upload("sunday", "Another dinner with Robin is on the calendar.");
      expect(await pendingSuggestions(userId)).toHaveLength(0);
    });
  });
});
