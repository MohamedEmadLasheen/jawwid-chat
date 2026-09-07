/**
 * PHASE 5 CLOSURE -- the recording actually gets captured.
 *
 * The gap this suite closes: Phase 5 shipped recording METADATA with no
 * pipeline behind it. `start()` minted an upload authorization and created a
 * `pending` row for a media pipeline that did not exist, and nothing in the
 * repository ever moved that row to `available`. Every recording was a row
 * describing audio nobody had captured.
 *
 * These tests assert the seam that closes it: a recorder is ASKED to record,
 * with the server's own room and object key; a failure to start is visible
 * rather than pending; and only the recorder's own completion report makes a
 * recording available.
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
  g.recorder.started.length = 0;
  g.recorder.stopped.length = 0;
  g.recorder.failNextStart = false;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

const directThread = async () =>
  (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;

async function followUpCall() {
  const conversationId = await directThread();
  const started = await g.calls.start(conversationId, s.ownerId, {
    mode: CallMode.FOLLOW_UP,
  });
  await g.calls.accept(started.callId, s.parentId);
  return started;
}

describe('starting a recording asks something to actually record', () => {
  it('hands the recorder the SERVER’s room and object key', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);

    expect(g.recorder.started).toHaveLength(1);
    const request = g.recorder.started[0];
    // The room is the one the SERVER minted at call creation. A client cannot
    // name it and neither can the recorder.
    expect(request.roomName).toBe(started.roomName);
    // The destination is inside the private recordings prefix, never the
    // conversation attachment prefix.
    expect(request.objectKey).toMatch(new RegExp(`^recordings/${started.callId}/`));

    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });
    // The recorder's job id is stored, which is what lets the recording be
    // stopped and what a completion webhook is matched on.
    expect(row.egressId).toBeTruthy();
    expect(row.status).toBe(RecordingStatus.PENDING);
  });

  it('a NORMAL call never reaches the recorder at all', async () => {
    // The mode check happens before anything is asked to record, so a normal
    // call cannot even cause a recording job to be created and then cancelled.
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await expect(g.recordings.start(callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_PERMITTED_FOR_MODE,
    });
    expect(g.recorder.started).toHaveLength(0);
  });

  it('an unauthorized actor never reaches the recorder either', async () => {
    const started = await followUpCall();
    await expect(g.recordings.start(started.callId, s.parentId)).rejects.toThrow();
    expect(g.recorder.started).toHaveLength(0);
  });
});

describe('a recorder that cannot start is VISIBLE, not pending', () => {
  it('marks the recording failed rather than leaving it pending forever', async () => {
    // The defect this prevents: a pending recording reads as "recording in
    // progress" on every surface that shows one, so a recorder that never
    // started would look exactly like one that is working, indefinitely.
    const started = await followUpCall();
    g.recorder.failNextStart = true;

    await expect(g.recordings.start(started.callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_AVAILABLE,
    });

    const row = await prisma.callRecording.findFirstOrThrow({
      where: { callId: started.callId },
    });
    expect(row.status).toBe(RecordingStatus.FAILED);
    expect(row.failureCode).toBe('EGRESS_START_FAILED');
  });

  it('records the failure in the audit trail', async () => {
    const started = await followUpCall();
    g.recorder.failNextStart = true;
    await expect(g.recordings.start(started.callId, s.ownerId)).rejects.toThrow();

    const entries = await prisma.auditLog.findMany({ where: { action: 'recording.failed' } });
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('only the recorder’s own report makes a recording available', () => {
  it('completes from an egress report, and starts retention then', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    const accepted = await g.recordings.completeFromEgress({
      egressId: row.egressId!,
      durationSeconds: 73,
      byteSize: 4096,
      objectKey: `${row.objectKey}.ogg`,
    });

    expect(accepted).toBe(true);
    const done = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });
    expect(done.status).toBe(RecordingStatus.AVAILABLE);
    expect(done.durationSeconds).toBe(73);
    // Egress appends an extension; the key it REPORTS is the one that exists.
    expect(done.objectKey).toBe(`${row.objectKey}.ogg`);
    // Retention starts when the file exists, never before.
    expect(done.retentionExpiresAt).not.toBeNull();
  });

  it('is idempotent -- egress retries its webhooks', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    await g.recordings.completeFromEgress({
      egressId: row.egressId!,
      durationSeconds: 73,
      byteSize: 4096,
    });
    const first = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    await g.recordings.completeFromEgress({
      egressId: row.egressId!,
      durationSeconds: 999,
      byteSize: 9999,
    });
    const second = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    // A second delivery must not restart retention or rewrite the duration.
    expect(second.retentionExpiresAt).toEqual(first.retentionExpiresAt);
    expect(second.durationSeconds).toBe(73);
  });

  it('ignores a report for an egress id it does not know', async () => {
    // A webhook for somebody else's job, or a replay against a wiped database.
    const accepted = await g.recordings.completeFromEgress({
      egressId: `EG_${randomUUID()}`,
      durationSeconds: 10,
      byteSize: 10,
    });
    expect(accepted).toBe(false);
  });

  it('an egress failure marks the recording failed', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    expect(await g.recordings.failFromEgress(row.egressId!, 'EGRESS_ABORTED')).toBe(true);

    const failed = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });
    expect(failed.status).toBe(RecordingStatus.FAILED);
    expect(failed.failureCode).toBe('EGRESS_ABORTED');
  });

  it('a failed recording is not playable', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });
    await g.recordings.failFromEgress(row.egressId!, 'EGRESS_ABORTED');

    await expect(g.recordings.playback(recording.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.RECORDING_NOT_AVAILABLE,
    });
  });
});

describe('ending the call stops the recorder', () => {
  it('stops the egress job that was started for it', async () => {
    const started = await followUpCall();
    const { recording } = await g.recordings.start(started.callId, s.ownerId);
    const row = await prisma.callRecording.findUniqueOrThrow({ where: { id: recording.id } });

    await g.calls.end(started.callId, s.ownerId);
    // The stop is fire-and-forget by design (it must never fail a call), so
    // give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(g.recorder.stopped).toContain(row.egressId);
  });

  it('a call with no recording ends without touching the recorder', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);

    await g.calls.end(callId, s.ownerId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(g.recorder.stopped).toHaveLength(0);
  });
});
