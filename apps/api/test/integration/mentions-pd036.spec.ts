/**
 * PD-36 -- @mentions, end to end on the PD-8 synthetic organization
 * (src/cli/org-chat-seed.ts), against the real SQL scope.
 *
 *   1. A MENTION NEVER WIDENS AUTHORIZATION: a summons names only staff with a
 *      PD-8 basis on the conversation (chat.mention_eligible_staff); anyone else
 *      refuses the whole send -- nothing is written -- and the database refuses
 *      the row again (chat.guard_message_mention)
 *   2. who may mention whom: members for everyone; summonses for staff and
 *      teachers; parents only @supervisor / @admin, which never reach the super
 *      admin; none in a Teacher <-> Admin 1:1; never a teacher into a family 1:1
 *   3. the picker offers exactly what a send accepts
 *   4. rate limits: per sender per hour, the super admin per day -- the message
 *      still sends, the excess stays plain text
 *   5. the mention push: one per person per message, through a mute, instead of
 *      the ordinary new-message push
 *   6. the chat list and Group Info: the summoned person's viewer mention; the
 *      "Mentioned -- waiting" row; gone after answering
 *   7. answering through PD-35's seat (reason 'mention'): a member row in a
 *      group, an effective seat in a family 1:1 (pushes follow, no third
 *      member); refused without an open summons or without standing; the
 *      summons reads as answered at once and the sweep closes it as joined
 *   8. the sweep: an unanswered summons expires; an edit or a delete takes a
 *      mention back
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { hashPassword } from '@platform/auth/password';
import { CommError, CommErrorCode } from '@platform/errors';
import { MessageService } from '@communication/messages/message.service';
import { MentionService } from '@communication/mentions/mention.service';
import { ConversationSeatService } from '@communication/seats/conversation-seat.service';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import type { RealtimeRevocation } from '@platform/realtime-revocation';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd36-mention-spec-password-1';
const DOMAIN = 'pd36mention.qa.jawwid.test';

const g = buildGraph();
const audit = new PrismaAuditService();
const registry = new SeatPolicyRegistry();
const mentions = new MentionService(g.prisma, g.conversations, g.outbox, g.config, audit, g.identity, registry);
const revocation: RealtimeRevocation = {
  leaveConversation: () => undefined,
  disconnectSessions: () => undefined,
  disconnectAccount: () => undefined,
  sessionRotated: () => undefined,
  confirmRevoked: async () => undefined,
};
// The seat service registers its placeholders; the mention policy replaces one.
const seats = new ConversationSeatService(g.prisma, g.authz, g.conversations, g.outbox, registry, audit, revocation);
mentions.onModuleInit();
const messages = new MessageService(
  g.prisma, g.authz, g.conversations, g.outbox, g.config, g.attachments, audit, g.identity, mentions,
);

let m: SeedManifest;
let orgId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** "@<name> <rest>" with the mention spanning "@<name>". */
const at = (name: string, rest = 'please take a look') => ({ body: `@${name} ${rest}`, span: { start: 0, length: name.length + 1 } });

/** The family whose first group has a teacher, and the people around it. */
function scene() {
  const family = m.families.find((f) => f.groups.some((x) => x.teacherIds.length > 0))!;
  const group = family.groups.find((x) => x.teacherIds.length > 0)!;
  const supervisorId = group.supervisorId;
  const direct = family.directs.find((d) => d.supervisorId === supervisorId)!;
  const teacherId = group.teacherIds[0]!;
  // A primary supervisor who supervises none of this family's children and is
  // nobody's backup here: no PD-8 basis on these conversations.
  const outsider = m.supervisors.find(
    (s) => !family.children.some((c) => c.supervisorId === s.id) && !m.backups.some((b) => b.id === s.id),
  )!;
  return {
    family,
    groupId: group.conversationId,
    directId: direct.conversationId,
    supervisorId,
    teacherId,
    parentId: family.parent.id,
    managerId: m.operationsManager.id,
    superAdminId: m.superAdmin.id,
    outsiderId: outsider.id,
  };
}

const rows = (messageId: string) => g.prisma.messageMention.findMany({ where: { messageId }, orderBy: { spanStart: 'asc' } });
const messageCount = (conversationId: string) => g.prisma.message.count({ where: { conversationId } });

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd36-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd36-${orgId.slice(0, 8)}', 'PD-36 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    messages: false,
  });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd36-%'`);
  await g.prisma.$disconnect();
});

/** Each test starts with no mentions, so the rate limits count only its own. */
beforeEach(async () => {
  await g.prisma.messageMention.deleteMany({});
  await g.prisma.notification.deleteMany({});
  await g.prisma.outboxEvent.deleteMany({});
  // Every seat a test took is left, so the next starts with none.
  for (const seat of await g.prisma.$queryRaw<Array<{ conversation_id: string; staff_id: string }>>`
    SELECT conversation_id::text AS conversation_id, staff_id::text AS staff_id
      FROM chat.conversation_seat WHERE left_at IS NULL`) {
    await seats.leave(await g.conversations.requireActor(seat.staff_id), seat.conversation_id);
  }
});

describe('1-2. a mention never widens authorization', () => {
  it('a member is mentioned: one notified row, a chip, and the reader sees it is them', async () => {
    const s = scene();
    const { body, span } = at('Teacher');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.parentId, body, mentions: [{ ...span, actorId: s.teacherId }] });
    expect(sent.mentions).toEqual([{ ...span, actorId: s.teacherId, role: null }]);
    const [row] = await rows(sent.id);
    expect(row).toMatchObject({ targetActorId: s.teacherId, isSummons: false, state: 'notified' });
    const page = await messages.list({ conversationId: s.groupId, actorId: s.teacherId });
    expect(page.messages.find((x) => x.id === sent.id)?.mentionsViewer).toBe(true);
  });

  it('a teacher summons the Operations Manager into a family group (PD-8 manager basis)', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    const [row] = await rows(sent.id);
    expect(row).toMatchObject({ targetActorId: s.managerId, isSummons: true, state: 'pending' });
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('a supervisor with NO basis here cannot be summoned: 403, and no message is written', async () => {
    const s = scene();
    const before = await messageCount(s.groupId);
    const { body, span } = at('Outsider');
    expect(
      await code(messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.outsiderId }] })),
    ).toBe(CommErrorCode.MENTION_NOT_ALLOWED);
    expect(await messageCount(s.groupId)).toBe(before);
  });

  it('a parent cannot name a non-member, even one in charge', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    expect(
      await code(messages.send({ conversationId: s.groupId, senderId: s.parentId, body, mentions: [{ ...span, actorId: s.managerId }] })),
    ).toBe(CommErrorCode.MENTION_NOT_ALLOWED);
  });

  it("a parent's @admin reaches the supervisor (a member) and the department manager -- never the super admin", async () => {
    const s = scene();
    const body = '@admin I need help';
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.parentId, body, mentions: [{ start: 0, length: 6, role: 'admin' }] });
    const got = await rows(sent.id);
    const byTarget = new Map(got.map((r) => [r.targetActorId, r]));
    expect(byTarget.get(s.supervisorId)).toMatchObject({ viaRole: 'admin', isSummons: false, state: 'notified' });
    expect(byTarget.get(s.managerId)).toMatchObject({ viaRole: 'admin', isSummons: true, state: 'pending' });
    expect(byTarget.has(s.superAdminId)).toBe(false);
    // One chip for the role, however many people it reached.
    expect(sent.mentions).toEqual([{ start: 0, length: 6, actorId: null, role: 'admin' }]);
  });

  it("a parent's @supervisor reaches the supervisor only", async () => {
    const s = scene();
    const sent = await messages.send({
      conversationId: s.groupId,
      senderId: s.parentId,
      body: '@supervisor hello',
      mentions: [{ start: 0, length: 11, role: 'supervisor' }],
    });
    expect((await rows(sent.id)).map((r) => r.targetActorId)).toEqual([s.supervisorId]);
  });

  it('role mentions are for parents', async () => {
    const s = scene();
    expect(
      await code(messages.send({ conversationId: s.groupId, senderId: s.teacherId, body: '@admin x', mentions: [{ start: 0, length: 6, role: 'admin' }] })),
    ).toBe(CommErrorCode.MENTION_NOT_ALLOWED);
  });

  it('no summons in a Teacher <-> Admin 1:1: membership is the only authority to speak there', async () => {
    const td = m.teacherDirects[0]!;
    const { body, span } = at('Laila');
    expect(
      await code(messages.send({ conversationId: td.conversationId, senderId: td.teacherId, body, mentions: [{ ...span, actorId: m.operationsManager.id }] })),
    ).toBe(CommErrorCode.MENTION_NOT_ALLOWED);
  });

  it('BR-1/PD-7: a teacher can never be summoned into a family 1:1', async () => {
    const s = scene();
    const { body, span } = at('Teacher');
    expect(
      await code(messages.send({ conversationId: s.directId, senderId: s.supervisorId, body, mentions: [{ ...span, actorId: s.teacherId }] })),
    ).toBe(CommErrorCode.MENTION_NOT_ALLOWED);
    const picker = await mentions.candidates(s.supervisorId, s.directId, '');
    expect(picker.people.some((p) => p.actorKind === 'teacher')).toBe(false);
  });

  it('THE DATABASE FLOOR: a summons row for someone without standing, or a role row naming the super admin, is refused', async () => {
    const s = scene();
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body: '@x @y hello' });
    const base = {
      organization_id: orgId,
      conversation_id: s.groupId,
      message_id: sent.id,
      mentioned_by: s.teacherId,
    };
    const insert = (target: string, viaRole: string | null) =>
      g.prisma.$executeRawUnsafe(
        `insert into chat.message_mention (organization_id, conversation_id, message_id, mentioned_by, mentioned_by_kind,
           target_actor_id, target_kind, via_role, is_summons, span_start, span_length, state, expires_at)
         values ('${base.organization_id}', '${base.conversation_id}', '${base.message_id}', '${base.mentioned_by}', 'teacher',
           '${target}', 'staff', ${viaRole ? `'${viaRole}'` : 'null'}, true, 0, 2, 'pending', now() + interval '7 days')`,
      );
    await expect(insert(s.outsiderId, null)).rejects.toThrow(/in charge of this conversation/);
    await expect(insert(s.superAdminId, 'admin')).rejects.toThrow(/never the super admin/);
    // ...while the same row for the manager stands.
    await expect(insert(s.managerId, null)).resolves.toBe(1);
  });
});

describe('3. the picker offers exactly what a send accepts', () => {
  it('staff and teachers see members plus the staff in charge; never an outsider', async () => {
    const s = scene();
    const picker = await mentions.candidates(s.teacherId, s.groupId, '');
    const ids = new Set(picker.people.map((p) => p.actorId));
    expect(ids.has(s.supervisorId)).toBe(true);
    expect(ids.has(s.parentId)).toBe(true);
    expect(ids.has(s.managerId)).toBe(true);
    expect(ids.has(s.superAdminId)).toBe(true);
    expect(ids.has(s.outsiderId)).toBe(false);
    expect(ids.has(s.teacherId)).toBe(false); // not yourself
    expect(picker.roles).toEqual([]);
  });

  it('parents see members and the two roles, and no non-member', async () => {
    const s = scene();
    const picker = await mentions.candidates(s.parentId, s.groupId, '');
    expect(picker.people.every((p) => p.isMember)).toBe(true);
    expect(picker.roles).toEqual(['supervisor', 'admin']);
  });
});

describe('4. rate limits: the message still sends, the excess stays plain text', () => {
  it('per sender per conversation per hour', async () => {
    const s = scene();
    for (let i = 0; i < 5; i++) {
      const { body, span } = at('Parent', `note ${i}`);
      const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.parentId }] });
      expect(sent.mentionsLimited).toBeUndefined();
    }
    const { body, span } = at('Parent', 'sixth');
    const sixth = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.parentId }] });
    expect(sixth.mentionsLimited).toBe(true);
    expect(sixth.body).toBe(body);
    expect(sixth.mentions).toEqual([]);
    expect(await rows(sixth.id)).toHaveLength(0);
  });

  it('the super admin, per conversation per day, whoever mentions them', async () => {
    const s = scene();
    const senders = [s.teacherId, s.supervisorId, s.teacherId];
    for (const sender of senders) {
      const { body, span } = at('Owner');
      expect((await messages.send({ conversationId: s.groupId, senderId: sender, body, mentions: [{ ...span, actorId: s.superAdminId }] })).mentionsLimited).toBeUndefined();
    }
    const { body, span } = at('Owner');
    const fourth = await messages.send({ conversationId: s.groupId, senderId: s.supervisorId, body, mentions: [{ ...span, actorId: s.superAdminId }] });
    expect(fourth.mentionsLimited).toBe(true);
  });
});

describe('5. the mention push', () => {
  it('one mention push per person, through a mute, instead of the new-message push', async () => {
    const s = scene();
    await g.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId: s.groupId, actorId: s.teacherId } },
      create: { conversationId: s.groupId, actorId: s.teacherId, mutedUntil: new Date(Date.now() + 86_400_000) },
      update: { mutedUntil: new Date(Date.now() + 86_400_000) },
    });
    const { body, span } = at('Teacher');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.parentId, body, mentions: [{ ...span, actorId: s.teacherId }] });
    await g.outboxWorker.drain();
    const forTeacher = await g.prisma.notification.findMany({ where: { recipientId: s.teacherId } });
    expect(forTeacher.map((n) => n.ruleKey)).toEqual(['mention_group']);
    expect(forTeacher[0]!.dedupeKey).toBe(`mention:${sent.id}:${s.teacherId}`);
    // No content, only ids and timing (PD-34 amendment: which message and
    // mention it stands for, so a read or the mention closing withdraws it).
    expect(Object.keys(forTeacher[0]!.variables as object).every((k) => ['lastSeq', 'mentionId', 'quietDeferred', 'notBefore'].includes(k))).toBe(true);
    // The supervisor, not mentioned, gets the ordinary one.
    expect((await g.prisma.notification.findMany({ where: { recipientId: s.supervisorId } })).map((n) => n.ruleKey)).toEqual(['new_message']);
    await g.prisma.conversationParticipantState.update({
      where: { conversationId_actorId: { conversationId: s.groupId, actorId: s.teacherId } },
      data: { mutedUntil: null },
    });
  });

  it('a summoned non-member is pushed too (they are no member, so no new-message push)', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    await g.outboxWorker.drain();
    expect((await g.prisma.notification.findMany({ where: { recipientId: s.managerId } })).map((n) => n.ruleKey)).toEqual(['mention_group']);
  });
});

describe('6. the chat list and Group Info', () => {
  it('the summoned person sees an unseen summons on the row; members see them "waiting" until answered', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });

    const mine = await mentions.viewerMentions([s.groupId], s.managerId);
    expect(mine.get(s.groupId)).toMatchObject({ kind: 'summons', state: 'pending', seen: false });
    await mentions.markSeen(s.managerId, s.groupId);
    expect((await mentions.viewerMentions([s.groupId], s.managerId)).get(s.groupId)).toMatchObject({ seen: true, state: 'pending' });

    const members = new Set((await g.conversations.membersOf(s.groupId)).map((x) => x.actorId));
    const waiting = await mentions.summonedIn(s.groupId, members);
    expect(waiting).toEqual([
      expect.objectContaining({ actorId: s.managerId, displayName: m.operationsManager.name, staffRole: 'manager', state: 'pending', mentionedById: s.teacherId }),
    ]);

    const open = (await mentions.openFor(s.managerId)).mentions[0]!;
    await mentions.dismiss(s.managerId, open.mentionId);
    expect(await mentions.summonedIn(s.groupId, members)).toEqual([]);
    expect((await mentions.viewerMentions([s.groupId], s.managerId)).has(s.groupId)).toBe(false);
  });

  it("someone else's mention answers as unknown", async () => {
    const s = scene();
    const { body, span } = at('Laila');
    await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    const open = (await mentions.openFor(s.managerId)).mentions[0]!;
    expect(await code(mentions.dismiss(s.superAdminId, open.mentionId))).toBe(CommErrorCode.MENTION_NOT_FOUND);
  });
});

describe("7. answering: PD-35's seat, reason 'mention'", () => {
  it('a family 1:1: the manager takes an EFFECTIVE seat -- no third member, a visible line, the pushes follow; leaving ends them', async () => {
    const s = scene();
    await messages.send({ conversationId: s.directId, senderId: s.parentId, body: '@admin please', mentions: [{ start: 0, length: 6, role: 'admin' }] });
    const open = (await mentions.openFor(s.managerId)).mentions.find((x) => x.conversationId === s.directId)!;
    expect(open.state).toBe('pending');

    const manager = await g.conversations.requireActor(s.managerId);
    await seats.join(manager, s.directId, { reason: 'mention', sourceId: open.mentionId });
    expect(await g.prisma.conversationMember.count({ where: { conversationId: s.directId, leftAt: null } })).toBe(2);
    expect(
      await g.prisma.message.count({ where: { conversationId: s.directId, type: 'system', body: { contains: 'seat.stepped_in' } } }),
    ).toBe(1);
    // Answered at once (no longer asking), and closed as joined by the sweep.
    expect((await mentions.viewerMentions([s.directId], s.managerId)).has(s.directId)).toBe(false);
    expect(await mentions.summonedIn(s.directId, new Set())).toEqual([]);
    expect((await mentions.sweep()).joined).toBeGreaterThanOrEqual(1);
    expect((await g.prisma.messageMention.findUniqueOrThrow({ where: { id: open.mentionId } })).state).toBe('joined');

    await g.outboxWorker.drain();
    await g.prisma.notification.deleteMany({});
    await messages.send({ conversationId: s.directId, senderId: s.parentId, body: 'thank you' });
    await g.outboxWorker.drain();
    expect((await g.prisma.notification.findMany({ where: { recipientId: s.managerId } })).map((n) => n.ruleKey)).toEqual(['new_message']);

    await seats.leave(manager, s.directId);
    await g.prisma.notification.deleteMany({});
    await messages.send({ conversationId: s.directId, senderId: s.parentId, body: 'one more thing' });
    await g.outboxWorker.drain();
    expect(await g.prisma.notification.count({ where: { recipientId: s.managerId } })).toBe(0);
  });

  it('a group: the summoned person takes a member seat, visibly', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    const manager = await g.conversations.requireActor(s.managerId);
    await seats.join(manager, s.groupId, { reason: 'mention' });
    expect(await g.prisma.conversationMember.count({ where: { conversationId: s.groupId, actorId: s.managerId, leftAt: null } })).toBe(1);
    expect(
      await g.prisma.message.count({ where: { conversationId: s.groupId, type: 'system', body: { contains: 'seat.joined' } } }),
    ).toBeGreaterThanOrEqual(1);
    const members = new Set((await g.conversations.membersOf(s.groupId)).map((x) => x.actorId));
    expect(await mentions.summonedIn(s.groupId, members)).toEqual([]);
  });

  it('refused without an open summons, after it expires, and for someone with no standing', async () => {
    const s = scene();
    const manager = await g.conversations.requireActor(s.managerId);
    expect(await code(seats.join(manager, s.groupId, { reason: 'mention' }))).toBe(CommErrorCode.SEAT_NOT_ELIGIBLE);

    const { body, span } = at('Laila');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    await g.prisma.$executeRawUnsafe(`update chat.message_mention set expires_at = now() - interval '1 minute' where message_id = '${sent.id}'`);
    expect(await code(seats.join(manager, s.groupId, { reason: 'mention' }))).toBe(CommErrorCode.SEAT_NOT_ELIGIBLE);

    const outsider = await g.conversations.requireActor(s.outsiderId);
    const refused = await code(seats.join(outsider, s.groupId, { reason: 'mention' }));
    expect([CommErrorCode.SEAT_NOT_ELIGIBLE, CommErrorCode.CONVERSATION_NOT_FOUND, CommErrorCode.STAFF_OUT_OF_SCOPE]).toContain(refused);
  });
});

describe('8. the sweep, edits and deletes', () => {
  it('an unanswered summons expires', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    await g.prisma.$executeRawUnsafe(`update chat.message_mention set expires_at = now() - interval '1 minute' where message_id = '${sent.id}'`);
    expect((await mentions.sweep()).expired).toBe(1);
    expect((await rows(sent.id))[0]!.state).toBe('expired');
    expect(await mentions.summonedIn(s.groupId, new Set())).toEqual([]);
  });

  it('an edit that changes the "@..." takes the mention back; an edit elsewhere keeps it', async () => {
    const s = scene();
    const { body, span } = at('Parent');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.parentId }] });
    const kept = await messages.edit(sent.id, s.teacherId, `${body}!`);
    expect(kept.mentions).toHaveLength(1);
    const gone = await messages.edit(sent.id, s.teacherId, 'never mind');
    expect(gone.mentions).toEqual([]);
    expect((await rows(sent.id))[0]!.state).toBe('removed');
  });

  it('a message deleted for everyone closes its summonses', async () => {
    const s = scene();
    const { body, span } = at('Laila');
    const sent = await messages.send({ conversationId: s.groupId, senderId: s.teacherId, body, mentions: [{ ...span, actorId: s.managerId }] });
    await messages.deleteForEveryone(sent.id, s.teacherId, 'sent by mistake');
    expect((await rows(sent.id))[0]!.state).toBe('removed');
    expect((await mentions.openFor(s.managerId)).mentions).toEqual([]);
  });
});
