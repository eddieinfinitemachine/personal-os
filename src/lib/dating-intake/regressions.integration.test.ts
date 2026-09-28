import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest';
import {prisma} from '@/lib/prisma';
import {hash, type Envelope} from './contracts';
import {acceptManifest, acceptRecord, cleanupSource} from './store';
import {processSource} from './extract';
import {fingerprint, listReview, reviewCandidate} from './review';
import {claimPairing, connector, createPairing} from './auth';

const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === '1';
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.port !== '55442' || url.pathname !== '/dating_intake') {
    throw new Error('Scratch database required');
  }
}

describe.skipIf(!enabled)('intake regressions across revisions and identity changes', () => {
  let userId: string;
  let stateId: string;
  const quote = 'I went on a date with Robin on 2026-09-01 and want to see her again.';
  const envelope = (text = quote, documentVersion = 1, externalId = 'journal', identities: string[] = []): Envelope => ({
    version: 1, externalId, documentVersion, revision: hash(text), segmentIndex: 0, segmentCount: 1,
    text, title: 'Robin', occurredAt: null, url: null, identities, evidenceFamily: null,
  });
  const extract = async () => ({mentions: [{
    name: 'Robin', summary: 'Another date with Robin', quote, eventDate: '2026-09-01', correspondent: true,
  }]});
  const upload = async (text = quote, version = 1) => {
    await acceptRecord(userId, stateId, envelope(text, version));
    await processSource(userId, stateId, {extract});
  };

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({data: {id: userId, email: `${userId}@example.invalid`}});
    stateId = (await prisma.datingSourceState.create({data: {userId, source: 'ecpad', enabled: true}})).id;
  });
  afterEach(async () => { await prisma.user.deleteMany({where: {id: userId}}); });
  afterAll(() => prisma.$disconnect());

  it('does not resurface dismissed evidence after an unrelated edit and exact reversion', async () => {
    await upload();
    const candidate = (await listReview(userId)).candidates[0];
    await reviewCandidate(userId, candidate.id, {action: 'dismiss', fingerprint: candidate.fingerprint});
    await upload(`${quote} An unrelated sentence changed.`, 2);
    expect((await listReview(userId)).candidates).toHaveLength(0);
    await upload(quote, 3);
    expect((await listReview(userId)).candidates).toHaveLength(0);
    expect(await prisma.datingSuggestion.count({where: {userId, status: 'pending'}})).toBe(0);
    // The decision survives even though superseded source suggestion rows were removed.
    expect((await prisma.datingCandidate.findUniqueOrThrow({where: {id: candidate.id}})).reviewedFingerprint).toBeTruthy();
  });

  it('keeps a corrected event and its conflict provenance through A to B to A', async () => {
    await upload();
    const candidate = (await listReview(userId)).candidates[0];
    await reviewCandidate(userId, candidate.id, {action: 'add', fingerprint: candidate.fingerprint, draft: {name: 'Robin'}});
    const event = await prisma.datingEvent.findFirstOrThrow({where: {userId}});
    await prisma.datingEvent.update({where: {id: event.id}, data: {notes: 'My correction: a different event.'}});
    for (const [text, version] of [[`${quote} An unrelated sentence changed.`, 2], [quote, 3]] as const) {
      await upload(text, version);
      expect(await prisma.datingEvent.count({where: {userId}})).toBe(1);
      const preserved = await prisma.datingEvent.findUniqueOrThrow({where: {id: event.id}, include: {sourceRecord: true}});
      expect(preserved.notes).toBe('My correction: a different event.');
      expect(preserved.machineContentHash).toBe('conflict');
      expect(preserved.sourceRecord?.externalId).toBe('journal');
    }
  });

  it('keeps overlapping unreviewed evidence visible and approves both into one profile', async () => {
    await prisma.datingSourceState.update({where: {id: stateId}, data: {source: 'texts'}});
    await acceptRecord(userId, stateId, envelope(quote, 1, 'phone-thread', ['+15555550101']));
    await acceptRecord(userId, stateId, envelope(quote, 1, 'email-thread', ['robin@example.invalid']));
    await processSource(userId, stateId, {extract});
    const initial = (await listReview(userId)).candidates;
    expect(initial).toHaveLength(2);
    const first = initial[0];
    const added = await reviewCandidate(userId, first.id, {
      action: 'add', fingerprint: first.fingerprint,
      draft: {name: 'Robin', handles: ['+15555550101', 'robin@example.invalid']},
    });
    const remaining = (await listReview(userId)).candidates;
    expect(remaining).toHaveLength(1);
    const linked = await reviewCandidate(userId, remaining[0].id, {
      action: 'add', fingerprint: remaining[0].fingerprint, draft: {name: 'Robin'},
    });
    expect(linked.personId).toBe(added.personId);
    expect(await prisma.datingPerson.count({where: {userId}})).toBe(1);
    expect(await prisma.datingSuggestion.count({where: {userId, personId: added.personId, status: 'added'}})).toBe(2);
  });

  it('rejects a delayed request authenticated before token rotation under the owner lock', async () => {
    const firstCode = await createPairing(userId);
    const first = await claimPairing(firstCode.code, 'library-regression-scope');
    const authenticated = await connector(new Request('https://example.invalid', {
      headers: {Authorization: `Bearer ${first.token}`},
    }));
    const nextCode = await createPairing(userId);
    await claimPairing(nextCode.code, 'library-regression-scope');
    await expect(acceptRecord(userId, first.stateId, envelope(), authenticated.tokenHash!)).rejects.toMatchObject({status: 401});
    await expect(acceptManifest(userId, first.stateId, {
      version: 1, generation: 1, complete: true, documents: [], unavailableIds: [],
    }, authenticated.tokenHash!)).rejects.toMatchObject({status: 401});
    expect(await prisma.datingSourceRecord.count({where: {userId, stateId: first.stateId}})).toBe(0);
  });

  it('does not turn retention cleanup into a new successful source scan', async () => {
    const scannedAt = new Date('2026-09-01T12:00:00Z');
    await prisma.datingSourceState.update({where: {id: stateId}, data: {
      manifest: {complete: true}, lastAttemptAt: scannedAt, lastSuccessAt: scannedAt, status: 'up_to_date',
    }});
    await cleanupSource(userId, stateId, new Date('2026-09-28T12:00:00Z'));
    const state = await prisma.datingSourceState.findUniqueOrThrow({where: {id: stateId}});
    expect(state.lastAttemptAt).toEqual(scannedAt);
    expect(state.lastSuccessAt).toEqual(scannedAt);
  });

  it('restores the overlapping alias group that an exclusion suppressed', async () => {
    // Existing separate source candidates can acquire overlapping verified aliases during review.
    const first = await prisma.datingCandidate.create({data: {
      userId, identityKey: 'source:regression-phone', name: 'Robin', identities: ['+15555550101', 'robin@example.invalid'],
    }});
    const second = await prisma.datingCandidate.create({data: {
      userId, identityKey: 'source:regression-email', name: 'Robin', identities: ['robin@example.invalid'],
    }});
    await reviewCandidate(userId, first.id, {action: 'exclude', fingerprint: fingerprint([])});
    expect((await listReview(userId)).excluded).toHaveLength(2);
    await reviewCandidate(userId, second.id, {action: 'restore', fingerprint: fingerprint([])});
    expect((await listReview(userId)).excluded).toHaveLength(0);
    const statuses = await prisma.datingCandidate.findMany({where: {userId}, select: {status: true}});
    expect(statuses.every(candidate => candidate.status === 'dismissed')).toBe(true);
  });
});
