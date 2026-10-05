import { Prisma, type DatingSourceState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  envelope,
  hash,
  IntakeError,
  integer,
  object,
  string,
  type Envelope,
} from "./contracts";

export type Tx = Prisma.TransactionClient;
export const json = (v: unknown) => v as Prisma.InputJsonValue;
export async function lockOwner(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dating-intake:${userId}`}, 0))`;
}
export async function ownedState(tx: Tx, userId: string, id: string) {
  const state = await tx.datingSourceState.findFirst({ where: { id, userId } });
  if (!state) throw new IntakeError("Source not found", 404);
  return state;
}
export function eventHash(e: {
  title: string;
  notes: string | null;
  occurredAt: Date;
  kind: string;
  vibe: number | null;
}) {
  return hash(
    JSON.stringify([
      e.title,
      e.notes,
      e.occurredAt.toISOString(),
      e.kind,
      e.vibe,
    ]),
  );
}
/** Call under the owner lock. Source removal clears derived caches, never manual edits. */
export async function invalidate(
  tx: Tx,
  userId: string,
  ids: string[],
  status = "superseded",
) {
  if (!ids.length) return;
  const events = await tx.datingEvent.findMany({
    where: { userId, sourceRecordId: { in: ids } },
  });
  const suggestions = await tx.datingSuggestion.findMany({
    where: { userId, sourceRecordId: { in: ids } },
    select: { personId: true },
  });
  const people = [
    ...new Set([
      ...events.map((e) => e.personId),
      ...suggestions.flatMap((s) => (s.personId ? [s.personId] : [])),
    ]),
  ];
  for (const event of events) {
    if (
      event.machineContentHash &&
      event.machineContentHash === eventHash(event)
    )
      await tx.datingEvent.delete({ where: { id: event.id } });
    else
      await tx.datingEvent.update({
        where: { id: event.id },
        data: { machineContentHash: "conflict" },
      });
  }
  await tx.datingSuggestion.deleteMany({
    where: { userId, sourceRecordId: { in: ids } },
  });
  if (people.length)
    await tx.datingPerson.updateMany({
      where: { userId, id: { in: people } },
      data: { insights: Prisma.DbNull, insightsAt: null },
    });
  await tx.datingSourceRecord.updateMany({
    where: { userId, id: { in: ids } },
    data: {
      status,
      payload: Prisma.DbNull,
      extraction: Prisma.DbNull,
      leaseUntil: null,
      version: { increment: 1 },
    },
  });
}
export async function updateHealth(tx: Tx, userId: string, stateId: string) {
  const state = await ownedState(tx, userId, stateId);
  const recordBacklog = await tx.datingSourceRecord.count({
    where: {
      userId,
      stateId,
      status: {
        in: [
          "receiving",
          "pending",
          "processing",
          "extracted",
          "retry",
          "expired",
        ],
      },
    },
  });
  const needsAttention = await tx.datingSourceRecord.count({
    where: { userId, stateId, status: { in: ["retry", "expired"] } },
  });
  const manifest = object(state.manifest);
  const cursor = object(state.cursor);
  const adapterBacklog =
    typeof cursor.adapterBacklog === "number"
      ? Math.max(0, cursor.adapterBacklog)
      : 0;
  const backlog = recordBacklog + adapterBacklog;
  const adapterError =
    typeof cursor.adapterError === "string" ? cursor.adapterError : null;
  const scanComplete = manifest.complete === true;
  await tx.datingSourceState.update({
    where: { id: stateId },
    data: {
      backlog,
      status: !state.enabled
        ? "paused"
        : needsAttention || adapterError
          ? "needs_attention"
          : backlog || !scanComplete
            ? "backlog"
            : "up_to_date",
      // A failure message lasts only while a record still needs attention: once
      // retries succeed it clears, even if a large backlog is still draining.
      ...(adapterError
        ? { error: adapterError }
        : !needsAttention
          ? { error: null }
          : {}),
      ...(!backlog && scanComplete && state.enabled && !adapterError
        ? { lastSuccessAt: state.lastAttemptAt }
        : {}),
    },
  });
}
export async function acceptRecord(
  userId: string,
  stateId: string,
  input: unknown,
  credentialHash?: string,
) {
  const e = envelope(input);
  return prisma.$transaction(
    async (tx) => {
      await lockOwner(tx, userId);
      const state = await ownedState(tx, userId, stateId);
      if (credentialHash && state.tokenHash !== credentialHash)
        throw new IntakeError("Unauthorized", 401);
      if (!state.enabled) throw new IntakeError("Source paused", 409);
      if (state.source === "texts" && e.identities.length) {
        const excluded = await tx.datingCandidate.findMany({
          where: { userId, status: "excluded" },
          select: { identities: true },
        });
        const approved = await tx.datingPerson.count({
          where: { userId, handles: { hasSome: e.identities } },
        });
        if (
          approved ||
          excluded.some(
            (c) =>
              Array.isArray(c.identities) &&
              c.identities.some(
                (i) => typeof i === "string" && e.identities.includes(i),
              ),
          )
        )
          throw new IntakeError(
            "This conversation is already linked or excluded",
            409,
          );
      }
      if (state.source === "ecpad" && e.identities.length)
        throw new IntakeError(
          "Journal documents cannot assert verified contact identities",
        );
      // Granola copies stay on the direct adapter, never count twice through journals.
      if (state.source === "ecpad" && e.evidenceFamily?.startsWith("granola:"))
        throw new IntakeError("Connected Granola notes use the Granola source");
      const records = await tx.datingSourceRecord.findMany({
        where: { userId, stateId, externalId: e.externalId },
        orderBy: { documentVersion: "desc" },
      });
      const latest = records[0];
      if (
        latest &&
        (latest.documentVersion > e.documentVersion ||
          (latest.documentVersion === e.documentVersion &&
            latest.revision !== e.revision))
      )
        throw new IntakeError(
          "Newer source version exists; refresh before retrying",
          409,
        );
      if (latest && e.documentVersion > latest.documentVersion)
        await invalidate(
          tx,
          userId,
          records
            .filter((r) => !["superseded", "withdrawn"].includes(r.status))
            .map((r) => r.id),
        );
      const same = records.filter((r) => r.revision === e.revision);
      // Reusing content after edits is a new logical revision; stable hash unique includes index, so keep its version current only after invalidation.
      if (same.some((r) => r.documentVersion !== e.documentVersion)) {
        if (same.some((r) => r.segmentCount !== e.segmentCount))
          throw new IntakeError(
            "Reused content must keep its segmentation",
            409,
          );
        await tx.datingSourceRecord.updateMany({
          where: { userId, id: { in: same.map((r) => r.id) } },
          data: {
            documentVersion: e.documentVersion,
            status: "receiving",
            payload: Prisma.DbNull,
            extraction: Prisma.DbNull,
            createdAt: new Date(),
            title: e.title,
            url: e.url,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
            evidenceFamily: e.evidenceFamily,
            version: { increment: 1 },
          },
        });
      }
      const siblings = await tx.datingSourceRecord.findMany({
        where: {
          userId,
          stateId,
          externalId: e.externalId,
          revision: e.revision,
          documentVersion: e.documentVersion,
        },
      });
      const prior = siblings.find((r) => r.segmentIndex === e.segmentIndex);
      const meta = (p: Envelope) =>
        JSON.stringify([
          p.title,
          p.occurredAt,
          p.url,
          p.identities,
          p.evidenceFamily,
          p.segmentCount,
        ]);
      for (const sibling of siblings) {
        const payload = sibling.payload as Envelope | null;
        if (payload && meta(payload) !== meta(e))
          throw new IntakeError("Revision metadata changed", 409);
      }
      if (prior) {
        if (["withdrawn", "superseded"].includes(prior.status))
          throw new IntakeError("Source withdrawn; send a newer version", 409);
        const stored = prior.payload as Envelope | null;
        if (stored && (meta(stored) !== meta(e) || stored.text !== e.text))
          throw new IntakeError("Accepted segment cannot change", 409);
        if (
          prior.status === "expired" ||
          (prior.status === "receiving" && !prior.payload)
        )
          await tx.datingSourceRecord.update({
            where: { id: prior.id },
            data: {
              payload: json(e),
              status: "receiving",
              attempts: 0,
              retryAt: null,
              createdAt: new Date(),
            },
          });
      } else
        await tx.datingSourceRecord.create({
          data: {
            userId,
            stateId,
            source: state.source,
            externalId: e.externalId,
            revision: e.revision,
            documentVersion: e.documentVersion,
            segmentIndex: e.segmentIndex,
            segmentCount: e.segmentCount,
            title: e.title,
            url: e.url,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
            evidenceFamily: e.evidenceFamily,
            payload: json(e),
          },
        });
      const all = await tx.datingSourceRecord.findMany({
        where: {
          userId,
          stateId,
          externalId: e.externalId,
          revision: e.revision,
          documentVersion: e.documentVersion,
        },
        orderBy: { segmentIndex: "asc" },
      });
      const complete =
        all.length === e.segmentCount &&
        all.every(
          (r) =>
            r.status !== "expired" && (r.status !== "receiving" || !!r.payload),
        );
      if (complete && all.some((r) => r.status === "receiving")) {
        if (all.some((r) => !r.payload))
          throw new IntakeError("Resubmit all expired segments", 409);
        if (
          hash(all.map((r) => (r.payload as Envelope).text).join("")) !==
          e.revision
        )
          throw new IntakeError(
            "Source hash does not match assembled text",
            409,
          );
        await tx.datingSourceRecord.updateMany({
          where: {
            userId,
            id: { in: all.map((r) => r.id) },
            status: "receiving",
          },
          data: { status: "pending" },
        });
      }
      await tx.datingSourceState.update({
        where: { id: stateId },
        data: {
          lastAttemptAt: new Date(),
          ...(!prior ? { lastNewDataAt: new Date() } : {}),
          manifest: json({ ...object(state.manifest), complete: false }),
        },
      });
      await updateHealth(tx, userId, stateId);
      return {
        accepted: true,
        externalId: e.externalId,
        revision: e.revision,
        segmentIndex: e.segmentIndex,
        documentVersion: e.documentVersion,
        complete,
      };
    },
    { timeout: 15000 },
  );
}
export async function acceptManifest(
  userId: string,
  stateId: string,
  input: unknown,
  credentialHash?: string,
) {
  const o = object(input);
  if (
    o.version !== 1 ||
    typeof o.complete !== "boolean" ||
    !Array.isArray(o.documents) ||
    o.documents.length > 10000 ||
    !Array.isArray(o.unavailableIds) ||
    o.unavailableIds.length > 10000
  )
    throw new IntakeError("Invalid manifest");
  const generation = integer(o.generation, 1, 2147483647);
  const docs = o.documents.map((v) => {
    const d = object(v);
    return {
      externalId: string(d.externalId, 200),
      documentVersion: integer(d.documentVersion, 1, 2147483647),
      revision: string(d.revision, 64),
    };
  });
  if (new Set(docs.map((d) => d.externalId)).size !== docs.length)
    throw new IntakeError("Duplicate document in manifest");
  const unavailable = o.unavailableIds.map((v) => string(v, 200));
  const fingerprint = hash(
    JSON.stringify({
      generation,
      complete: o.complete,
      documents: [...docs].sort((a, b) =>
        a.externalId.localeCompare(b.externalId),
      ),
      unavailable: [...unavailable].sort(),
    }),
  );
  return prisma.$transaction(
    async (tx) => {
      await lockOwner(tx, userId);
      const state = await ownedState(tx, userId, stateId);
      if (credentialHash && state.tokenHash !== credentialHash)
        throw new IntakeError("Unauthorized", 401);
      if (!state.enabled) throw new IntakeError("Source paused", 409);
      const previous = object(state.manifest);
      if (
        generation < state.manifestVersion ||
        (generation === state.manifestVersion &&
          previous.fingerprint !== fingerprint)
      )
        throw new IntakeError("Manifest changed; use a newer generation", 409);
      const records = await tx.datingSourceRecord.findMany({
        where: {
          userId,
          stateId,
          status: { notIn: ["superseded", "withdrawn"] },
        },
      });
      for (const doc of docs) {
        const matching = records.filter(
          (r) =>
            r.externalId === doc.externalId &&
            r.documentVersion === doc.documentVersion &&
            r.revision === doc.revision,
        );
        if (
          !matching.length ||
          matching.length !== matching[0].segmentCount ||
          matching.some(
            (r) => r.status === "receiving" || r.status === "expired",
          )
        )
          throw new IntakeError("Upload all manifest documents first", 409);
      }
      if (o.complete) {
        const keep = new Set([
          ...docs.map((d) => d.externalId),
          ...unavailable,
        ]);
        await invalidate(
          tx,
          userId,
          records.filter((r) => !keep.has(r.externalId)).map((r) => r.id),
          "withdrawn",
        );
      }
      await tx.datingSourceState.update({
        where: { id: stateId },
        data: {
          manifestVersion: generation,
          manifest: json({
            fingerprint,
            complete: o.complete,
            unavailable: unavailable.length,
          }),
          lastAttemptAt: new Date(),
        },
      });
      await updateHealth(tx, userId, stateId);
      return { accepted: true, generation, complete: o.complete };
    },
    { timeout: 20000 },
  );
}
export async function cleanupSource(
  userId: string,
  stateId: string,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    await ownedState(tx, userId, stateId);
    const records = await tx.datingSourceRecord.findMany({
      where: {
        userId,
        stateId,
        status: {
          in: ["receiving", "pending", "retry", "processing", "extracted"],
        },
      },
    });
    const expired = records.filter(
      (r) =>
        r.createdAt.getTime() <
        now.getTime() - (r.status === "receiving" ? 86400000 : 7 * 86400000),
    );
    await tx.datingSourceRecord.updateMany({
      where: { userId, id: { in: expired.map((r) => r.id) } },
      data: {
        payload: Prisma.DbNull,
        extraction: Prisma.DbNull,
        status: "expired",
        leaseUntil: null,
        version: { increment: 1 },
      },
    });
    if (expired.length)
      await tx.datingSourceState.update({
        where: { id: stateId },
        data: {
          error:
            "Some source text expired before processing. Sync the source again.",
        },
      });
    await updateHealth(tx, userId, stateId);
    return expired.length;
  });
}
export async function sourceState(userId: string, source: string) {
  return prisma.datingSourceState.upsert({
    where: { userId_source_scope: { userId, source, scope: "default" } },
    create: { userId, source },
    update: {},
  });
}
export function stateDTO(s: DatingSourceState) {
  const stale =
    s.enabled &&
    s.source !== "granola" &&
    (!s.lastAttemptAt || Date.now() - s.lastAttemptAt.getTime() > 90 * 60000);
  return {
    id: s.id,
    source: s.source,
    enabled: s.enabled,
    status: stale ? "waiting_for_mac" : s.status,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
    lastNewDataAt: s.lastNewDataAt?.toISOString() ?? null,
    backlog: s.backlog,
    coverageStart: s.coverageStart?.toISOString() ?? null,
    coverageEnd: s.coverageEnd?.toISOString() ?? null,
    error: s.error,
  };
}
