/**
 * PHASE 5 -- call recording.
 *
 * The PRD said "calls are not recorded in MVP; the data model leaves room for a
 * recording reference IF THE POLICY CHANGES LATER". Phase 5 is that policy
 * change, and this suite is what keeps it narrow.
 *
 * Every test here is a boundary. A normal call cannot be recorded even by
 * somebody who may record; a recording cannot be heard by somebody who was ON
 * the call; an expired recording is unplayable; and nobody unauthorized can
 * even learn that a recording exists.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CallMode, RecordingStatus } from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

const directThread = async () =>
  (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;

/** A follow-up call, recorded and completed: the ordinary happy path. */
async function recordedCall(): Promise<{ callId: string; recordingId: string }> {
  const conversationId = await directThread();
  const { callId } = await g.calls.start(conversationId, s.ownerId, {
    mode: CallMode.FOLLOW_UP,
  });
  await g.calls.accept(callId, s.parentId);
  const { recording } = await g.recordings.start(callId, s.ownerId);
  await g.recordings.complete(callId, {
    durationSeconds: 42,
    byteSize: 1024,
    actorId: s.ownerId,
  });
  return { callId, recordingId: recording.id };
}

describe('the two call modes', () => {
  it('a call defaults to NORMAL, so a dropped flag never yields a recording', async () => {
    const conversationId = await directThread();
    const started = await g.calls.start(conversationId, s.ownerId);
    expect(started.mode).toBe(CallMode.NORMAL);
  });

  it('a NORMAL call cannot be recorded, even by somebody who holds calls.record', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await expect(g.recordings.start(callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_PERMITTED_FOR_MODE,
    });
  });

  it('the DATABASE refuses a recording of a normal call, not just the service', async () => {
    // Defence in depth: a bug in RecordingService must not be able to produce a
    // recording of a call whose participants were never told it was recorded.
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.call_recording (call_id, object_key, status, started_by)
         values ('${callId}'::uuid, 'recordings/forced', 'pending', '${s.ownerId}'::uuid)`,
      ),
    ).rejects.toThrow(/follow_up/);
  });

  it('a FOLLOW-UP call can be recorded', async () => {
    const { recordingId } = await recordedCall();
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(row.status).toBe(RecordingStatus.AVAILABLE);
    expect(row.durationSeconds).toBe(42);
  });

  it('refuses a follow-up call to somebody without calls.record', async () => {
    const conversationId = await directThread();
    // A parent holds calls.start but never calls.record.
    await expect(
      g.calls.start(conversationId, s.parentId, { mode: CallMode.FOLLOW_UP }),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });
});

describe('retention', () => {
  it('an available recording always carries an expiry -- nothing is kept by omission', async () => {
    const { recordingId } = await recordedCall();
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(row.retentionExpiresAt).not.toBeNull();
    expect(row.retentionExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('the DATABASE refuses an available recording with no expiry', async () => {
    const { recordingId } = await recordedCall();
    await expect(
      prisma.$executeRawUnsafe(
        `update chat.call_recording set retention_expires_at = null where id = '${recordingId}'::uuid`,
      ),
    ).rejects.toThrow();
  });

  it('the sweep deletes an expired recording and tombstones the row', async () => {
    const { recordingId } = await recordedCall();
    await prisma.callRecording.updateMany({
      where: { id: recordingId },
      data: { retentionExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await g.recordings.sweepExpired()).toBe(1);

    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(row.status).toBe(RecordingStatus.DELETED);
    // The key goes with the audio: leaving it would keep the object addressable
    // by anyone who can read this table.
    expect(row.objectKey).toBeNull();
    expect(row.deletedReason).toBe('retention period elapsed');
    // The ROW survives -- "there was a recording and it was deleted on this
    // date" is a fact the academy has to be able to state.
    expect(row.callId).toBeDefined();
  });

  it('the sweep is idempotent', async () => {
    const { recordingId } = await recordedCall();
    await prisma.callRecording.updateMany({
      where: { id: recordingId },
      data: { retentionExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await g.recordings.sweepExpired()).toBe(1);
    expect(await g.recordings.sweepExpired()).toBe(0);
  });
});

describe('playback authorization', () => {
  it('an authorized supervisor gets a short-lived URL', async () => {
    const { recordingId } = await recordedCall();
    const playback = await g.recordings.playback(recordingId, s.ownerId);

    expect(playback.url).toContain('sig=');
    expect(new Date(playback.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(playback.durationSeconds).toBe(42);
  });

  it('a PARTICIPANT of the call cannot play it back', async () => {
    // The rule stated plainly: everyone on a call heard it, and the right to
    // have been present is not the right to keep a copy of somebody else's
    // voice. The parent was ON this call.
    const { recordingId } = await recordedCall();
    await expect(g.recordings.playback(recordingId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('a supervisor of ANOTHER family gets NOT FOUND, never FORBIDDEN', async () => {
    // Distinguishing them would turn this route into an oracle: probe ids, and
    // the ones answering "forbidden" are the calls that were recorded.
    const { recordingId } = await recordedCall();
    await expect(g.recordings.playback(recordingId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_FOUND,
    });
  });

  it('a forged recording id is NOT FOUND', async () => {
    await expect(g.recordings.playback(randomUUID(), s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_FOUND,
    });
  });

  it('an expired recording is refused even before the sweep reaches it', async () => {
    // A retention policy enforced only by a cron job has a gap the length of
    // the cron interval.
    const { recordingId } = await recordedCall();
    await prisma.callRecording.updateMany({
      where: { id: recordingId },
      data: { retentionExpiresAt: new Date(Date.now() - 1000) },
    });

    await expect(g.recordings.playback(recordingId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_EXPIRED,
    });
  });

  it('a deleted recording is gone, not merely hidden', async () => {
    const { recordingId } = await recordedCall();
    await g.recordings.delete(recordingId, s.ownerId, 'requested by the family');

    await expect(g.recordings.playback(recordingId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_EXPIRED,
    });
  });

  it('a pending recording has nothing to play', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId, {
      mode: CallMode.FOLLOW_UP,
    });
    const { recording } = await g.recordings.start(callId, s.ownerId);

    await expect(g.recordings.playback(recording.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_AVAILABLE,
    });
  });
});

describe('discoverability', () => {
  it('call history tells an unauthorized reader nothing about a recording', async () => {
    const { callId } = await recordedCall();
    const conversationId = (
      await prisma.call.findUniqueOrThrow({ where: { id: callId } })
    ).conversationId;

    const asParent = await g.calls.history(conversationId, s.parentId);
    const row = asParent.find((c) => c.id === callId)!;
    // FALSE rather than absent: a field that appears only for authorized
    // readers is itself the signal being protected.
    expect(row.hasRecording).toBe(false);

    const asSupervisor = await g.calls.history(conversationId, s.ownerId);
    expect(asSupervisor.find((c) => c.id === callId)!.hasRecording).toBe(true);
  });

  it('metadata is refused to an unauthorized reader', async () => {
    const { recordingId } = await recordedCall();
    await expect(g.recordings.get(recordingId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_FOUND,
    });
  });

  it('no read path ever returns a stored URL', async () => {
    const { recordingId } = await recordedCall();
    const view = await g.recordings.get(recordingId, s.ownerId);
    expect(JSON.stringify(view)).not.toContain('http');
    expect(view).not.toHaveProperty('objectKey');
  });
});

describe('the audit trail', () => {
  const auditFor = (action: string) =>
    prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'desc' } });

  it('records starting, completing and playing back', async () => {
    const { recordingId } = await recordedCall();
    await g.recordings.playback(recordingId, s.ownerId);

    expect((await auditFor('recording.started')).length).toBeGreaterThan(0);
    expect((await auditFor('recording.completed')).length).toBeGreaterThan(0);
    expect((await auditFor('recording.playback')).length).toBeGreaterThan(0);
  });

  it('records a REFUSED playback -- "who tried to listen" is the point', async () => {
    const { recordingId } = await recordedCall();
    await expect(g.recordings.playback(recordingId, s.parentId)).rejects.toThrow();

    const refusals = await auditFor('recording.playback_refused');
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals[0].actorId).toBe(s.parentId);
  });

  it('never writes the signed URL into the audit log', async () => {
    // An audit log that stores the capability it is auditing hands a copy to
    // everyone who may read it.
    const { recordingId } = await recordedCall();
    await g.recordings.playback(recordingId, s.ownerId);

    const entries = await auditFor('recording.playback');
    expect(JSON.stringify(entries[0].after)).not.toContain('sig=');
    expect(JSON.stringify(entries[0].after)).not.toContain('http');
  });

  it('records deletion with the reason that was given', async () => {
    const { recordingId } = await recordedCall();
    await g.recordings.delete(recordingId, s.ownerId, 'family requested erasure');

    const entries = await auditFor('recording.deleted');
    expect(entries[0].reason).toBe('family requested erasure');
  });

  it('refuses a deletion with no reason', async () => {
    const { recordingId } = await recordedCall();
    await expect(g.recordings.delete(recordingId, s.ownerId, '  ')).rejects.toMatchObject({
      code: CommErrorCode.APPROVAL_REASON_REQUIRED,
    });
  });
});

describe('idempotency', () => {
  it('completing twice does not restart retention', async () => {
    const { callId, recordingId } = await recordedCall();
    const first = await prisma.callRecording.findUniqueOrThrow({ where: { id: recordingId } });

    await g.recordings.complete(callId, {
      durationSeconds: 99,
      byteSize: 2048,
      actorId: s.ownerId,
    });

    const second = await prisma.callRecording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(second.retentionExpiresAt).toEqual(first.retentionExpiresAt);
    expect(second.durationSeconds).toBe(42);
  });

  it('refuses a second recording for the same call', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId, {
      mode: CallMode.FOLLOW_UP,
    });
    await g.recordings.start(callId, s.ownerId);

    await expect(g.recordings.start(callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_ALREADY_EXISTS,
    });
  });
});
