import { Prisma } from "@prisma/client";
import { CaptureReviewError, type ReviewPlacement, type ReviewInput } from "./types";
import { domainSnapshot, lockDomainRows, sameValue, type CaptureEffect, type CaptureEffects, type DomainModel, type Snapshot } from "./journal";
import type { StoredCaptureFile } from "./commit";
import { requireListWrite } from "./access";
type Row = Record<string, unknown>;
export type DomainDelegate = { findFirst(args: unknown): Promise<Row | null>; findMany(args: unknown): Promise<Row[]>; update(args: unknown): Promise<Row>; delete(args: unknown): Promise<Row> };
export const delegate = (tx: Prisma.TransactionClient, model: DomainModel) => tx[model] as unknown as DomainDelegate;
export function conflict(): never { throw new CaptureReviewError(409, "This item changed after capture. Open it to edit without overwriting later changes."); }
export async function currentRow(tx: Prisma.TransactionClient, userId: string, effect: CaptureEffect) {
  const row = await delegate(tx, effect.model).findFirst({ where: { id: effect.id, userId } });
  if (!row) conflict();
  if (effect.model === "todo") await requireListWrite(tx, userId, String(row.listId));
  return row;
}
export async function checkEffect(tx: Prisma.TransactionClient, userId: string, effect: CaptureEffect, fields?: string[]) {
  const row = await currentRow(tx, userId, effect), snapshot = domainSnapshot(effect.model, row);
  if (fields ? fields.some(key => !sameValue(snapshot[key], effect.after[key])) : !sameValue(snapshot, effect.after)) conflict();
  return row;
}
export async function checkDependents(tx: Prisma.TransactionClient, userId: string, effect: CaptureEffect, effects: CaptureEffects) {
  const known = effects.writes.filter(w => w.model === "attachment").map(w => w.id);
  if (effect.model === "todo") {
    const [comments, children, files] = await Promise.all([tx.comment.count({ where: { todoId: effect.id } }), tx.todo.count({ where: { parentId: effect.id } }), tx.attachment.count({ where: { todoId: effect.id, id: { notIn: known } } })]);
    if (comments || children || files) conflict();
  } else if (effect.model === "asset" && await tx.attachment.count({ where: { assetId: effect.id, id: { notIn: known } } })) conflict();
  else if (effect.model === "trip") {
    if (await tx.tripItem.count({ where: { tripId: effect.id } }) || await tx.packingItem.count({ where: { tripId: effect.id } })) conflict();
  }
  void userId;
}
export async function capturedFiles(tx: Prisma.TransactionClient, userId: string, effects: CaptureEffects, input: ReviewInput): Promise<StoredCaptureFile[]> {
  const files: StoredCaptureFile[] = [];
  for (const effect of effects.writes.filter(w => w.model === "attachment")) {
    const row = await checkEffect(tx, userId, effect);
    if (row.kind !== "file" || typeof row.url !== "string") continue;
    files.push({ attachmentId: effect.id, url: row.url, file: { name: String(row.title ?? "Shared file"), type: typeof row.mimeType === "string" ? row.mimeType : "application/octet-stream", size: typeof row.size === "number" ? row.size : 0 } });
  }
  for (const file of input.files) if (!files.some(item => item.url === file.url)) files.push({ url: file.url, file: { name: file.name, type: file.mimeType ?? "application/octet-stream", size: file.size ?? 0 } });
  return files;
}
export async function retireCapture(tx: Prisma.TransactionClient, userId: string, placement: ReviewPlacement, effects: CaptureEffects) {
  const calendarIds = new Set<string>();
  const primaryModel = placement.type === "board" ? "boardItem" : placement.type === "reader" ? "readerItem" : placement.type;
  const primary = effects.writes.find(w => w.model === primaryModel && w.id === placement.id);
  if (!primary) conflict();
  await checkEffect(tx, userId, primary);
  await checkDependents(tx, userId, primary, effects);
  for (const effect of [...effects.writes].reverse()) {
    if (effect.model === "attachment") continue;
    const isPrimary = effect.model === primaryModel && effect.id === placement.id;
    if (effect.action === "create") {
      if (effect.model === "person" && !isPrimary) continue; // Shared contacts can have new array references; never hard-delete them.
      if (!isPrimary && effect.model !== "todo") continue;
      await checkEffect(tx, userId, effect);
      await checkDependents(tx, userId, effect, effects);
      if (effect.model === "todo") { await tx.todo.update({ where: { id: effect.id }, data: { completedAt: new Date(), droppedAt: new Date(), dueDate: null } }); calendarIds.add(effect.id); }
      else if (effect.model === "asset") await tx.asset.update({ where: { id: effect.id }, data: { archived: true } });
      else if (effect.model === "trip") await tx.trip.update({ where: { id: effect.id }, data: { archived: true } });
      else if (effect.model === "person") await tx.person.update({ where: { id: effect.id }, data: { archived: true } });
      else if (effect.model === "interaction") await tx.interaction.delete({ where: { id: effect.id } });
    } else {
      const fields = effect.fields.filter(key => key !== "lastInteractionAt" && key !== "contentHash");
      if (!fields.length) continue;
      await checkEffect(tx, userId, effect, fields);
      const data: Record<string, unknown> = {};
      for (const field of fields) {
        const value = effect.before?.[field] ?? null;
        data[field] = value === null && ((effect.model === "person" && field === "socialUrls") || (effect.model === "asset" && ["detailsJson", "tagsJson"].includes(field))) ? Prisma.DbNull : value;
      }
      await delegate(tx, effect.model).update({ where: { id: effect.id }, data });
      if (effect.model === "todo") calendarIds.add(effect.id);
    }
  }
  return calendarIds;
}
export async function reconcilePeople(tx: Prisma.TransactionClient, userId: string, effects: CaptureEffects, extraIds: string[] = []) {
  const ids = new Set(extraIds);
  const baselines = new Map<string, { before: unknown; after: unknown }>();
  for (const effect of effects.writes) {
    if (effect.model === "interaction" && Array.isArray(effect.after.personIds)) effect.after.personIds.forEach(id => { if (typeof id === "string") ids.add(id); });
    if (effect.model === "person") { ids.add(effect.id); baselines.set(effect.id, { before: effect.before?.lastInteractionAt ?? null, after: effect.after.lastInteractionAt ?? null }); }
  }
  // An older capture may not have written its people at all. Protect those
  // rows too before reading the baseline and replacing their derived dates.
  await lockDomainRows(tx, userId, [...ids].map(id => ({ model: "person", id })));
  for (const id of [...ids].sort()) {
    const person = await tx.person.findFirst({ where: { id, userId } }); if (!person) continue;
    const latest = await tx.interaction.aggregate({ where: { userId, personIds: { has: id } }, _max: { occurredAt: true } });
    const baseline = baselines.get(id);
    const dates = [latest._max.occurredAt, baseline?.before ? new Date(String(baseline.before)) : null];
    if (!baseline || !sameValue(person.lastInteractionAt?.toISOString() ?? null, baseline.after)) dates.push(person.lastInteractionAt);
    const valid = dates.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
    const next = valid.length ? new Date(Math.max(...valid.map(value => value.getTime()))) : null;
    if (!sameValue(person.lastInteractionAt?.toISOString() ?? null, next?.toISOString() ?? null)) await tx.person.update({ where: { id }, data: { lastInteractionAt: next } });
  }
}
export function mergeEffects(previous: CaptureEffects, next: CaptureEffects): CaptureEffects {
  const writes = previous.writes.map(w => ({ ...w, fields: [...w.fields] }));
  for (const effect of next.writes) {
    const existing = writes.find(w => w.model === effect.model && w.id === effect.id);
    if (existing) { existing.after = effect.after; existing.fields = [...new Set([...existing.fields, ...effect.fields])]; }
    else writes.push(effect);
  }
  return { ...previous, writes };
}
export function updateEffectSnapshot(effects: CaptureEffects, model: DomainModel, id: string, row: unknown) {
  const effect = effects.writes.find(w => w.model === model && w.id === id);
  if (effect) effect.after = domainSnapshot(model, row);
}
export function primaryEffect(effects: CaptureEffects, placement: ReviewPlacement) {
  const model = placement.type === "board" ? "boardItem" : placement.type === "reader" ? "readerItem" : placement.type;
  return effects.writes.find(w => w.model === model && w.id === placement.id);
}
export function snapshotField(snapshot: Snapshot, key: string) { return snapshot[key] ?? null; }
