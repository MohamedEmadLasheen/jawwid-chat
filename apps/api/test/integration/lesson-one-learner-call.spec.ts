/**
 * OA-12 (docs/release/app-review-notes-payments.md): ONE LEARNER PER PAID LESSON CALL.
 *
 * The app takes lesson payments outside store billing under Apple 3.1.3(d) and
 * Google Play's 1:1 rule, which hold only for a live service between a teacher
 * and ONE learner. A lesson already names one learner (chat.lesson.learner_id)
 * and a teacher cannot hold two lessons at once
 * (lesson_teacher_is_never_double_booked). What was left open is the CALL: a
 * call carries no lesson id, so nothing stopped the call held in a lesson's
 * window from also seating another child.
 *
 * A child has no account of their own: on a call a learner is present through
 * their family's guardians. So, while one of the teacher's lessons is in its
 * window (the PD-57 lesson-call window), a call that seats the lesson's family
 * may not also seat a guardian of ANOTHER family -- another learner:
 *
 *   - refused at start (and in the capability answer), and when that guardian
 *     answers or asks for media, with COMM.LESSON_ONE_LEARNER;
 *   - a call ALREADY LIVE when the window opens is corrected the next time the
 *     server looks at it: the worker's call sweep, and LiveKit's
 *     participant_joined webhook, take the other family's guardian out of the
 *     media room and off the call (left_at), and tell the call's participants
 *     (call.participant_left with reason one_learner_lesson);
 *   - a guardian taken off who comes back with a media token they still hold
 *     is taken out again at the join; one who asks for a new token is told
 *     COMM.LESSON_ONE_LEARNER while the window is open.
 *
 * The lesson's own parents, the teacher and staff are seated as before; outside
 * every window nothing changes; a family's own sibling group (one family) is
 * unaffected.
 *
 * WHERE THE RULE APPLIES (LR-46 P3-2): calls in the conversations a paid
 * one-to-one lesson is held in -- those anchored to a learner, a learner's
 * Student Group and a family group, as isLessonCall reads them -- and only
 * while a teacher still on the call (no `left_at`) has a lesson in its window.
 * A CLASS GROUP call is a group chat call, never a lesson (a class group has no
 * learner anchor), so a class-group call held near one of its teacher's
 * lessons keeps every family. The class group is written directly (the API
 * has no class-group writer yet), with every trigger on.
 *
 * A lesson conversation holds one family (the family-scope trigger), so the
 * API never seats another family's guardian on its call; the database does not
 * tie a call seat to membership, though, and the rule is the backstop. The
 * two-family lesson call below is that seat written directly (seatOtherFamily),
 * with every trigger on.
 */
import { createHash, randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { CommErrorCode } from '@platform/errors';
import { CallService } from '@communication/calls/call.service';
import type { MediaRoomControl } from '@communication/calls/media-room-control';
import { LiveKitTokenIssuer } from '@communication/calls/media-token';
import { LiveKitWebhookController } from '@communication/api/livekit-webhook.controller';
import { LiveKitWebhookVerifier } from '@communication/calls/livekit-webhook.verifier';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { OutboxService } from '@communication/outbox/outbox.service';
import { CommEvent } from '@communication/contracts/events';
import { CallParticipantLeftReason } from '@communication/contracts/vocab';
import { buildGraph, seed, truncate, withAssignmentGate, type Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const MINUTE = 60_000;
let s: Scenario;
/** learner_l's Student Group: one family. */
let groupId: string;
/** A class group seating BOTH families' guardians, the teacher and the admin. */
let classId: string;
/** A guardian of ANOTHER family, and that family's child. */
let otherFamilyId: string;
let otherGuardianId: string;
let otherLearnerId: string;

/**
 * The media control plane, observed: who was taken out of which room. Like
 * LiveKit, it answers 'absent' for someone already out of the room (until
 * they connect again: `rejoin`).
 */
class FakeRooms implements MediaRoomControl {
  configured = true;
  removed: Array<[string, string]> = [];
  failWith: Error | null = null;
  private out = new Set<string>();
  async removeParticipant(room: string, identity: string): Promise<'removed' | 'absent'> {
    if (this.failWith) throw this.failWith;
    if (this.out.has(`${room}|${identity}`)) return 'absent';
    this.out.add(`${room}|${identity}`);
    this.removed.push([room, identity]);
    return 'removed';
  }
  /** `identity` connects to `room` again (with a media token they still hold). */
  rejoin(room: string, identity: string) {
    this.out.delete(`${room}|${identity}`);
  }
}
/** The production CallService, with the media control plane the application wires. */
const callsWith = (rooms: MediaRoomControl) =>
  new CallService(g.prisma, g.authz, g.conversations, g.outbox, g.config, g.identity, g.audit, new LiveKitTokenIssuer(), rooms);

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId)).id;

  otherFamilyId = randomUUID();
  otherGuardianId = randomUUID();
  otherLearnerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`,
    otherFamilyId, s.ownerId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, 'parent_r', 'primary_guardian', true, true)`,
    otherGuardianId, otherFamilyId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${otherLearnerId}'::uuid, '${otherFamilyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
  classId = await classGroup();
});

/**
 * A class group of teacher_c's: the admin, the teacher, parent_p (family_x)
 * and parent_r (family_y). Triggers on: the family-scope trigger allows a
 * class group to span families, and BR-1 is met (an admin is a member).
 */
async function classGroup(): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.conversation (type, state, family_id, title)
     values ('class_group', 'open', $1::uuid, 'class_x') returning id::text as id`,
    s.familyId,
  );
  for (const [actorId, actorKind, memberRole] of [
    [s.teacherId, 'teacher', 'teacher'],
    [s.ownerId, 'staff', 'admin'],
    [s.parentId, 'contact', 'parent'],
    [otherGuardianId, 'contact', 'parent'],
  ] as const) {
    await g.prisma.conversationMember.create({ data: { conversationId: id, actorId, actorKind, memberRole } });
  }
  return id;
}

/** A lesson of learner_l with teacher_c, `offset` from now, 30 minutes long. */
async function lessonAt(offsetMs: number) {
  return g.prisma.lesson.create({
    data: {
      learnerId: s.learnerId,
      teacherId: s.teacherId,
      createdBy: s.ownerId,
      startsAt: new Date(Date.now() + offsetMs),
      endsAt: new Date(Date.now() + offsetMs + 30 * MINUTE),
    },
    select: { id: true },
  });
}
/** Happening now: started five minutes ago. */
const lessonNow = () => lessonAt(-5 * MINUTE);

/**
 * Closed as the teacher's apology, which closes its call window. The outcome
 * is the lesson writer's (guard_lesson); a fixture stands in for it with
 * triggers off, and the table's CHECK constraints still hold.
 */
async function closeAsApology(lessonId: string) {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `update chat.lesson
          set outcome = 'teacher_apology', outcome_by_kind = 'teacher', outcome_by = $2::uuid, outcome_at = now()
        where id = $1::uuid`,
      lessonId, s.teacherId,
    );
  });
}

/** The call.participant_left events enqueued for one call, oldest first. */
const participantLeftEvents = async (callId: string) =>
  (await g.prisma.outboxEvent.findMany({
    where: { type: CommEvent.CALL_PARTICIPANT_LEFT },
    orderBy: { createdAt: 'asc' },
  }))
    .map((r) => r.payload as Record<string, unknown>)
    .filter((p) => p.callId === callId);

const seatedOn = async (callId: string) =>
  (await g.prisma.callParticipant.findMany({ where: { callId }, select: { actorId: true } })).map((p) => p.actorId);
const seat = (callId: string, actorId: string) =>
  g.prisma.callParticipant.findFirstOrThrow({ where: { callId, actorId } });

/**
 * A seat the API never writes: parent_r (family_y) on a call of learner_l's
 * Student Group (family_x). See the header: the rule is the backstop for it.
 * Every trigger on (BR-1 holds: the admin is on the call).
 */
async function seatOtherFamily(callId: string, opts: { joined: boolean }) {
  await g.prisma.callParticipant.create({
    data: { callId, actorId: otherGuardianId, actorKind: 'contact', joinedAt: opts.joined ? new Date() : null },
  });
}

/**
 * Before any lesson window: a call of learner_l's Student Group -- the
 * conversation the lesson is held in -- that the lesson's parent and teacher
 * answered, with another family's guardian on it too.
 */
async function liveTwoFamilyCall() {
  const call = await g.calls.start(groupId, s.ownerId);
  await g.calls.accept(call.callId, s.parentId);
  await g.calls.accept(call.callId, s.teacherId);
  await seatOtherFamily(call.callId, { joined: true });
  expect((await g.prisma.call.findUniqueOrThrow({ where: { id: call.callId } })).status).toBe('active');
  return call;
}

/** Before any lesson window: a class-group call both families answered and are on. */
async function liveClassCall() {
  const call = await g.calls.start(classId, s.ownerId);
  await g.calls.accept(call.callId, s.parentId);
  await g.calls.accept(call.callId, otherGuardianId);
  await g.calls.accept(call.callId, s.teacherId);
  expect((await g.prisma.call.findUniqueOrThrow({ where: { id: call.callId } })).status).toBe('active');
  return call;
}

/** The teacher's seat closed while the call goes on (no API path does this on a live call today). */
async function teacherLeaves(callId: string) {
  await g.prisma.callParticipant.updateMany({ where: { callId, actorId: s.teacherId }, data: { leftAt: new Date() } });
}

// LiveKit's participant_joined, signed as LiveKit signs it.
async function signedJoin(roomName: string, identity: string) {
  const raw = JSON.stringify({
    event: 'participant_joined',
    createdAt: Math.floor(Date.now() / 1000),
    id: randomUUID(),
    room: { name: roomName, sid: 'RM_x' },
    participant: { identity, name: 'x' },
  });
  const t = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  t.sha256 = createHash('sha256').update(raw).digest('base64');
  return { rawBody: Buffer.from(raw), auth: await t.toJwt() };
}
const webhookWith = (rooms: MediaRoomControl, calls: CallService = callsWith(rooms)) =>
  new LiveKitWebhookController(
    new LiveKitWebhookVerifier(),
    new MediaPresenceService(g.prisma, new OutboxService(), g.config),
    g.prisma,
    rooms,
    calls,
  );

describe('OA-12: one learner per paid lesson call', () => {
  it('a class-group call held in the window of one of its teacher\'s lessons is not a lesson call: every family is kept', async () => {
    // LR-46 P3-2: a class group is a group chat, never the conversation a
    // paid one-to-one lesson is held in.
    await lessonNow();

    await expect(g.calls.callCapability(classId, s.ownerId)).resolves.toEqual({ canCall: true, code: null });
    const { callId, roomName } = await g.calls.start(classId, s.teacherId);
    expect(await seatedOn(callId)).toEqual(expect.arrayContaining([s.parentId, otherGuardianId, s.teacherId]));
    await expect(g.calls.accept(callId, otherGuardianId)).resolves.toBeUndefined();
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, otherGuardianId)).resolves.toMatchObject({ token: expect.any(String) });

    // Neither the sweep nor a join takes anyone off.
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms).webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([]);
    expect((await seat(callId, otherGuardianId)).leftAt).toBeNull();
    expect(await participantLeftEvents(callId)).toEqual([]);
  });

  it('a class-group call already live when the window opens keeps every family', async () => {
    const { callId, roomName } = await liveClassCall();
    await lessonNow();

    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms).webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([]);
    await expect(g.calls.issueToken(callId, otherGuardianId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('a second learner is refused at join: a lesson call begun before the window cannot seat them once it opens', async () => {
    const { callId } = await g.calls.start(groupId, s.ownerId);
    await seatOtherFamily(callId, { joined: false });

    // The lesson's window opens while the call is ringing.
    await lessonNow();

    await expect(g.calls.accept(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    await expect(g.calls.issueToken(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    expect((await seat(callId, otherGuardianId)).joinedAt).toBeNull();

    // The lesson's own parent and its teacher are seated as before.
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.parentId)).resolves.toMatchObject({ token: expect.any(String) });
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
    await expect(g.calls.issueToken(callId, s.ownerId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('the lesson\'s own parents and its teacher may start, answer and join a paid lesson call', async () => {
    await lessonNow();

    const { callId } = await g.calls.start(groupId, s.teacherId);
    expect((await seatedOn(callId)).sort()).toEqual([s.parentId, s.otherParentId, s.teacherId, s.ownerId].sort());
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.accept(callId, s.otherParentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
    await g.calls.end(callId, s.teacherId);

    // A parent may start it too (PD-19).
    const byParent = await g.calls.start(groupId, s.parentId);
    await expect(g.calls.accept(byParent.callId, s.teacherId)).resolves.toBeUndefined();
    await expect(g.calls.callCapability(groupId, s.parentId)).resolves.toEqual({ canCall: true, code: null });
  });

  it('outside every lesson window nothing changes: the class group\'s call seats both families', async () => {
    // Two hours away: the window opens fifteen minutes before the start.
    await lessonAt(2 * 60 * MINUTE);

    const { callId } = await g.calls.start(classId, s.ownerId);
    expect(await seatedOn(callId)).toEqual(expect.arrayContaining([s.parentId, otherGuardianId, s.teacherId]));
    await expect(g.calls.accept(callId, otherGuardianId)).resolves.toBeUndefined();
    await expect(g.calls.callCapability(classId, s.ownerId)).resolves.toEqual({ canCall: true, code: null });

    // And the sweep leaves it alone.
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    expect(rooms.removed).toEqual([]);
  });

  it('a lesson that did not take place opens no window', async () => {
    const { callId } = await liveTwoFamilyCall();
    const lesson = await lessonNow();
    await closeAsApology(lesson.id);

    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    expect((await seat(callId, otherGuardianId)).leftAt).toBeNull();
  });

  it('a family group about several siblings, with no lesson on, is unaffected', async () => {
    const siblings = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId],
      contactIds: [s.parentId, s.otherParentId],
      teacherIds: [s.teacherId, s.newTeacherId],
    });

    const { callId } = await g.calls.start(siblings.id, s.ownerId);
    expect(await seatedOn(callId)).toEqual(expect.arrayContaining([s.parentId, s.otherParentId, s.teacherId]));
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('in a lesson window the family\'s own sibling group still calls: its guardians are the lesson learner\'s guardians', async () => {
    const siblings = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId],
      contactIds: [s.parentId, s.otherParentId],
      teacherIds: [s.teacherId, s.newTeacherId],
    });
    await lessonNow();

    const { callId } = await g.calls.start(siblings.id, s.teacherId);
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.otherParentId)).resolves.toMatchObject({ token: expect.any(String) });

    // The sweep takes nobody off: one family.
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
  });

  it('a teacher no longer on the call opens no window: their lesson does not separate it', async () => {
    // LR-46 P3-2: only a teacher whose seat has no left_at counts.
    const { callId, roomName } = await liveTwoFamilyCall();
    await teacherLeaves(callId);
    await lessonNow();

    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms).webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([]);
    expect((await seat(callId, otherGuardianId)).leftAt).toBeNull();

    // The same call with the teacher still on it is separated (the control).
    await g.prisma.callParticipant.updateMany({ where: { callId, actorId: s.teacherId }, data: { leftAt: null } });
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    expect(rooms.removed).toEqual([[roomName, otherGuardianId]]);
  });

  it('another teacher\'s lesson opens no window on this call', async () => {
    await g.prisma.lesson.create({
      data: {
        learnerId: s.secondLearnerId,
        teacherId: s.newTeacherId,
        createdBy: s.ownerId,
        startsAt: new Date(Date.now() - 5 * MINUTE),
        endsAt: new Date(Date.now() + 25 * MINUTE),
      },
    });

    // teacher_d is not on this call, so this is not teacher_d's lesson call.
    const { callId } = await liveTwoFamilyCall();
    expect(await seatedOn(callId)).not.toContain(s.newTeacherId);
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
  });
});

describe('OA-12: a call already live when the lesson window opens', () => {
  it('the call sweep takes the other family\'s guardian out of the room and off the call; the lesson\'s family, teacher and admin stay', async () => {
    const { callId, roomName } = await liveTwoFamilyCall();
    // The window opens with both families on the call.
    await lessonNow();

    const rooms = new FakeRooms();
    const calls = callsWith(rooms);
    expect(await calls.separateLessonLearners()).toEqual({ removed: 1, failed: 0 });

    expect(rooms.removed).toEqual([[roomName, otherGuardianId]]);
    expect((await seat(callId, otherGuardianId)).leftAt).not.toBeNull();
    for (const stays of [s.parentId, s.teacherId, s.ownerId]) {
      expect((await seat(callId, stays)).leftAt).toBeNull();
    }
    // The call carries on for the lesson.
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('active');
    await expect(calls.issueToken(callId, s.parentId)).resolves.toMatchObject({ token: expect.any(String) });
    // The guardian taken off cannot come back for a new media token, and is
    // told why (their app's rejoin shows the one-learner message, not
    // "connection lost").
    await expect(calls.issueToken(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    await expect(calls.accept(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });

    // Idempotent: the next pass finds nobody.
    expect(await calls.separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    expect(rooms.removed).toHaveLength(1);
  });

  it('the call\'s participants, the removed guardian included, are told who was taken off and why (once)', async () => {
    const { callId } = await liveTwoFamilyCall();
    await lessonNow();
    const calls = callsWith(new FakeRooms());

    expect(await calls.separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    expect(await calls.separateLessonLearners()).toEqual({ removed: 0, failed: 0 });

    expect(await participantLeftEvents(callId)).toEqual([
      { callId, conversationId: groupId, actorId: otherGuardianId, reason: CallParticipantLeftReason.ONE_LEARNER_LESSON },
    ]);
  });

  it('a removal the media server refuses announces nothing', async () => {
    const { callId } = await liveTwoFamilyCall();
    await lessonNow();
    const rooms = new FakeRooms();
    rooms.failWith = new Error('down');

    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 1 });
    expect(await participantLeftEvents(callId)).toEqual([]);
  });

  it('once the window has closed, a guardian taken off reads as having left the call', async () => {
    const { callId } = await liveTwoFamilyCall();
    const lesson = await lessonNow();
    expect(await callsWith(new FakeRooms()).separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    await closeAsApology(lesson.id);

    await expect(g.calls.issueToken(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_PARTICIPANT_LEFT,
    });
  });

  it('a media server that cannot remove them leaves the seat for the next pass, which takes it', async () => {
    const { callId, roomName } = await liveTwoFamilyCall();
    await lessonNow();

    const rooms = new FakeRooms();
    rooms.failWith = Object.assign(new Error('twirp 503'), { name: 'TwirpError' });
    const calls = callsWith(rooms);
    expect(await calls.separateLessonLearners()).toEqual({ removed: 0, failed: 1 });
    expect((await seat(callId, otherGuardianId)).leftAt).toBeNull();

    rooms.failWith = null;
    expect(await calls.separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    expect(rooms.removed).toEqual([[roomName, otherGuardianId]]);
    expect((await seat(callId, otherGuardianId)).leftAt).not.toBeNull();
  });

  it('an ended call is never touched', async () => {
    const { callId } = await liveTwoFamilyCall();
    await g.calls.end(callId, s.ownerId);
    await lessonNow();

    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 0, failed: 0 });
    expect(rooms.removed).toEqual([]);
  });

  it('LiveKit\'s participant_joined re-checks the call: the other family\'s guardian rejoining in the window is taken out at once', async () => {
    const { callId, roomName } = await liveTwoFamilyCall();
    const rooms = new FakeRooms();
    const ctl = webhookWith(rooms);

    // Before the window: the join is left alone.
    let j = await signedJoin(roomName, otherGuardianId);
    await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([]);

    await lessonNow();
    j = await signedJoin(roomName, otherGuardianId);
    await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([[roomName, otherGuardianId]]);
    expect((await seat(callId, otherGuardianId)).leftAt).not.toBeNull();

    // The lesson's own parent joining is left alone.
    j = await signedJoin(roomName, s.parentId);
    await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toHaveLength(1);
    expect((await seat(callId, s.parentId)).leftAt).toBeNull();
  });

  it('a guardian taken off who rejoins with a media token they still hold is taken out again; a guardian still seated is not', async () => {
    // Tokens issued before the window last minutes past it, and LiveKit does
    // not drop a participant whose token later expires. The official app asks
    // for a new token (refused); a modified one could reuse the old one.
    const { callId, roomName } = await liveTwoFamilyCall();
    const lesson = await lessonNow();
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    const ctl = webhookWith(rooms);

    rooms.rejoin(roomName, otherGuardianId);
    let j = await signedJoin(roomName, otherGuardianId);
    await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([[roomName, otherGuardianId], [roomName, otherGuardianId]]);
    // Still off the call, and nobody is told twice.
    expect((await seat(callId, otherGuardianId)).leftAt).not.toBeNull();
    expect(await participantLeftEvents(callId)).toHaveLength(1);

    // And again on every later attempt, even once the window has closed: a
    // participant who has left a live call holds no token issued since.
    await closeAsApology(lesson.id);
    rooms.rejoin(roomName, otherGuardianId);
    j = await signedJoin(roomName, otherGuardianId);
    await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toHaveLength(3);

    // The lesson's own parent, the teacher and the admin -- seated -- are left alone.
    for (const stays of [s.parentId, s.teacherId, s.ownerId]) {
      j = await signedJoin(roomName, stays);
      await expect(ctl.webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    }
    expect(rooms.removed).toHaveLength(3);
  });

  it('if the webhook cannot take a returning guardian out again it answers 503, so LiveKit delivers it again', async () => {
    const { roomName } = await liveTwoFamilyCall();
    await lessonNow();
    const rooms = new FakeRooms();
    expect(await callsWith(rooms).separateLessonLearners()).toEqual({ removed: 1, failed: 0 });
    rooms.failWith = new Error('down');

    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms).webhook({ rawBody: j.rawBody }, j.auth)).rejects.toMatchObject({ status: 503 });
  });

  it('if the webhook cannot take them out it answers 503, so LiveKit delivers it again', async () => {
    const { roomName } = await liveTwoFamilyCall();
    await lessonNow();
    const rooms = new FakeRooms();
    rooms.failWith = new Error('down');

    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms).webhook({ rawBody: j.rawBody }, j.auth)).rejects.toMatchObject({ status: 503 });
  });

  it('a returning participant LiveKit reports already gone is answered "absent", not "removed"', async () => {
    const { roomName } = await liveTwoFamilyCall();
    await lessonNow();
    const rooms = new FakeRooms();
    const calls = callsWith(rooms);
    expect(await calls.separateLessonLearners()).toEqual({ removed: 1, failed: 0 });

    // Out of the room already: nothing was removed.
    expect(await calls.removeReturningParticipant(roomName, otherGuardianId)).toBe('absent');
    // Back in with a token they still held: removed.
    rooms.rejoin(roomName, otherGuardianId);
    expect(await calls.removeReturningParticipant(roomName, otherGuardianId)).toBe('removed');
    // Still seated: untouched.
    expect(await calls.removeReturningParticipant(roomName, s.parentId)).toBe('seated');
    expect(rooms.removed).toEqual([[roomName, otherGuardianId], [roomName, otherGuardianId]]);
  });

  it('a rejoin the webhook checks while the sweep is still taking that guardian off is still taken out', async () => {
    // The sweep empties the room first and writes left_at after. Here the
    // sweep's left_at commits right after the webhook's first look at the
    // call -- the moment a check that saw the seat still open, followed by one
    // that sees it already closed, would let the rejoin through.
    const { callId, roomName } = await liveTwoFamilyCall();
    await lessonNow();
    let committed = false;
    const sweepCommits = async () => {
      if (committed) return;
      committed = true;
      await g.prisma.callParticipant.updateMany({
        where: { callId, actorId: otherGuardianId, leftAt: null },
        data: { leftAt: new Date() },
      });
    };
    class SweepCommitsMidWebhook extends CallService {
      override async separateLessonLearners(opts?: Parameters<CallService['separateLessonLearners']>[0]) {
        const r = await super.separateLessonLearners(opts);
        await sweepCommits();
        return r;
      }
      override async removeReturningParticipant(roomName: string, identity: string) {
        const r = await super.removeReturningParticipant(roomName, identity);
        await sweepCommits();
        return r;
      }
    }
    // The guardian is back in the room (the sweep's removal came before their rejoin).
    const rooms = new FakeRooms();
    const calls = new SweepCommitsMidWebhook(
      g.prisma, g.authz, g.conversations, g.outbox, g.config, g.identity, g.audit, new LiveKitTokenIssuer(), rooms,
    );

    const j = await signedJoin(roomName, otherGuardianId);
    await expect(webhookWith(rooms, calls).webhook({ rawBody: j.rawBody }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([[roomName, otherGuardianId]]);
    expect((await seat(callId, otherGuardianId)).leftAt).not.toBeNull();
  });
});
