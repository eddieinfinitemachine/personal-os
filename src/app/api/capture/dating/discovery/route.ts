import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { envelope, IntakeError, integer, object, readJSON } from "@/lib/dating-intake/contracts";
import { acceptRecord, json, lockOwner, updateHealth } from "@/lib/dating-intake/store";
import { processSource } from "@/lib/dating-intake/extract";
import { failure } from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function enabledState(userId: string) {
  return prisma.datingSourceState.findFirst({ where: { userId, source: "texts", scope: "default", enabled: true } });
}
async function excludedHandles(userId: string, db: Pick<typeof prisma, "datingPerson" | "datingCandidate"> = prisma) {
  const [people, excluded] = await Promise.all([
    db.datingPerson.findMany({ where: { userId }, select: { handles: true } }),
    db.datingCandidate.findMany({ where: { userId, OR: [{ status: "excluded" }, { status: "approved", personId: { not: null } }] }, select: { identities: true } }),
  ]);
  return [...new Set([...people.flatMap((person) => person.handles), ...excluded.flatMap((candidate) => Array.isArray(candidate.identities) ? candidate.identities.filter((value): value is string => typeof value === "string") : [])])];
}
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("Unauthorized", 401);
    const state = await enabledState(userId);
    if (!state) return NextResponse.json({ enabled: false, days: 30, excludedHandles: [] });
    const blocked = await excludedHandles(userId);
    const expired = await prisma.datingSourceRecord.findMany({ where: { userId, stateId: state.id, status: "expired", title: { notIn: blocked } }, select: { externalId: true }, distinct: ["externalId"], take: 100 });
    return NextResponse.json({ enabled: true, stateId: state.id, days: 30, excludedHandles: blocked, refetchIds: expired.map((record) => record.externalId) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("Unauthorized", 401);
    const state = await enabledState(userId);
    if (!state) throw new IntakeError("Message discovery is not enabled", 409);
    const body = object(await readJSON(request));
    if (body.action === "record") {
      const record = envelope(body.envelope);
      if (!/^texts:(imessage|whatsapp):[a-f0-9]{64}:\d+$/.test(record.externalId) || record.identities.length !== 1 || record.title !== record.identities[0] || record.url !== null || record.evidenceFamily !== null) throw new IntakeError("Expected an exact one-to-one conversation identity");
      const excluded = new Set(await excludedHandles(userId));
      if (record.identities.some((identity) => excluded.has(identity))) throw new IntakeError("This contact is excluded from discovery", 409);
      return NextResponse.json(await acceptRecord(userId, state.id, record));
    }
    if (body.action !== "progress" || typeof body.complete !== "boolean" || typeof body.error !== "boolean") throw new IntakeError("Unknown discovery action");
    const remaining = integer(body.remaining, 0, 100_000);
    const start = typeof body.coverageStart === "string" ? new Date(body.coverageStart) : new Date(NaN);
    const end = typeof body.coverageEnd === "string" ? new Date(body.coverageEnd) : new Date(NaN);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || end.getTime() - start.getTime() > 31 * 86_400_000 || end.getTime() > Date.now() + 60_000 || (body.complete && (remaining || body.error))) throw new IntakeError("Invalid discovery coverage");
    await prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const current = await tx.datingSourceState.findFirst({ where: { id: state.id, userId, enabled: true } });
      if (!current) throw new IntakeError("Message discovery is no longer enabled", 409);
      // Approved/excluded conversations are intentionally no longer discovery input, including expired retries.
      const blocked = await excludedHandles(userId, tx);
      if (blocked.length) await tx.datingSourceRecord.updateMany({ where: { userId, stateId: state.id, status: "expired", title: { in: blocked } }, data: { status: "withdrawn", leaseUntil: null, version: { increment: 1 } } });
      await tx.datingSourceState.update({ where: { id: state.id }, data: {
        lastAttemptAt: new Date(), manifest: json({ complete: body.complete }),
        cursor: json({ ...object(current.cursor), adapterBacklog: remaining, adapterError: body.error ? "Some conversations could not be checked. The Mac will retry." : null }),
        ...(body.complete ? { coverageStart: start, coverageEnd: end } : {}),
      } });
      await updateHealth(tx, userId, state.id);
    });
    after(async () => { try { await processSource(userId, state.id); } catch { console.error("Dating message discovery processing failed"); } });
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
