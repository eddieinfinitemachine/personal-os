import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { commitCore, validateCoreProposal, type CoreProposal } from "./commit";
import { commitCallSheetCapture } from "./intake";
import { journalClient, lockDomainRows, readEffects, sameValue, type CaptureEffects, type DomainModel } from "./journal";
import { captureLock } from "./record";
import { getCaptureReview, reviewInput, storedPlacement } from "./read";
import { requireRevision } from "./mutate";
import { correctionData, directFields, placementIds } from "./correct-data";
import { checkEffect, conflict, currentRow, delegate, capturedFiles, retireCapture, reconcilePeople, mergeEffects, primaryEffect } from "./correct-effects";
import { CaptureReviewError, type ReviewCorrection, type ReviewPlacement } from "./types";

async function interactionPeople(tx: Prisma.TransactionClient, userId: string, proposal: Extract<CoreProposal, { type: "interaction" }>) {
  const ids: string[] = [];
  for (const hint of proposal.personHints) {
    const firstName = hint.firstName.trim(), lastName = hint.lastName?.trim() || null;
    let person = await tx.person.findFirst({ where: { userId, firstName: { equals: firstName, mode: "insensitive" }, lastName: lastName ? { equals: lastName, mode: "insensitive" } : null } });
    if (!person) person = await tx.person.create({ data: { userId, firstName, lastName } });
    if (!ids.includes(person.id)) ids.push(person.id);
  }
  return ids;
}
function replacementNeeded(proposal: CoreProposal, previous: ReviewPlacement, current: Awaited<ReturnType<typeof getCaptureReview>>) {
  if (proposal.type !== previous.type) return true;
  if (proposal.type === "asset" && proposal.assetKind !== current?.placement.assetKind) return true;
  if (proposal.type === "asset" && Object.hasOwn(proposal, "followupTodo") && current?.proposal?.type === "asset" && !sameValue(proposal.followupTodo ?? null, current.proposal.followupTodo ?? null)) return true;
  const normalized = (v?: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (proposal.type === "person" && current?.proposal?.type === "person") return normalized(proposal.firstName) !== normalized(current.proposal.firstName) || normalized(proposal.lastName) !== normalized(current.proposal.lastName);
  return false;
}
function titleFor(proposal: CoreProposal) { return proposal.type === "person" ? [proposal.firstName.trim(), proposal.lastName?.trim()].filter(Boolean).join(" ") : proposal.type === "trip" ? proposal.name.trim() : proposal.title.trim(); }

/** No network, uploads, deliveries or global client swaps occur in this transaction. */
export async function correctCaptureReview(userId: string, id: string, body: ReviewCorrection) {
  const revision = requireRevision(body.revision);
  const fields = body.fields ?? {};
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new CaptureReviewError(400, "Invalid correction fields.");
  await prisma.$transaction(async tx => {
    await captureLock(tx, userId);
    await tx.$queryRaw`SELECT "id" FROM "CaptureReview" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const review = await tx.captureReview.findFirst({ where: { id, userId } });
    if (!review) throw new CaptureReviewError(404, "Capture not found.");
    if (review.revision !== revision) throw new CaptureReviewError(409, "This capture changed. Refresh it and try again.");
    const effects = readEffects(review.effects), previous = storedPlacement(review.placement);
    if (!effects) throw new CaptureReviewError(409, "Open this item to edit its original record.");
    if (previous.type === "call_sheet") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`call-sheet:${userId}`}))`;
    await lockDomainRows(tx, userId, effects.writes);
    const current = await getCaptureReview(userId, id, tx);
    if (!current || current.placement.missing) throw new CaptureReviewError(409, "The saved item was removed. Dismiss this review or open its destination.");
    const journal = journalClient(tx, userId);
    let nextEffects: CaptureEffects;
    let placement: ReviewPlacement = current.placement;
    let proposal = body.proposal ?? null;
    const calendarIds = new Set(effects.calendarPending ?? []);

    if (previous.type === "board" || previous.type === "reader") {
      if (body.proposal) throw new CaptureReviewError(400, "Use the available fields to correct this item.");
      const effect = primaryEffect(effects, previous); if (!effect) conflict();
      const row = await currentRow(tx, userId, effect);
      const data = directFields(previous.type, fields);
      // Preserve the original read/archive timestamp when its boolean state is unchanged.
      for (const key of ["readAt", "archivedAt"]) if ((data[key] && row[key]) || (data[key] === null && row[key] == null)) delete data[key];
      await checkEffect(tx, userId, effect, Object.keys(data));
      if (Object.keys(data).length) await delegate(journal.client, effect.model).update({ where: { id: effect.id }, data });
      nextEffects = mergeEffects(effects, journal.effects());
    } else if (previous.type === "call_sheet") {
      if (!proposal || proposal.type !== "call_sheet") throw new CaptureReviewError(400, "Call Sheet corrections keep the reminder type.");
      if (typeof proposal.firstName !== "string" || !proposal.firstName.trim() || (proposal.lastName != null && typeof proposal.lastName !== "string")) throw new CaptureReviewError(400, "Invalid call sheet reminder.");
      const effect = effects.writes.find(w => w.model === "callSheetContact" && w.after.personId === previous.id);
      if (!effect) conflict();
      await checkEffect(tx, userId, effect, ["dueOn", "dueNote", "snoozedUntil", "excludedAt"]);
      const oldName = current.proposal?.type === "call_sheet" ? current.proposal : null;
      const changedPerson = oldName && (proposal.firstName.trim() !== oldName.firstName || (proposal.lastName?.trim() || null) !== oldName.lastName);
      if (changedPerson) {
        await tx.callSheetContact.update({ where: { id: effect.id }, data: { dueOn: typeof effect.before?.dueOn === "string" ? effect.before.dueOn : null, dueNote: typeof effect.before?.dueNote === "string" ? effect.before.dueNote : null, snoozedUntil: typeof effect.before?.snoozedUntil === "string" ? new Date(effect.before.snoozedUntil) : null, excludedAt: typeof effect.before?.excludedAt === "string" ? new Date(effect.before.excludedAt) : null } });
      }
      placement = (await commitCallSheetCapture(journal.client, userId, proposal)).placement;
      nextEffects = changedPerson ? journal.effects() : mergeEffects(effects, journal.effects());
    } else {
      validateCoreProposal(proposal);
      for (const key of Object.keys(fields)) if (!["listId", "projectId"].includes(key)) throw new CaptureReviewError(400, "Unsupported correction field.");
      const ids = await placementIds(tx, userId, proposal, fields);
      if (replacementNeeded(proposal, previous, current)) {
        const files = await capturedFiles(tx, userId, effects, reviewInput(review.input));
        const retired = await retireCapture(tx, userId, previous, effects);
        retired.forEach(todoId => calendarIds.add(todoId));
        // Recompute before merging into a new Person, so that merge's baseline
        // cannot retain the interaction that was just removed.
        await reconcilePeople(tx, userId, effects);
        placement = await commitCore(journal.client, userId, reviewInput(review.input), proposal, files, { mode: "correction", ...ids, autoFollowup: !(proposal.type === "asset" && Object.hasOwn(proposal, "followupTodo") && proposal.followupTodo === null) });
        await reconcilePeople(journal.client, userId, journal.effects());
        nextEffects = journal.effects();
      } else {
        const effect = primaryEffect(effects, previous); if (!effect) conflict();
        const existing = await checkEffect(tx, userId, effect);
        const data: Record<string, unknown> = { ...correctionData(proposal, existing), ...ids };
        if (proposal.type === "interaction") Object.assign(data, { personIds: await interactionPeople(journal.client, userId, proposal) });
        await delegate(journal.client, effect.model as DomainModel).update({ where: { id: previous.id }, data });
        if (proposal.type === "interaction") await reconcilePeople(journal.client, userId, effects, data.personIds as string[]);
        placement = { ...placement, title: titleFor(proposal) };
        nextEffects = mergeEffects(effects, journal.effects());
      }
    }
    for (const write of journal.effects().writes) if (write.model === "todo") calendarIds.add(write.id);
    const now = new Date().toISOString();
    nextEffects.correctedAt = now;
    nextEffects.calendarPending = [...calendarIds];
    nextEffects.history = [...(effects.history ?? []), { at: now, placement: review.placement, proposal: review.proposal, writes: effects.writes }];
    if (placement.id !== previous.id || placement.type !== previous.type) {
      const related = nextEffects.writes.filter(w => w.model === "todo" && w.action === "create" && w.id !== placement.id).map(w => ({ type: "todo" as const, id: w.id, title: String(w.after.title ?? "Supporting task"), destination: "Supporting task", path: "/" }));
      placement = { ...placement, related };
    }
    const changed = await tx.captureReview.updateMany({ where: { id, userId, revision }, data: { proposal: proposal ? proposal as unknown as Prisma.InputJsonValue : Prisma.DbNull, placement: placement as unknown as Prisma.InputJsonValue, effects: nextEffects as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
    if (!changed.count) conflict();
  }, { maxWait: 10_000, timeout: 20_000, isolationLevel: "ReadCommitted" });
  const result = await getCaptureReview(userId, id);
  if (!result) throw new CaptureReviewError(404, "Capture not found.");
  return result;
}
