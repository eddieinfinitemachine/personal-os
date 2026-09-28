import {
  Prisma,
  type DatingCandidate,
  type DatingSourceRecord,
  type DatingSuggestion,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  newPersonError,
  personPatch,
  personPatchError,
} from "@/lib/dating-server";
import { hash, IntakeError, object, aliases } from "./contracts";
import { lockOwner, json, eventHash, type Tx } from "./store";

export type Mention = {
  name: string;
  summary: string;
  quote: string;
  eventDate: string | null;
  correspondent: boolean;
};
export const identityList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
function reviewedDigests(value: string | null): string[] {
  try {
    const data = JSON.parse(value ?? "{}");
    return Array.isArray(data.dismissed)
      ? data.dismissed.filter((v: unknown) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
function mentionDigest(
  stateId: string,
  externalId: string,
  name: string,
  quote: string,
) {
  return hash(JSON.stringify([stateId, externalId, name.toLowerCase(), quote]));
}
export function fingerprint(
  rows: Pick<DatingSuggestion, "id" | "sourceFingerprint">[],
) {
  return hash(
    rows
      .map((r) => `${r.id}:${r.sourceFingerprint}`)
      .sort()
      .join("\n"),
  );
}
export async function resolveIdentity(
  tx: Tx,
  userId: string,
  identities: string[],
  key?: string,
) {
  const candidates = await tx.datingCandidate.findMany({ where: { userId } });
  const known = new Set(identities);
  const matchedIds = new Set<string>();
  // A source key is explicit identity evidence only within its original source.
  for (const candidate of candidates) {
    if (candidate.identityKey === key && !key?.startsWith("contact:")) {
      matchedIds.add(candidate.id);
      for (const alias of identityList(candidate.identities)) known.add(alias);
    }
  }
  const ownedProfiles = known.size
    ? await tx.datingPerson.findMany({
        where: { userId, handles: { isEmpty: false } },
        select: { id: true, handles: true },
      })
    : [];
  const profileIds = new Set<string>();
  // Resolve the entire alias component, not just neighbors of the submitted handles.
  // A[a,b], B[b,c], C[c] must share approval/exclusion decisions from either end.
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (matchedIds.has(candidate.id)) continue;
      const aliases = identityList(candidate.identities);
      if (!aliases.some((alias) => known.has(alias))) continue;
      matchedIds.add(candidate.id);
      for (const alias of aliases) known.add(alias);
      changed = true;
    }
    for (const profile of ownedProfiles) {
      if (profileIds.has(profile.id)) continue;
      if (!profile.handles.some((alias) => known.has(alias))) continue;
      profileIds.add(profile.id);
      for (const alias of profile.handles) known.add(alias);
      changed = true;
    }
  }
  const matches = candidates.filter((candidate) => matchedIds.has(candidate.id));
  const profiles = ownedProfiles.filter((profile) => profileIds.has(profile.id));
  const linked = [
    ...new Set([
      ...matches.flatMap((c) => (c.personId ? [c.personId] : [])),
      ...profiles.map((p) => p.id),
    ]),
  ];
  if (linked.length > 1)
    throw new IntakeError(
      "These contact details point to different people. Review their phone numbers first.",
      409,
    );
  return {
    matches,
    personId: linked[0] ?? null,
    excluded: matches.some((c) => c.status === "excluded"),
  };
}
async function attachEvidence(
  tx: Tx,
  userId: string,
  personId: string,
  rows: (DatingSuggestion & { sourceRecord: DatingSourceRecord | null })[],
) {
  for (const s of rows) {
    const r = s.sourceRecord;
    if (
      !r ||
      r.userId !== userId ||
      ["superseded", "withdrawn", "expired"].includes(r.status)
    )
      throw new IntakeError("Evidence changed; refresh this suggestion", 409);
    const evidence = object(s.evidence);
    const date =
      typeof evidence.eventDate === "string"
        ? new Date(`${evidence.eventDate}T12:00:00Z`)
        : null;
    // A source's occurrence date isn't necessarily the event date. Undated evidence stays attached to the candidate.
    const conflict = await tx.datingEvent.findFirst({
      where: {
        userId,
        personId,
        machineContentHash: "conflict",
        sourceRecord: { userId, stateId: r.stateId, externalId: r.externalId },
      },
    });
    if (!conflict && date && Number.isFinite(date.getTime())) {
      const event = {
        userId,
        personId,
        occurredAt: date,
        kind: "note",
        title: s.summary.slice(0, 200),
        notes: s.note,
        vibe: null,
        source: r.source,
        sourceRecordId: r.id,
        externalId: `intake:${s.id}:${personId}`,
      };
      await tx.datingEvent.upsert({
        where: { userId_externalId: { userId, externalId: event.externalId } },
        create: { ...event, machineContentHash: eventHash(event) },
        update: {},
      });
    }
    await tx.datingSuggestion.update({
      where: { id: s.id },
      data: { status: "added", personId },
    });
  }
  await tx.datingPerson.updateMany({
    where: { id: personId, userId },
    data: { insights: Prisma.DbNull, insightsAt: null },
  });
}
/** Publish only from a fully extracted immutable source revision under the owner lock. */
export async function publishMentions(
  tx: Tx,
  record: DatingSourceRecord,
  mentions: Mention[],
  verified: string[],
) {
  for (const m of mentions) {
    const ids = m.correspondent ? verified : [];
    const key = ids.length
      ? `contact:${hash(ids[0])}`
      : `source:${hash(`${record.stateId}:${record.externalId}:${m.name.toLocaleLowerCase("en-US")}`)}`;
    const resolution = await resolveIdentity(tx, record.userId, ids, key);
    if (resolution.excluded) continue;
    let candidate =
      resolution.matches.find((c) => c.status === "approved") ??
      resolution.matches[0];
    if (!candidate)
      candidate = await tx.datingCandidate.create({
        data: {
          userId: record.userId,
          identityKey: key,
          name: m.name,
          identities: json(ids),
          personId: resolution.personId,
          status: resolution.personId ? "approved" : "pending",
        },
      });
    else if (ids.length)
      candidate = await tx.datingCandidate.update({
        where: { id: candidate.id },
        data: {
          identities: json([
            ...new Set([...identityList(candidate.identities), ...ids]),
          ]),
        },
      });
    const digest = mentionDigest(
      record.stateId,
      record.externalId,
      m.name,
      m.quote,
    );
    if (
      resolution.matches.some((c) =>
        reviewedDigests(c.reviewedFingerprint).includes(digest),
      )
    )
      continue;
    if (resolution.matches.length > 1) {
      const union = [
        ...new Set(
          resolution.matches
            .flatMap((c) => identityList(c.identities))
            .concat(ids),
        ),
      ];
      const dismissed = [
        ...new Set(
          resolution.matches.flatMap((c) =>
            reviewedDigests(c.reviewedFingerprint),
          ),
        ),
      ];
      // Keep every source key and its review decision. Moving pending evidence onto
      // an approved row would hide it from review and lose durable source/name links.
      candidate = await tx.datingCandidate.update({
        where: { id: candidate.id },
        data: {
          identities: json(union),
          reviewedFingerprint: JSON.stringify({ dismissed }),
        },
      });
    }
    const sourceFingerprint = hash(
      JSON.stringify([
        record.revision,
        record.segmentIndex,
        m.quote,
        m.name,
        m.eventDate,
      ]),
    );
    // Exact prior dismissals survive payload purging/repeated classification.
    const prior = await tx.datingSuggestion.findFirst({
      where: {
        userId: record.userId,
        candidateId: {
          in: [...new Set([candidate.id, ...resolution.matches.map((c) => c.id)])],
        },
        sourceFingerprint,
      },
    });
    if (prior) continue;
    const suggestion = await tx.datingSuggestion.create({
      data: {
        userId: record.userId,
        name: m.name,
        meetingId: `intake:${record.id}:${digest}`,
        title: record.title,
        url: record.url,
        occurredAt: record.occurredAt ?? record.observedAt,
        summary: m.summary,
        note: m.quote,
        source: record.source,
        sourceRecordId: record.id,
        candidateId: candidate.id,
        sourceFingerprint,
        evidence: json({
          quote: m.quote,
          eventDate: m.eventDate,
          occurredAt: record.occurredAt?.toISOString() ?? null,
        }),
        draft: json({
          name: m.name,
          stage: "talking",
          metAt: null,
          handles: ids,
        }),
      },
    });
    if (candidate.status === "approved" && candidate.personId)
      await attachEvidence(tx, record.userId, candidate.personId, [
        { ...suggestion, sourceRecord: record },
      ]);
    else if (candidate.status === "dismissed")
      await tx.datingCandidate.update({
        where: { id: candidate.id },
        data: { status: "pending" },
      });
  }
}
async function reviewRows(tx: Tx, userId: string, candidateId: string) {
  return tx.datingSuggestion.findMany({
    where: {
      userId,
      candidateId,
      status: "pending",
      sourceRecord: { userId, status: "processed" },
    },
    include: { sourceRecord: true },
    orderBy: { createdAt: "asc" },
  });
}
export async function reviewCandidate(
  userId: string,
  id: string,
  input: unknown,
) {
  const o = object(input);
  const action = o.action;
  if (
    !["add", "link", "dismiss", "exclude", "restore"].includes(String(action))
  )
    throw new IntakeError("Unknown review action");
  return prisma.$transaction(
    async (tx) => {
      await lockOwner(tx, userId);
      let c = await tx.datingCandidate.findFirst({ where: { userId, id } });
      if (!c) throw new IntakeError("Not found", 404);
      const rows = await reviewRows(tx, userId, id);
      const current = fingerprint(rows);
      if (o.fingerprint !== current)
        throw new IntakeError(
          "Evidence changed. Refresh before reviewing.",
          409,
        );
      if (action === "restore") {
        if (c.status !== "excluded")
          throw new IntakeError("Already restored", 409);
        const group = await resolveIdentity(
          tx,
          userId,
          identityList(c.identities),
          c.identityKey,
        );
        for (const excluded of group.matches.filter(
          (m) => m.status === "excluded",
        ))
          await tx.datingCandidate.update({
            where: { id: excluded.id },
            data: { status: "dismissed" },
          });
        return { ok: true };
      }
      if (action === "dismiss" || action === "exclude") {
        const matching = await resolveIdentity(
          tx,
          userId,
          identityList(c.identities),
          c.identityKey,
        );
        const ids =
          action === "exclude" ? matching.matches.map((x) => x.id) : [id];
        const reviewedCandidates = action === "exclude" ? matching.matches : [c];
        const dismissedRows = action === "exclude"
          ? await tx.datingSuggestion.findMany({
              where: { userId, candidateId: { in: ids }, status: "pending" },
              include: { sourceRecord: true },
            })
          : rows;
        const dismissed = [
          ...new Set([
            ...reviewedCandidates.flatMap((candidate) =>
              reviewedDigests(candidate.reviewedFingerprint),
            ),
            ...dismissedRows.flatMap((r) =>
              r.sourceRecord
                ? [
                    mentionDigest(
                      r.sourceRecord.stateId,
                      r.sourceRecord.externalId,
                      r.name,
                      r.note,
                    ),
                  ]
                : [],
            ),
          ]),
        ];
        await tx.datingCandidate.updateMany({
          where: { userId, id: { in: ids } },
          data: {
            status: action === "exclude" ? "excluded" : "dismissed",
            reviewedFingerprint: JSON.stringify({
              fingerprint: current,
              dismissed,
            }),
          },
        });
        await tx.datingSuggestion.updateMany({
          where: { userId, candidateId: { in: ids }, status: "pending" },
          data: { status: "dismissed" },
        });
        return { ok: true };
      }
      if (c.status === "excluded")
        throw new IntakeError("Restore this person before adding them", 409);
      if (!rows.length) {
        if (c.personId && c.status === "approved")
          return { ok: true, personId: c.personId };
        throw new IntakeError("No current evidence to approve", 409);
      }
      const draft = action === "add" ? object(o.draft ?? {}) : {};
      const invalid = personPatchError(draft) ?? newPersonError(draft);
      if (invalid) throw new IntakeError(invalid);
      const patch = personPatch(draft);
      const ids = [
        ...new Set([...identityList(c.identities), ...(patch.handles ?? [])]),
      ];
      const resolution = await resolveIdentity(tx, userId, ids, c.identityKey);
      if (resolution.excluded)
        throw new IntakeError(
          "An overlapping identity is excluded. Restore it first.",
          409,
        );
      let personId =
        action === "link" ? String(o.personId ?? "") : resolution.personId;
      if (personId) {
        const p = await tx.datingPerson.findFirst({
          where: { userId, id: personId },
        });
        if (!p) throw new IntakeError("Person not found", 404);
        if (resolution.personId && resolution.personId !== personId)
          throw new IntakeError(
            "Contact details belong to another profile",
            409,
          );
      } else if (action === "add") {
        const name = patch.name ?? c.name;
        personId = (
          await tx.datingPerson.create({
            data: {
              userId,
              name,
              stage: patch.stage ?? "talking",
              handles: ids,
              metAt: patch.metAt ?? null,
            },
          })
        ).id;
      } else throw new IntakeError("Choose a person");
      // No automatic edits to an existing person's manual fields.
      for (const match of resolution.matches.filter((m) => m.id === id)) {
        await tx.datingCandidate.update({
          where: { id: match.id },
          data: {
            status: "approved",
            personId,
            identities: json([
              ...new Set([...identityList(match.identities), ...ids]),
            ]),
            reviewedFingerprint: JSON.stringify({
              fingerprint: current,
              dismissed: reviewedDigests(match.reviewedFingerprint),
            }),
          },
        });
      }
      await attachEvidence(tx, userId, personId, rows);
      return { ok: true, personId };
    },
    { timeout: 20000 },
  );
}
export async function listReview(userId: string) {
  const candidates = await prisma.datingCandidate.findMany({
    where: { userId, status: { in: ["pending", "excluded"] } },
    orderBy: { updatedAt: "desc" },
    include: {
      suggestions: {
        where: {
          userId,
          status: "pending",
          sourceRecord: { userId, status: "processed" },
        },
        orderBy: { createdAt: "asc" },
        include: { sourceRecord: true },
      },
    },
  });
  const dto = (c: (typeof candidates)[number]) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    personId: c.personId,
    identities: identityList(c.identities),
    fingerprint: fingerprint(c.suggestions),
    evidence: c.suggestions.map((s) => ({
      id: s.id,
      source: s.source,
      title: s.title,
      url: s.url,
      occurredAt: s.sourceRecord?.occurredAt?.toISOString() ?? null,
      quote: s.note,
      summary: s.summary,
    })),
    draft: {
      name: c.name,
      stage: "talking",
      metAt: null,
      handles: identityList(c.identities),
    },
  });
  return {
    candidates: candidates
      .filter((c) => c.status === "pending" && c.suggestions.length)
      .map(dto),
    excluded: candidates.filter((c) => c.status === "excluded").map(dto),
  };
}
