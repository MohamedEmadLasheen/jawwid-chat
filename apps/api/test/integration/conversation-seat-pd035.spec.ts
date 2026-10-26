/**
 * PD-35 part 1 -- the visible seat (chat.conversation_seat), the one primitive
 * every "join by choice" feature uses.
 *
 *   1. a seat whose reason grants access gives the WEAKEST basis, 'seated',
 *      visibly (line, audit, membership event) and only while it holds: lost
 *      eligibility ends access at once; the sweep then ends the seat (RT-009)
 *   2. precedence: a PD-8 basis outranks a seat -- a manager seated by a
 *      mention is still 'manager'
 *   3. 'manual' needs the joiner's own standing; nobody joins twice
 *   4. a reconcile (syncStudentGroup) and a PD-31 transfer never evict a seat
 *   5. PD-24: a seat holder who becomes the group's supervisor keeps the row,
 *      the seat absorbed; other seats survive the swap
 *   6. leave: RT-009 only for a holder left with no access
 *   7. idle: writing keeps a seat; idle_days of silence end it
 *   8. a family 1:1 takes an EFFECTIVE seat (no member row) whose holder is
 *      notified; a reason that grants access is never taken in a 1:1
 *   9. the database guards the tables
 *
 * The reason that grants access is a TEST-ONLY one ('spec_grant'), registered
 * here: PD-35's own 'supervision' policy lands with the teacher assignment.
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import type { RealtimeRevocation } from '@platform/realtime-revocation';
import { ConversationSeatService } from '@communication/seats/conversation-seat.service';
import { SeatPolicyRegistry, SeatReason } from '@communication/seats/seat-policy';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { activateBackup, buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const SPEC_REASON = 'spec_grant';

/** RT-009 as the seat service drives it, recorded. */
const evictions: Array<{ actors: readonly string[]; conversationId: string }> = [];
let confirms = 0;
const revocation: RealtimeRevocation = {
  leaveConversation: (actors, conversationId) => void evictions.push({ actors, conversationId }),
  disconnectSessions: () => undefined,
  disconnectAccount: () => undefined,
  sessionRotated: () => undefined,
  confirmRevoked: async () => void (confirms += 1),
};

const registry = new SeatPolicyRegistry();
const seats = new ConversationSeatService(g.prisma, g.authz, g.conversations, g.outbox, registry, audit, revocation);
registry.register({
  reason: SPEC_REASON,
  canJoin: async (actor, conv) => {
    const [row] = await g.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.pd035_spec_allowed(${actor.actorId}::uuid, ${conv.id}::uuid, now()) AS ok`;
    return row?.ok
      ? { allowed: true, onBehalfMode: null, moderation: 'published' }
      : { allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, reason: 'conversation not found' };
  },
  roleLabel: () => 'teacher_supervisor',
});

jest.setTimeout(120_000);

let s: Scenario;
let groupId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const actor = (id: string) => g.conversations.requireActor(id);
const access = async (staffId: string, conversationId: string) =>
  (await g.prisma.$queryRaw<Array<{ basis: string | null }>>`
    SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid, now()) AS basis`)[0].basis;
const allow = (staffId: string, conversationId: string) =>
  g.prisma.$executeRaw`INSERT INTO chat.pd035_spec_allow (staff_id, conversation_id) VALUES (${staffId}::uuid, ${conversationId}::uuid)`;
const disallow = (staffId: string) => g.prisma.$executeRaw`DELETE FROM chat.pd035_spec_allow WHERE staff_id = ${staffId}::uuid`;
const liveMember = (conversationId: string, actorId: string) =>
  g.prisma.conversationMember.findFirst({ where: { conversationId, actorId, leftAt: null } });
const seatRow = async (conversationId: string, staffId: string) =>
  (await g.prisma.$queryRaw<Array<{ left_kind: string | null; member_id: string | null; last_active_at: Date | null }>>`
    SELECT left_kind, member_id::text, last_active_at FROM chat.conversation_seat
     WHERE conversation_id = ${conversationId}::uuid AND staff_id = ${staffId}::uuid
     ORDER BY joined_at DESC LIMIT 1`)[0];
const lines = async (conversationId: string) =>
  (await g.prisma.message.findMany({ where: { conversationId, authorType: 'system' }, orderBy: { seq: 'asc' } }))
    .map((m) => JSON.parse(m.body ?? '{}') as Record<string, unknown>)
    .filter((b) => String(b.kind).startsWith('seat.'));

beforeAll(async () => {
  await g.prisma.$connect();
  // The test-only reason: granting, with an allow-list the cases edit.
  await g.prisma.$executeRawUnsafe(`
    create table if not exists chat.pd035_spec_allow (staff_id uuid not null, conversation_id uuid not null)`);
  await g.prisma.$executeRawUnsafe(`
    create or replace function chat.pd035_spec_allowed(p_staff uuid, p_conversation uuid, p_at timestamptz)
    returns boolean language sql stable as $$
      select exists (select 1 from chat.pd035_spec_allow a where a.staff_id = p_staff and a.conversation_id = p_conversation)
    $$`);
  await g.prisma.$executeRawUnsafe(`
    insert into chat.seat_reason (reason, grants_access, allowed_in_direct, eligibility_fn, idle_days)
    values ('${SPEC_REASON}', true, false, 'chat.pd035_spec_allowed(uuid, uuid, timestamptz)'::regprocedure, 14)
    on conflict (reason) do nothing`);
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.seat_reason where reason = '${SPEC_REASON}'`);
  await g.prisma.$executeRawUnsafe(`drop function if exists chat.pd035_spec_allowed(uuid, uuid, timestamptz)`);
  await g.prisma.$executeRawUnsafe(`drop table if exists chat.pd035_spec_allow`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`truncate chat.pd035_spec_allow`);
  evictions.length = 0;
  confirms = 0;
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

// ---------------------------------------------------------------------------

describe('1. a seat that grants access', () => {
  it('gives the weakest basis, visibly, and only while it holds', async () => {
    // admin_b supervises other children: no PD-8 basis on this group.
    expect(await access(s.otherAdminId, groupId)).toBeNull();
    expect(await code(seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON }))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);

    await allow(s.otherAdminId, groupId);
    const seat = await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON, note: 'helping with reports' });
    expect(seat).toMatchObject({ conversationId: groupId, reason: SPEC_REASON, effective: false });
    expect(await access(s.otherAdminId, groupId)).toBe('seated');
    const visible = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM chat.staff_visible_conversation_ids(${s.otherAdminId}::uuid, now()) AS id`;
    expect(visible.map((r) => r.id)).toContain(groupId);

    // A real, visible member row -- never a silent presence.
    expect(await liveMember(groupId, s.otherAdminId)).toMatchObject({ memberRole: 'admin', isSilent: false });
    expect(await lines(groupId)).toEqual([{ kind: 'seat.joined', name: 'admin_b', role: 'teacher_supervisor', reason: SPEC_REASON }]);
    const events = await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.some((e) => e.type === 'message.created' && (e.payload as Record<string, unknown>).silent === true)).toBe(true);
    expect(events.some((e) => e.type === 'conversation.membership_changed'
      && ((e.payload as { added?: string[] }).added ?? []).includes(s.otherAdminId))).toBe(true);
    expect(await g.prisma.auditLog.count({ where: { action: 'seat.joined', entityId: groupId, reason: 'helping with reports' } })).toBe(1);

    // Idempotent.
    expect((await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON })).seatId).toBe(seat.seatId);

    // Lost eligibility ends access AT ONCE, before any sweep.
    await disallow(s.otherAdminId);
    expect(await access(s.otherAdminId, groupId)).toBeNull();
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBeNull();

    expect(await seats.sweep()).toBe(1);
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBe('ineligible');
    expect(await liveMember(groupId, s.otherAdminId)).toBeNull();
    expect((await lines(groupId)).at(-1)).toEqual({ kind: 'seat.left', name: 'admin_b', ended: 'ineligible', reason: SPEC_REASON });
    expect(evictions).toEqual([{ actors: [s.otherAdminId], conversationId: groupId }]);
    expect(confirms).toBe(1);
    expect(await seats.sweep()).toBe(0);
  });
});

describe('2. precedence', () => {
  it('a manager seated by a mention is still the manager; the seat adds presence only', async () => {
    expect(await access(s.managerId, groupId)).toBe('manager');
    // PD-36's policy stands in: mentioned + standing.
    const local = new SeatPolicyRegistry();
    const withMention = new ConversationSeatService(g.prisma, g.authz, g.conversations, g.outbox, local, audit, revocation);
    expect(await code(withMention.join(await actor(s.managerId), groupId, { reason: SeatReason.MENTION }))).toBe(CommErrorCode.SEAT_NOT_ELIGIBLE);
    local.register({
      reason: SeatReason.MENTION,
      canJoin: (_a, _c, ctx) => ctx.standing
        ? { allowed: true, onBehalfMode: null, moderation: 'published' }
        : { allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, reason: 'conversation not found' },
    });
    expect(() => local.register({ reason: SeatReason.MENTION, canJoin: () => ({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE, reason: 'x' }) }))
      .toThrow(/already registered/);

    await withMention.join(await actor(s.managerId), groupId, { reason: SeatReason.MENTION });
    expect(await access(s.managerId, groupId)).toBe('manager');
    // Even holding a seat whose reason grants access.
    await allow(s.managerId, groupId);
    expect(await access(s.managerId, groupId)).toBe('manager');
    expect((await lines(groupId))[0]).toMatchObject({ kind: 'seat.joined', name: 'manager_c', role: 'manager', reason: 'mention' });
  });

  it('a seated person writes as a party but moderates nobody', async () => {
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    const sent = await g.messages.send({ conversationId: groupId, senderId: s.otherAdminId, body: 'Hello, I am here to help.' });
    expect(sent).toMatchObject({ onBehalfMode: 'owner' });
    expect(g.authz.moderatableAuthorKinds(await actor(s.otherAdminId), 'seated')).toEqual([]);
    expect(g.authz.canApprove(await actor(s.otherAdminId), 'seated').allowed).toBe(false);
  });
});

describe('3. a manual seat', () => {
  it('needs the joiner\'s own standing, and a member in their own right has no seat to take', async () => {
    expect(await code(seats.join(await actor(s.otherAdminId), groupId, { reason: SeatReason.MANUAL }))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    expect(await code(seats.join(await actor(s.ownerId), groupId, { reason: SeatReason.MANUAL }))).toBe(CommErrorCode.SEAT_ALREADY_MEMBER);
    expect(await code(seats.join(await actor(s.managerId), groupId, { reason: 'nonsense' }))).toBe(CommErrorCode.SEAT_REASON_UNKNOWN);
    expect(await code(seats.join(await actor(s.parentId), groupId, { reason: SeatReason.MANUAL }))).toBe(CommErrorCode.SEAT_NOT_ELIGIBLE);
    expect(await code(seats.join(await actor(s.managerId), '00000000-0000-4000-8000-000000000000', { reason: SeatReason.MANUAL })))
      .toBe(CommErrorCode.CONVERSATION_NOT_FOUND);

    const seat = await seats.join(await actor(s.managerId), groupId, { reason: SeatReason.MANUAL });
    expect(seat.effective).toBe(false);
    expect((await seats.mine(await actor(s.managerId))).seats.map((x) => x.conversationId)).toEqual([groupId]);
  });
});

describe('4. nothing evicts a live seat but the seat service', () => {
  it('survives the Student Group reconcile and a PD-31 change of teacher', async () => {
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    const member = await liveMember(groupId, s.otherAdminId);

    await g.conversations.syncStudentGroup(s.learnerId, s.ownerId);
    expect((await liveMember(groupId, s.otherAdminId))?.id).toBe(member?.id);
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBeNull();

    await g.prisma.$queryRawUnsafe(
      `select * from chat.transfer_learner($1::uuid, $2::uuid, 'other', null, null, $3::uuid)`,
      s.learnerId, s.newTeacherId, s.ownerId,
    );
    expect((await liveMember(groupId, s.otherAdminId))?.id).toBe(member?.id);
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBeNull();
    expect(await access(s.otherAdminId, groupId)).toBe('seated');
  });
});

describe('5. PD-24 supervisor swap', () => {
  it('a seat holder who becomes the supervisor keeps the row, the seat absorbed; other seats survive', async () => {
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    await seats.join(await actor(s.managerId), groupId, { reason: SeatReason.MANUAL });
    const row = await liveMember(groupId, s.otherAdminId);

    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE chat.learner_supervision SET supervisor_id = ${s.otherAdminId}::uuid WHERE learner_id = ${s.learnerId}::uuid`;
      await g.conversations.reconcileSupervisionChange(tx, s.learnerId, s.ownerId, s.otherAdminId, s.managerId);
    });

    expect((await liveMember(groupId, s.otherAdminId))?.id).toBe(row?.id);
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBe('absorbed');
    expect(await access(s.otherAdminId, groupId)).toBe('responsible');
    expect((await seatRow(groupId, s.managerId)).left_kind).toBeNull();
    expect(await liveMember(groupId, s.managerId)).not.toBeNull();
    // An absorbed seat is not the holder's to leave: the membership is theirs.
    expect(await code(seats.leave(await actor(s.otherAdminId), groupId))).toBe(CommErrorCode.SEAT_NOT_FOUND);
  });
});

describe('6. leave', () => {
  it('evicts (RT-009) only a holder left with no access', async () => {
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    await seats.join(await actor(s.managerId), groupId, { reason: SeatReason.MANUAL });

    await seats.leave(await actor(s.managerId), groupId);
    expect(evictions).toEqual([]);
    expect(await access(s.managerId, groupId)).toBe('manager');
    expect(await liveMember(groupId, s.managerId)).toBeNull();

    await seats.leave(await actor(s.otherAdminId), groupId);
    expect(evictions).toEqual([{ actors: [s.otherAdminId], conversationId: groupId }]);
    expect(confirms).toBe(1);
    expect(await access(s.otherAdminId, groupId)).toBeNull();
    expect((await lines(groupId)).filter((l) => l.kind === 'seat.left').map((l) => l.name)).toEqual(['manager_c', 'admin_b']);
    expect(await g.prisma.auditLog.count({ where: { action: 'seat.left', entityId: groupId } })).toBe(2);
    expect(await code(seats.leave(await actor(s.otherAdminId), groupId))).toBe(CommErrorCode.SEAT_NOT_FOUND);
  });
});

describe('7. idle', () => {
  it('writing keeps a seat; the reason\'s idle days of silence end it', async () => {
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    expect((await seatRow(groupId, s.otherAdminId)).last_active_at).toBeNull();

    await g.messages.send({ conversationId: groupId, senderId: s.otherAdminId, body: 'Checking in on the reports.' });
    expect((await seatRow(groupId, s.otherAdminId)).last_active_at).not.toBeNull();
    expect(await seats.sweep()).toBe(0);

    await g.prisma.$executeRaw`
      UPDATE chat.conversation_seat SET last_active_at = now() - interval '15 days'
       WHERE staff_id = ${s.otherAdminId}::uuid AND left_at IS NULL`;
    expect(await seats.sweep()).toBe(1);
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBe('idle');
    expect((await lines(groupId)).at(-1)).toEqual({ kind: 'seat.left', name: 'admin_b', ended: 'idle', reason: SPEC_REASON });
  });
});

describe('8. a family 1:1', () => {
  it('takes an effective seat, notified like a member; a reason that grants access is refused there', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(direct.familyId).toBe(s.familyId);

    await allow(s.otherAdminId, direct.id);
    expect(await code(seats.join(await actor(s.otherAdminId), direct.id, { reason: SPEC_REASON }))).toBe(CommErrorCode.SEAT_NOT_ALLOWED_HERE);

    const seat = await seats.join(await actor(s.managerId), direct.id, { reason: SeatReason.MANUAL });
    expect(seat.effective).toBe(true);
    expect(await liveMember(direct.id, s.managerId)).toBeNull();
    expect(await g.prisma.conversationMember.count({ where: { conversationId: direct.id, leftAt: null } })).toBe(2);
    expect(await lines(direct.id)).toEqual([{ kind: 'seat.stepped_in', name: 'manager_c', role: 'manager', reason: 'manual' }]);

    await g.messages.send({ conversationId: direct.id, senderId: s.parentId, body: 'Can someone help?' });
    await g.outboxWorker.drain(100);
    const pushes = await g.prisma.notification.findMany({ where: { recipientId: s.managerId, ruleKey: 'new_message' } });
    // The parent's message reaches the manager; the silent seat line reached nobody.
    expect(pushes).toHaveLength(1);

    await seats.leave(await actor(s.managerId), direct.id);
    expect(evictions).toEqual([]);
  });
});

describe('9. the database guards the tables', () => {
  it('refuses a deleted, re-written or borrowed seat, and a malformed reason', async () => {
    await allow(s.otherAdminId, groupId);
    const seat = await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });

    await expect(g.prisma.$executeRaw`DELETE FROM chat.conversation_seat WHERE id = ${seat.seatId}::uuid`).rejects.toThrow(/never deleted/);
    await expect(g.prisma.$executeRaw`UPDATE chat.conversation_seat SET reason = 'manual' WHERE id = ${seat.seatId}::uuid`)
      .rejects.toThrow(/only a seat's activity and its end change/);
    // Someone else's member row is not a seat.
    const ownerRow = await liveMember(groupId, s.ownerId);
    await expect(g.prisma.$executeRaw`
      INSERT INTO chat.conversation_seat (organization_id, conversation_id, staff_id, reason, member_id)
      VALUES (chat.default_organization_id(), ${groupId}::uuid, ${s.managerId}::uuid, 'manual', ${ownerRow?.id}::uuid)`)
      .rejects.toThrow(/own live, visible member row/);
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.seat_reason (reason, eligibility_fn) values ('spec_bad', 'chat.academy_today()'::regprocedure)`,
    )).rejects.toThrow(/takes \(uuid, uuid, timestamptz\) and returns boolean/);

    // A member row ended by a membership edit ends the seat it carried.
    await g.prisma.conversationMember.updateMany({ where: { conversationId: groupId, actorId: s.otherAdminId, leftAt: null }, data: { leftAt: new Date() } });
    expect((await seatRow(groupId, s.otherAdminId)).left_kind).toBe('removed');
  });
});

// ---------------------------------------------------------------------------
// Security review of #131 (department head, 2026-10-26): each finding proven
// by a test that failed before its fix.

/** A conversation outside the groups: no learner, so standing is through its live staff members. */
async function ungrouped(type: 'official' | 'class_group', staffId: string): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.conversation (type, title) values ($1, $2) returning id::text as id`, type, `${type}_x`,
  );
  await g.prisma.conversationMember.create({ data: { conversationId: id, actorId: staffId, actorKind: 'staff', memberRole: 'admin' } });
  return id;
}

describe('10. security review', () => {
  it('P1-1a: a seat never props up its own standing -- a backup whose link ends loses an official conversation', async () => {
    const official = await ungrouped('official', s.ownerId);
    const link = await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    expect(await access(s.otherAdminId, official)).toBe('backup');
    await seats.join(await actor(s.otherAdminId), official, { reason: SeatReason.MANUAL });

    await g.prisma.$executeRaw`UPDATE chat.supervisor_backup SET deactivated_at = now() WHERE id = ${link}::uuid`;
    expect(await access(s.otherAdminId, official)).toBeNull();
    expect(await seats.sweep()).toBe(1);
    expect((await seatRow(official, s.otherAdminId)).left_kind).toBe('ineligible');
  });

  it('P1-1b: a seat lends nobody else access -- the seat holder\'s own backup does not reach the conversation', async () => {
    const official = await ungrouped('official', s.ownerId);
    await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    await seats.join(await actor(s.otherAdminId), official, { reason: SeatReason.MANUAL });
    // A third supervisor who backs up otherAdmin, not the owner.
    const third = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'bak_z', 'coverage', true)`, third);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'backup_supervisor')`, third, s.departmentId,
    );
    await activateBackup(g.prisma, s.otherAdminId, third);
    expect(await access(third, official)).toBeNull();
    const visible = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM chat.staff_visible_conversation_ids(${third}::uuid, now()) AS id`;
    expect(visible.map((r) => r.id)).not.toContain(official);
  });

  it('P1-1c: a seated manager stays the manager in a class group, whatever the row order', async () => {
    const klass = await ungrouped('class_group', s.ownerId);
    expect(await access(s.managerId, klass)).toBe('manager');
    await seats.join(await actor(s.managerId), klass, { reason: SeatReason.MANUAL });
    // Put the seat's row first, whichever order the planner reads them in.
    await g.prisma.$executeRaw`
      UPDATE chat.conversation_member SET joined_at = now() - interval '1 day'
       WHERE conversation_id = ${klass}::uuid AND actor_id = ${s.managerId}::uuid`;
    expect(await access(s.managerId, klass)).toBe('manager');
    expect(g.authz.moderatableAuthorKinds(await actor(s.managerId), 'manager')).toContain('staff');
  });

  it('P1-2: a seat never makes its holder an admin who may change membership', async () => {
    // A Teachers-department supervisor who joined after the supervision chat was opened.
    const tmgr = randomUUID();
    const tsup = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_q', 'manager', true), ($2::uuid, 'tsup_q', 'admin', true)`, tmgr, tsup,
    );
    const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
    );
    const chats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
    const [{ org }] = await g.prisma.$queryRaw<Array<{ org: string }>>`SELECT chat.default_organization_id()::text AS org`;
    const conv = await g.prisma.$transaction((tx) => chats.ensureInTx(tx, s.teacherId, org, tmgr));
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, tsup, dept,
    );
    await seats.join(await actor(tsup), conv.id, { reason: SeatReason.MANUAL });
    expect(await code(g.conversations.setMembership(conv.id, tsup, { actorId: s.teacherId, actorKind: 'teacher', memberRole: 'teacher' }, 'remove', 'test')))
      .toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    expect(await g.prisma.conversationMember.count({ where: { conversationId: conv.id, actorId: s.teacherId, leftAt: null } })).toBe(1);
  });

  it('P2-1: leave and absorb never both win -- an absorbed seat\'s member row stays the new supervisor\'s', async () => {
    for (let i = 0; i < 5; i++) {
      await g.prisma.$executeRaw`UPDATE chat.learner_supervision SET supervisor_id = ${s.ownerId}::uuid WHERE learner_id = ${s.learnerId}::uuid`;
      await g.conversations.syncStudentGroup(s.learnerId, s.ownerId);
      await allow(s.otherAdminId, groupId);
      await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
      await Promise.allSettled([
        seats.leave(await actor(s.otherAdminId), groupId),
        g.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE chat.learner_supervision SET supervisor_id = ${s.otherAdminId}::uuid WHERE learner_id = ${s.learnerId}::uuid`;
          await g.conversations.reconcileSupervisionChange(tx, s.learnerId, s.ownerId, s.otherAdminId, s.managerId);
        }),
      ]);
      const [row] = await g.prisma.$queryRaw<Array<{ left_kind: string }>>`
        SELECT left_kind FROM chat.conversation_seat WHERE conversation_id = ${groupId}::uuid AND staff_id = ${s.otherAdminId}::uuid
         ORDER BY joined_at DESC LIMIT 1`;
      const member = await liveMember(groupId, s.otherAdminId);
      // Whichever came first, the new supervisor is a live member of their group.
      expect(row.left_kind === 'left' || row.left_kind === 'absorbed').toBe(true);
      expect(member).not.toBeNull();
      await disallow(s.otherAdminId);
    }
  });

  it('P2-2 / P2-3: a seat holder hears no approvals or internal notes, and nothing at all once the seat stops holding', async () => {
    const delivered: Array<{ users: string[]; type: string }> = [];
    const realtime = { toThread: async () => undefined, toUsers: async (users: string[], type: string) => void delivered.push({ users, type }) };
    const worker = new OutboxWorker(g.prisma, g.notifications, realtime as never, g.identity);
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    await g.prisma.outboxEvent.deleteMany({});

    await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'staff only', visibility: 'internal' });
    await worker.drain(100);
    const internal = delivered.filter((d) => d.type === 'message.created');
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.flatMap((d) => d.users)).not.toContain(s.otherAdminId);

    // P2-3: the seat stops holding; until the sweep its member row is still live.
    await disallow(s.otherAdminId);
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'hello' });
    await worker.drain(100);
    expect(await g.prisma.notification.count({ where: { recipientId: s.otherAdminId } })).toBe(0);
  });

  it('P2-2 / P2-3 through the PD-34 notification pipeline: the same rules for Center entries and pushes', async () => {
    // The harness worker carries the pipeline, as production wires it.
    const worker = g.outboxWorker;
    const holder = { recipientId: s.otherAdminId, groupKey: `conversation:${groupId}` };
    const pushes = () => g.prisma.notification.count({ where: { recipientId: s.otherAdminId, conversationId: groupId } });
    await allow(s.otherAdminId, groupId);
    await seats.join(await actor(s.otherAdminId), groupId, { reason: SPEC_REASON });
    await g.prisma.outboxEvent.deleteMany({});

    // While the seat holds, the holder hears a message: one entry, one push.
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'hello' });
    await worker.drain(100);
    expect(await g.prisma.notificationItem.count({ where: holder })).toBe(1);
    expect(await pushes()).toBe(1);

    // P2-2: an internal note reaches no seat holder through the pipeline either.
    await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'staff only', visibility: 'internal' });
    await worker.drain(100);
    expect((await g.prisma.notificationItem.findFirstOrThrow({ where: holder })).itemCount).toBe(1);
    expect(await pushes()).toBe(1);

    // A second message while the seat holds waits as one trailing push.
    await g.prisma.notification.updateMany({ where: { recipientId: s.otherAdminId, conversationId: groupId }, data: { status: 'sent', sentAt: new Date() } });
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'second' });
    await worker.drain(100);
    expect((await g.prisma.notificationItem.findFirstOrThrow({ where: holder })).itemCount).toBe(2);
    const waiting = await g.prisma.notification.findFirstOrThrow({ where: { recipientId: s.otherAdminId, conversationId: groupId, status: 'scheduled' } });

    // P2-3: the seat stops holding; its member row is still live until the sweep.
    await disallow(s.otherAdminId);
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'again' });
    await worker.drain(100);
    expect((await g.prisma.notificationItem.findFirstOrThrow({ where: holder })).itemCount).toBe(2);
    expect(await pushes()).toBe(2);
    // ...and the push that was already waiting is dropped before it can be sent
    // (review P1: re-authorized at send, against the same audience rule).
    await g.pipeline.guardDueMessages(new Date(), 120_000);
    expect(await g.prisma.notification.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: 'cancelled', failureCode: 'AUDIENCE' });
  });
});
