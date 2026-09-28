import { normalizeHandle } from "../dating";
import { hash, segments, type Envelope } from "./contracts";

export type DiscoverySource = "imessage" | "whatsapp";
export type DiscoveryThread = { id: string; source: DiscoverySource; handle: string; oneToOne: boolean };
export type Position = { date: string; id: number };
export type DiscoveryMessage = { position: Position; guid: string; sentAt: string; fromMe: boolean; text: string };
export type DiscoveryConfig = { enabled: boolean; stateId?: string; days: number; excludedHandles: string[]; refetchIds?: string[] };
type Pending = { from: Position | null; through: Position; since: string; sequence: number; revision: string; documentVersion: number; nextSegment: number };
export type ThreadCheckpoint = { position: Position | null; sequence: number; pending?: Pending };
export type DiscoveryCheckpoint = { version: 1; stateId: string; nextThread: number; threads: Record<string, ThreadCheckpoint>; sweep?: { since: string; startedAt: string; completed: string[] }; chunks?: Record<string, Pending>; refetch?: Record<string, { revision: string; documentVersion: number; nextSegment: number }> };

export const threadKey = (thread: DiscoveryThread) => hash(`${thread.source}:${thread.id}:${thread.handle}`);
export function discoverableThread(thread: DiscoveryThread, excluded: ReadonlySet<string>) {
  const handle = normalizeHandle(thread.handle);
  if (!thread.oneToOne || handle !== thread.handle || excluded.has(handle)) return false;
  // Short codes, service email addresses and invalid handles are not people.
  if (/^(?:no[.-]?reply|notifications?|support|alerts?|updates?|billing|info)@/i.test(handle)) return false;
  return /^\+[1-9]\d{9,14}$/.test(handle) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle);
}
function serviceMessage(text: string) {
  return /\b(?:verification code|one[- ]time (?:code|password)|reply stop|stop to (?:opt out|unsubscribe)|do not share (?:this|your) code|automated (?:message|notification))\b/i.test(text);
}
export function discoveryEnvelopes(thread: DiscoveryThread, messages: DiscoveryMessage[], sequence: number, documentVersion: number): Envelope[] {
  const relevant = messages.filter((message) => !serviceMessage(message.text));
  const text = relevant.map((message) => `${message.sentAt} ${message.fromMe ? "Me" : thread.handle}: ${message.text}`).join("\n");
  const chunks = segments(text);
  return chunks.map((chunk, segmentIndex) => ({ version: 1, externalId: `texts:${thread.source}:${threadKey(thread)}:${sequence}`,
    revision: hash(text), documentVersion, segmentIndex, segmentCount: chunks.length, text: chunk,
    title: thread.handle, occurredAt: relevant.at(-1)?.sentAt ?? null, url: null, identities: [thread.handle], evidenceFamily: null,
  }));
}

/** Only metadata survives between runs. `read` returns a bounded chronological page with a small overlap. */
export async function runMessageDiscovery(options: {
  config: DiscoveryConfig; checkpoint: DiscoveryCheckpoint; now?: () => number; maxMs?: number; maxSegments?: number;
  list: (since: string) => Promise<DiscoveryThread[]>;
  read: (thread: DiscoveryThread, from: Position | null, since: string, through?: Position) => Promise<{ messages: DiscoveryMessage[]; through: Position | null; hasMore: boolean }>;
  send: (envelope: Envelope) => Promise<{ accepted: boolean; externalId: string; revision: string; segmentIndex: number; documentVersion: number }>;
  save: (checkpoint: DiscoveryCheckpoint) => Promise<void>;
  progress: (value: { complete: boolean; coverageStart: string; coverageEnd: string; remaining: number; error: boolean }) => Promise<void>;
}) {
  if (!options.config.enabled || !options.config.stateId) return { sent: 0, complete: false, skipped: true };
  const now = options.now ?? Date.now;
  const start = now();
  const deadline = start + Math.max(0, Math.min(options.maxMs ?? 45_000, 45_000));
  const maxSegments = Math.max(0, Math.min(options.maxSegments ?? 40, 40));
  const checkpoint: DiscoveryCheckpoint = options.checkpoint.stateId === options.config.stateId ? options.checkpoint : { version: 1, stateId: options.config.stateId, nextThread: 0, threads: {} };
  checkpoint.sweep ??= { since: new Date(start - Math.min(Math.max(options.config.days, 1), 30) * 86_400_000).toISOString(), startedAt: new Date(start).toISOString(), completed: [] };
  const since = checkpoint.sweep.since;
  const coverageEnd = checkpoint.sweep.startedAt;
  const excluded = new Set(options.config.excludedHandles.map(normalizeHandle));
  const threads = (await options.list(since)).filter((thread) => discoverableThread(thread, excluded)).sort((a, b) => threadKey(a).localeCompare(threadKey(b)));
  const present = new Set(threads.map(threadKey));
  const completed = new Set(checkpoint.sweep.completed.filter((key) => present.has(key)));
  const order = [...threads.slice(checkpoint.nextThread), ...threads.slice(0, checkpoint.nextThread)].filter((thread) => !completed.has(threadKey(thread)));
  await options.save(structuredClone(checkpoint));
  let sent = 0;
  let requests = 0;
  let finished = completed.size;
  let failed = false;
  let unresolvedRefetches = 0;
  checkpoint.chunks ??= {};
  checkpoint.refetch ??= {};
  // Expired server retry input is reconstructed from local bounds, never from a saved copy of message text.
  for (const externalId of options.config.refetchIds ?? []) {
    if (requests >= maxSegments || now() >= deadline) { unresolvedRefetches++; continue; }
    const archived = checkpoint.chunks[externalId];
    const thread = threads.find((item) => externalId === `texts:${item.source}:${threadKey(item)}:${archived?.sequence}`);
    if (!archived || !thread) { failed = true; unresolvedRefetches++; continue; }
    try {
      const page = await options.read(thread, archived.from, archived.since, archived.through);
      if (!page.through || page.through.date !== archived.through.date || page.through.id !== archived.through.id) throw new Error("Original source messages are unavailable");
      let envelopes = discoveryEnvelopes(thread, page.messages, archived.sequence, archived.documentVersion);
      if (envelopes[0].revision !== archived.revision) envelopes = discoveryEnvelopes(thread, page.messages, archived.sequence, archived.documentVersion + 1);
      const previous = checkpoint.refetch[externalId];
      const retry = previous?.revision === envelopes[0].revision ? previous : { revision: envelopes[0].revision, documentVersion: previous ? previous.documentVersion + 1 : envelopes[0].documentVersion, nextSegment: 0 };
      checkpoint.refetch[externalId] = retry;
      await options.save(structuredClone(checkpoint));
      for (let index = retry.nextSegment; index < envelopes.length; index++) {
        if (requests >= maxSegments || now() >= deadline) break;
        requests++;
        const result = await options.send({ ...envelopes[index], documentVersion: retry.documentVersion });
        if (!result.accepted || result.externalId !== envelopes[index].externalId || result.revision !== retry.revision || result.segmentIndex !== index || result.documentVersion !== retry.documentVersion) throw new Error("Source acknowledgment did not match");
        sent++; retry.nextSegment = index + 1;
        await options.save(structuredClone(checkpoint));
      }
      if (retry.nextSegment < envelopes.length) { unresolvedRefetches++; continue; }
      checkpoint.chunks[externalId] = { ...archived, revision: retry.revision, documentVersion: retry.documentVersion, nextSegment: 0 };
      const local = checkpoint.threads[threadKey(thread)];
      if (local?.pending?.sequence === archived.sequence) local.pending = { ...archived, revision: retry.revision, documentVersion: retry.documentVersion, nextSegment: envelopes.length };
      delete checkpoint.refetch[externalId];
      await options.save(structuredClone(checkpoint));
    } catch { failed = true; unresolvedRefetches++; }
  }
  for (const thread of order) {
    if (requests >= maxSegments || now() >= deadline) break;
    const key = threadKey(thread);
    const saved = checkpoint.threads[key] ?? { position: null, sequence: 0 };
    checkpoint.threads[key] = saved;
    checkpoint.nextThread = threads.indexOf(thread);
    try {
      let hasMore = true;
      while (hasMore && requests < maxSegments && now() < deadline) {
        const page = await options.read(thread, saved.pending?.from ?? saved.position, saved.pending?.since ?? since, saved.pending?.through);
        if (!page.through) {
          if (saved.pending) throw new Error("Pending source messages are unavailable");
          hasMore = false; break;
        }
        if (saved.pending && (page.through.date !== saved.pending.through.date || page.through.id !== saved.pending.through.id)) throw new Error("Pending source boundary changed");
        const sequence = saved.pending?.sequence ?? saved.sequence + 1;
        let envelopes = discoveryEnvelopes(thread, page.messages, sequence, saved.pending?.documentVersion ?? 1);
        if (saved.pending && saved.pending.revision !== envelopes[0].revision) envelopes = discoveryEnvelopes(thread, page.messages, sequence, saved.pending.documentVersion + 1);
        if (!saved.pending && envelopes.every((entry) => !entry.text)) {
          saved.position = page.through; saved.sequence = sequence;
          await options.save(structuredClone(checkpoint));
          hasMore = page.hasMore;
          continue;
        }
        const pending: Pending = saved.pending?.revision === envelopes[0].revision ? saved.pending : { from: saved.position, through: page.through, since: saved.pending?.since ?? since, sequence,
          revision: envelopes[0].revision, documentVersion: envelopes[0].documentVersion, nextSegment: 0 };
        saved.pending = pending;
        checkpoint.chunks[envelopes[0].externalId] = { ...pending, nextSegment: 0 };
        await options.save(structuredClone(checkpoint));
        for (let index = pending.nextSegment; index < envelopes.length; index++) {
          if (requests >= maxSegments || now() >= deadline) break;
          requests++;
          const result = await options.send(envelopes[index]);
          if (!result.accepted || result.externalId !== envelopes[index].externalId || result.revision !== pending.revision || result.segmentIndex !== index || result.documentVersion !== pending.documentVersion) throw new Error("Source acknowledgment did not match the uploaded segment");
          sent++;
          pending.nextSegment = index + 1;
          await options.save(structuredClone(checkpoint));
        }
        if (pending.nextSegment < envelopes.length) break;
        saved.position = page.through; saved.sequence = sequence; delete saved.pending;
        await options.save(structuredClone(checkpoint));
        hasMore = page.hasMore;
      }
      if (!hasMore) { finished++; completed.add(key); checkpoint.sweep.completed = [...completed]; }
    } catch { failed = true; }
    // Advance fairness only after a full thread scan. Partial chunks resume first next run.
    if (saved.pending || requests >= maxSegments || now() >= deadline) break;
    checkpoint.nextThread = (threads.indexOf(thread) + 1) % Math.max(threads.length, 1);
  }
  const complete = !failed && !unresolvedRefetches && finished === threads.length;
  if (complete) delete checkpoint.sweep;
  await options.save(structuredClone(checkpoint));
  await options.progress({ complete, coverageStart: since, coverageEnd, remaining: complete ? 0 : Math.max(1, threads.length - finished + unresolvedRefetches), error: failed });
  return { sent, complete, skipped: false };
}
