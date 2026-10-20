/**
 * RT-032 — what a deactivation written DIRECTLY to the database (Jawwid Core
 * sync, an operator) actually guarantees, surface by surface.
 *
 * No API call, no completion barrier: the row is flipped with SQL, exactly as
 * an out-of-band writer would. Every protected operation that STARTS after the
 * write commits must refuse the actor -- REST (the guard runs
 * AuthService.authenticate), the socket handshake (same method), reads, sends,
 * approvals, calls and media tokens.
 *
 * WHAT THIS FILE DOES NOT CLAIM. RT-032's residual is about an operation that
 * started BEFORE the write: one realtime delivery already authorized under row
 * locks whose database connection dies after its final liveness check. RT-032 is
 * CLOSED (2026-10-14) by journaling every deactivation in its own transaction and
 * completing it with the barrier -- rt032-revocation-journal.spec.ts and the
 * "RT-032" blocks of realtime-revocation.spec.ts. The raw writes below run as the
 * test's superuser, a server-side writer, so they are allowed and journaled.
 */
import { randomUUID } from 'node:crypto';
import { AuthService } from '@platform/auth/auth.service';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, legacyHeldMessage, seed, truncate, Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(60_000);

const g = buildGraph();
const auth = new AuthService(g.prisma, g.identity, new PrismaAuditService());
const PASSWORD = 'an-rt032-deactivation-password-1';
let s: Scenario;
let tokens: { parent: string; teacher: string; manager: string };
let groupId: string;
const RUN = randomUUID().slice(0, 8);

async function account(kind: string, table: string, actorId: string, name: string): Promise<string> {
  const id = randomUUID();
  const subject = `rt032-${name}-${RUN}-${id.slice(0, 8)}`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status, is_active) values ('${id}'::uuid, '${subject}', '${kind}', 'active', true)`,
  );
  await g.prisma.$executeRawUnsafe(`update chat.${table} set account_id = '${id}'::uuid where id = '${actorId}'::uuid`);
  await auth.setPassword(id, PASSWORD);
  return (await auth.login(subject, PASSWORD)).accessToken;
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  return 'ALLOWED';
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like 'rt032-%-${RUN}-%'`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  tokens = {
    parent: await account('family', 'contact', s.parentId, 'parent'),
    teacher: await account('teacher', 'teacher', s.teacherId, 'teacher'),
    manager: await account('staff', 'staff', s.managerId, 'manager'),
  };
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

describe('RT-032 · a direct-DB deactivation refuses every operation that starts after it', () => {
  it('control: before deactivation, each token authenticates and the parent can read and send', async () => {
    for (const t of Object.values(tokens)) expect(await auth.authenticate(t)).not.toBeNull();
    await expect(g.messages.list({ conversationId: groupId, actorId: s.parentId })).resolves.toBeDefined();
  });

  it('PARENT (contact.is_active=false): REST/socket authentication, read and send all refuse', async () => {
    await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);

    // The token still verifies cryptographically; the per-request lookup is what refuses.
    expect(await auth.authenticate(tokens.parent)).toBeNull();
    expect(await refusal(g.messages.list({ conversationId: groupId, actorId: s.parentId }))).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(
      await refusal(g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'x', clientMessageId: randomUUID() })),
    ).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('PARENT ACCOUNT (account.is_active=false) refuses authentication even with an active contact row', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.account set is_active = false, status = 'deactivated' where id = (select account_id from chat.contact where id = '${s.parentId}'::uuid)`,
    );
    expect(await auth.authenticate(tokens.parent)).toBeNull();
  });

  it('TEACHER (teacher.is_active=false): authentication, send and a call refuse', async () => {
    await g.prisma.$executeRawUnsafe(`update chat.teacher set is_active = false where id = '${s.teacherId}'::uuid`);
    expect(await auth.authenticate(tokens.teacher)).toBeNull();
    expect(
      await refusal(g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'x', clientMessageId: randomUUID() })),
    ).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(await refusal(g.calls.start(groupId, s.teacherId))).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('MANAGER (staff.is_active=false): authentication, an APPROVAL and moderation (PD-14) refuse; nothing changes', async () => {
    // PD-14: a message held before it -- nothing new is held.
    const held = await legacyHeldMessage(g, { conversationId: groupId, senderId: s.teacherId, body: 'needs approval' });
    expect(held.moderation).toBe('pending');
    const sent = await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'as sent', clientMessageId: randomUUID() });
    const approval = await g.prisma.messageApproval.findFirstOrThrow({ where: { messageId: held.id } });

    await g.prisma.$executeRawUnsafe(`update chat.staff set is_active = false, left_at = now() where id = '${s.managerId}'::uuid`);

    expect(await auth.authenticate(tokens.manager)).toBeNull();
    expect(await refusal(g.approvals.approve(approval.id, s.managerId))).not.toBe('ALLOWED');
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: held.id } })).moderation).toBe('pending');
    expect(await refusal(g.messages.edit(sent.id, s.managerId, 'rewritten'))).not.toBe('ALLOWED');
    expect(await refusal(g.messages.deleteForEveryone(sent.id, s.managerId, 'removed'))).not.toBe('ALLOWED');
    const after = await g.prisma.message.findUniqueOrThrow({ where: { id: sent.id } });
    expect([after.body, after.deletedForAll]).toEqual(['as sent', false]);
  });

  it('a call already ringing refuses a media token to a member deactivated after it started', async () => {
    const { callId } = await g.calls.start(groupId, s.teacherId);
    await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await refusal(g.calls.issueToken(callId, s.parentId))).not.toBe('ALLOWED');
    expect(await refusal(g.calls.accept(callId, s.parentId))).not.toBe('ALLOWED');
  });

  it('re-activation restores access: the refusal is the live row, not a cached verdict', async () => {
    await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await auth.authenticate(tokens.parent)).toBeNull();
    await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = true where id = '${s.parentId}'::uuid`);
    expect(await auth.authenticate(tokens.parent)).not.toBeNull();
  });
});
