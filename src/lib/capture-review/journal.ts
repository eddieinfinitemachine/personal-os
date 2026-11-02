import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { CaptureReviewError } from "./types";

export type DomainModel = "todo" | "asset" | "person" | "trip" | "interaction" | "attachment" | "boardItem" | "readerItem" | "callSheetContact";
export type Snapshot = Record<string, Prisma.JsonValue>;
export interface CaptureEffect { model: DomainModel; id: string; action: "create" | "update"; before: Snapshot | null; after: Snapshot; fields: string[] }
export interface CaptureEffects {
  version: 1;
  writes: CaptureEffect[];
  correctedAt?: string;
  calendarPending?: string[];
  history?: Array<{ at: string; placement: unknown; proposal?: unknown; writes?: CaptureEffect[] }>;
}
const MODELS = new Set<string>(["todo", "asset", "person", "trip", "interaction", "attachment", "boardItem", "readerItem", "callSheetContact"]);
export const DOMAIN_TABLES: Record<DomainModel, string> = { todo: "Todo", asset: "Asset", person: "Person", trip: "Trip", interaction: "Interaction", attachment: "Attachment", boardItem: "BoardItem", readerItem: "ReaderItem", callSheetContact: "CallSheetContact" };
type Args = { where?: Record<string, unknown>; data?: Record<string, unknown>; create?: Record<string, unknown>; update?: Record<string, unknown> };
type Delegate = Record<string, (args: unknown) => Promise<unknown>>;

export function jsonSnapshot(value: unknown): Snapshot {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item)) as Snapshot;
}
export function domainSnapshot(model: DomainModel, value: unknown): Snapshot {
  const row = jsonSnapshot(value);
  // Reader corrections never replace article content. Retain a fingerprint,
  // rather than copying megabytes of extracted HTML into every review.
  if (model === "readerItem" && typeof row.contentHtml === "string") {
    row.contentHash = createHash("sha256").update(row.contentHtml).digest("hex");
    delete row.contentHtml;
  }
  return row;
}
export function sameValue(a: unknown, b: unknown): boolean {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export async function lockDomainRows(tx: Prisma.TransactionClient, userId: string, refs: Array<{ model: DomainModel; id: string }>) {
  const unique = new Map(refs.map(ref => [`${ref.model}:${ref.id}`, ref]));
  for (const [, ref] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
    const table = DOMAIN_TABLES[ref.model];
    if (!table) throw new CaptureReviewError(409, "This capture needs to be opened for editing.");
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${ref.id} AND "userId" = ${userId} FOR UPDATE`);
  }
}
export function readEffects(value: unknown): CaptureEffects | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as CaptureEffects;
  return v.version === 1 && Array.isArray(v.writes) && v.writes.every(w => w && MODELS.has(w.model) && typeof w.id === "string" && ["create", "update"].includes(w.action) && w.after && typeof w.after === "object" && Array.isArray(w.fields) && w.fields.every(f => typeof f === "string")) ? v : null;
}
function normalizedWhere(where: Record<string, unknown> = {}) {
  const { userId_personId, ...rest } = where;
  return userId_personId && typeof userId_personId === "object" ? { ...rest, ...userId_personId } : where;
}

/** Explicit transaction-local journal. It never swaps a global client or runs external work. */
export function journalClient(tx: Prisma.TransactionClient, userId: string) {
  const writes: CaptureEffect[] = [];
  const delegates = new Map<PropertyKey, unknown>();
  const client = new Proxy(tx, {
    get(target, key, receiver) {
      if (typeof key !== "string" || !MODELS.has(key)) { const value = Reflect.get(target, key, receiver); return typeof value === "function" ? value.bind(target) : value; }
      if (delegates.has(key)) return delegates.get(key);
      const raw = Reflect.get(target, key) as Delegate;
      const model = key as DomainModel;
      const delegate = new Proxy(raw, {
        get(rawTarget, operation) {
          const fn = Reflect.get(rawTarget, operation);
          if (typeof fn !== "function") return fn;
          if (operation === "findFirst" || operation === "findUnique") return async (args: Args) => {
            const scoped = { ...args, where: { AND: [normalizedWhere(args.where), { userId }] } };
            const found = await raw.findFirst(scoped) as Record<string, unknown> | null;
            if (!found) return null;
            const id = typeof found.id === "string" ? found.id : (await raw.findFirst({ where: scoped.where, select: { id: true } }) as { id: string } | null)?.id;
            if (!id) return null;
            await lockDomainRows(tx, userId, [{ model, id }]);
            return raw.findFirst(scoped);
          };
          if (!["create", "update", "updateMany", "upsert"].includes(String(operation))) return fn.bind(rawTarget);
          return async (args: Args) => {
            const op = String(operation);
            const incoming = op === "upsert" ? args.create : args.data;
            if (incoming?.userId !== undefined && incoming.userId !== userId) throw new CaptureReviewError(404, "Capture destination not found.");
            const where = { AND: [normalizedWhere(args.where), { userId }] };
            let before = op === "create" ? [] : await raw.findMany({ where }) as Array<Record<string, unknown>>;
            if (before.length) {
              await lockDomainRows(tx, userId, before.map(row => ({ model, id: String(row.id) })));
              before = await raw.findMany({ where }) as Array<Record<string, unknown>>;
            }
            if (op === "update" && before.length !== 1) throw new CaptureReviewError(404, "Capture destination not found.");
            const actual = op === "updateMany" ? { ...args, where: { AND: [where, { id: { in: before.map(row => row.id) } }] } } : args;
            // An absent upsert target must not turn a racing insert into an
            // unjournaled update of someone else's new data.
            const result = op === "upsert"
              ? before.length ? await raw.update({ ...args, data: args.update, create: undefined, update: undefined }) : await raw.create({ ...args, where: undefined, data: args.create, create: undefined, update: undefined })
              : await fn.call(rawTarget, actual);
            let after: Array<Record<string, unknown>>;
            if (op === "updateMany") {
              after = before.length ? await raw.findMany({ where: { userId, id: { in: before.map(row => row.id) } } }) as Array<Record<string, unknown>> : [];
            } else {
              const row = result as Record<string, unknown>;
              after = row.userId === userId ? [row] : await raw.findMany({ where: { userId, id: row.id } }) as Array<Record<string, unknown>>;
            }
            for (const row of after) {
              if (row.userId !== userId || typeof row.id !== "string") throw new CaptureReviewError(404, "Capture destination not found.");
              const old = before.find(item => item.id === row.id);
              const snapshot = domainSnapshot(model, row);
              const oldSnapshot = old ? domainSnapshot(model, old) : null;
              const previous = writes.find(item => item.model === model && item.id === row.id);
              const fields = Object.keys(op === "upsert" ? (old ? args.update ?? {} : args.create ?? {}) : args.data ?? {}).map(field => model === "readerItem" && field === "contentHtml" ? "contentHash" : field).filter(field => !["id", "userId", "createdAt", "updatedAt"].includes(field) && (!oldSnapshot || !sameValue(oldSnapshot[field], snapshot[field])));
              if (previous) {
                previous.after = snapshot;
                previous.fields = [...new Set([...previous.fields, ...fields])];
              } else {
                writes.push({ model, id: row.id, action: old ? "update" : "create", before: oldSnapshot, after: snapshot, fields });
              }
            }
            return result;
          };
        },
      });
      delegates.set(key, delegate); return delegate;
    },
  });
  return { client, effects: (): CaptureEffects => ({ version: 1, writes }) };
}
