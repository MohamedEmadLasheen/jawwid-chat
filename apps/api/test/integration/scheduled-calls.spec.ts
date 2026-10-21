/**
 * PD-13: scheduled calls and members-only call links.
 *
 * What these tests pin is that a scheduled call GRANTS NOTHING. Scheduling one
 * needs the right to start a call there; seeing one needs the right to read its
 * conversation; joining one goes through CallService.start / accept, which
 * decide again. A card announces it to every member of the one conversation it
 * belongs to.
 */
import { CommErrorCode } from '@platform/errors';
import { PrismaAuditService } from '@platform/audit.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { ScheduledCallService } from '../../src/scheduled-calls/scheduled-call.service';
import { Scenario, buildGraph, legacyTeacherParentDirect, seed, truncate } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const cards = new CardPoster(g.conversations, g.outbox, new PrismaAuditService());
const scheduled = new ScheduledCallService(g.prisma, g.conversations, g.calls, cards, g.config);
let s: Scenario;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function groupCall(startsAt = inMinutes(1)) {
  const group = await g.conversations.ensureStudentGroup(s.learnerId);
  const row = await scheduled.create(s.ownerId, { conversationId: group.id, kind: 'scheduled', startsAt, title: 'Monthly review' });
  return { group, row };
}

async function cardsIn(conversationId: string) {
  return g.prisma.message.findMany({
    where: { conversationId, type: 'card' },
    orderBy: { seq: 'asc' },
    include: { card: true },
  });
}

// =========================================================================
describe('scheduling posts ONE card into the ONE conversation', () => {
  it('an admin schedules a Student Group call; the card reaches the group', async () => {
    const { group, row } = await groupCall(inMinutes(90));

    expect(row).toMatchObject({ conversationId: group.id, kind: 'scheduled', title: 'Monthly review', state: 'upcoming', canCancel: true });
    const msgs = await cardsIn(group.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].card?.kind).toBe('call_scheduled');
    expect(msgs[0].moderation).toBe('published');
    const payload = msgs[0].card?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ scheduledCallId: row.id, kind: 'scheduled', title: 'Monthly review', startsAt: row.startsAt });
    expect(typeof payload.when).toBe('string');
    // No room, no token, no contact channel anywhere in what members receive.
    expect(JSON.stringify(payload)).not.toMatch(/room|token|phone|msisdn|jawwid-/i);
    expect(msgs[0].body).toContain('Monthly review');
    // The card is published as a message, so it travels like one.
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'message.created' } });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('every member sees it in Upcoming; an out-of-scope admin does not', async () => {
    const { row } = await groupCall(inMinutes(90));

    for (const member of [s.ownerId, s.parentId, s.otherParentId, s.teacherId]) {
      const { items } = await scheduled.upcoming(member);
      expect(items.map((i) => i.id)).toEqual([row.id]);
    }
    expect((await scheduled.upcoming(s.unrelatedTeacherId)).items).toEqual([]);
    // Only the creator may cancel.
    expect((await scheduled.upcoming(s.parentId)).items[0].canCancel).toBe(false);
  });

  it('a call link is joinable from the moment it is made', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const row = await scheduled.create(s.ownerId, { conversationId: group.id, kind: 'link' });

    expect(row.state).toBe('open');
    expect((await cardsIn(group.id))[0].card?.kind).toBe('call_link');
  });
});

// =========================================================================
describe('scheduling needs the right to START a call there', () => {
  it('a parent member may schedule a Student Group call (PD-19)', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);

    await scheduled.create(s.parentId, { conversationId: group.id, startsAt: inMinutes(60) });
    expect(await g.prisma.scheduledCall.count()).toBe(1);
    expect(await cardsIn(group.id)).toHaveLength(1);
  });

  it('a parent may schedule a 1:1 with their supervisor', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const row = await scheduled.create(s.parentId, { conversationId: direct.id, startsAt: inMinutes(60) });

    expect(row.createdBy.actorId).toBe(s.parentId);
    expect((await scheduled.upcoming(s.ownerId)).items.map((i) => i.id)).toEqual([row.id]);
  });

  it('nobody schedules into a legacy teacher<->parent 1:1 (PD-7)', async () => {
    const legacy = await legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId);

    await expect(
      scheduled.create(s.teacherId, { conversationId: legacy, startsAt: inMinutes(60) }),
    ).rejects.toMatchObject({ code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT });
  });

  it('an outsider cannot schedule into, see, join or cancel it -- and cannot tell it exists', async () => {
    const { group, row } = await groupCall();

    // Refused exactly as the conversation read path refuses this caller.
    await expect(
      scheduled.create(s.unrelatedTeacherId, { conversationId: group.id, startsAt: inMinutes(60) }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(await g.prisma.scheduledCall.count()).toBe(1);
    const ops: Array<(actorId: string, id: string) => Promise<unknown>> = [
      (a, id) => scheduled.get(a, id),
      (a, id) => scheduled.join(a, id),
      (a, id) => scheduled.cancel(a, id),
    ];
    for (const op of ops) {
      await expect(op(s.unrelatedTeacherId, row.id)).rejects.toMatchObject({
        code: CommErrorCode.SCHEDULED_CALL_NOT_FOUND,
        status: 404,
      });
    }
    await expect(scheduled.get(s.unrelatedTeacherId, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: CommErrorCode.SCHEDULED_CALL_NOT_FOUND,
      status: 404,
    });
  });

  it('validates its input and names the field', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ conversationId: 'nope', startsAt: inMinutes(5) }, /conversationId/],
      [{ conversationId: group.id, kind: 'video', startsAt: inMinutes(5) }, /kind/],
      [{ conversationId: group.id }, /startsAt/],
      [{ conversationId: group.id, startsAt: 'tomorrow' }, /startsAt/],
      [{ conversationId: group.id, startsAt: inMinutes(-30) }, /startsAt: is in the past/],
      [{ conversationId: group.id, startsAt: inMinutes(5), title: 'x'.repeat(121) }, /title/],
    ];
    for (const [body, message] of cases) {
      await expect(scheduled.create(s.ownerId, body)).rejects.toMatchObject({
        code: CommErrorCode.VALIDATION,
        status: 400,
        message: expect.stringMatching(message),
      });
    }
  });
});

// =========================================================================
describe('Join starts the call, or takes a seat in the live one', () => {
  it('is refused before the window opens', async () => {
    const { row } = await groupCall(inMinutes(60));

    await expect(scheduled.join(s.ownerId, row.id)).rejects.toMatchObject({
      code: CommErrorCode.SCHEDULED_CALL_NOT_JOINABLE,
      status: 409,
    });
    expect(await g.prisma.call.count()).toBe(0);
  });

  it('the first Join starts it; later Joins join THAT call', async () => {
    const { group, row } = await groupCall();

    const first = await scheduled.join(s.ownerId, row.id);
    expect(first).toMatchObject({ conversationId: group.id, mode: 'started' });
    const linked = await g.prisma.scheduledCall.findUniqueOrThrow({ where: { id: row.id } });
    expect(linked.callId).toBe(first.callId);

    const teacher = await scheduled.join(s.teacherId, row.id);
    expect(teacher).toEqual({ callId: first.callId, conversationId: group.id, mode: 'joined' });
    // The seat is taken through the ordinary accept path.
    await g.calls.accept(teacher.callId, s.teacherId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: first.callId } })).status).toBe('active');

    // A parent JOINS the live group call rather than starting a second one.
    const parent = await scheduled.join(s.parentId, row.id);
    expect(parent).toMatchObject({ callId: first.callId, mode: 'joined' });
    await g.calls.accept(parent.callId, s.parentId);

    // The starter tapping Join again is told it is their own call, not given a second one.
    expect(await scheduled.join(s.ownerId, row.id)).toMatchObject({ callId: first.callId, mode: 'started' });
    expect(await g.prisma.call.count()).toBe(1);
  });

  it('a parent tapping Join first starts the group call (PD-19)', async () => {
    const { row } = await groupCall();

    expect(await scheduled.join(s.parentId, row.id)).toMatchObject({ mode: 'started' });
    expect(await g.prisma.call.count()).toBe(1);
  });

  it('two simultaneous Joins produce ONE call', async () => {
    const { row } = await groupCall();

    const [a, b] = await Promise.all([scheduled.join(s.ownerId, row.id), scheduled.join(s.teacherId, row.id)]);

    expect(a.callId).toBe(b.callId);
    expect(await g.prisma.call.count()).toBe(1);
    expect([a.mode, b.mode].sort()).toEqual(['joined', 'started']);
  });

  it('after the call ends, the next Join starts a fresh one', async () => {
    const { row } = await groupCall();
    const first = await scheduled.join(s.ownerId, row.id);
    await g.calls.end(first.callId, s.ownerId);

    const again = await scheduled.join(s.teacherId, row.id);

    expect(again.mode).toBe('started');
    expect(again.callId).not.toBe(first.callId);
  });

  it('is refused once the window has closed', async () => {
    const { row } = await groupCall();
    // The record is never edited by the service; age it past the window directly.
    await g.prisma.$executeRawUnsafe(`alter table chat.scheduled_call disable trigger scheduled_call_is_coherent`);
    await g.prisma.$executeRawUnsafe(
      `update chat.scheduled_call set starts_at = now() - interval '3 hours' where id = '${row.id}'::uuid`,
    );
    await g.prisma.$executeRawUnsafe(`alter table chat.scheduled_call enable trigger scheduled_call_is_coherent`);

    await expect(scheduled.join(s.ownerId, row.id)).rejects.toMatchObject({
      code: CommErrorCode.SCHEDULED_CALL_NOT_JOINABLE,
    });
    expect((await scheduled.upcoming(s.ownerId)).items).toEqual([]);
  });
});

// =========================================================================
describe('cancel', () => {
  it('only the creator cancels; it posts a cancellation card and closes Join', async () => {
    const { group, row } = await groupCall(inMinutes(30));

    await expect(scheduled.cancel(s.teacherId, row.id)).rejects.toMatchObject({
      code: CommErrorCode.SCHEDULED_CALL_DENIED,
    });

    const cancelled = await scheduled.cancel(s.ownerId, row.id);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.canCancel).toBe(false);
    expect((await cardsIn(group.id)).map((m) => m.card?.kind)).toEqual(['call_scheduled', 'call_schedule_cancelled']);

    // Idempotent: a second cancel neither fails nor posts a second card.
    await scheduled.cancel(s.ownerId, row.id);
    expect(await cardsIn(group.id)).toHaveLength(2);

    await expect(scheduled.join(s.ownerId, row.id)).rejects.toMatchObject({
      code: CommErrorCode.SCHEDULED_CALL_NOT_JOINABLE,
    });
    expect((await scheduled.upcoming(s.parentId)).items).toEqual([]);
  });
});

// =========================================================================
describe('the database keeps the record honest', () => {
  it('a scheduled call is never edited or deleted', async () => {
    const { row } = await groupCall();

    await expect(
      g.prisma.$executeRawUnsafe(`update chat.scheduled_call set starts_at = now() where id = '${row.id}'::uuid`),
    ).rejects.toThrow(/never edited/);
    await expect(
      g.prisma.$executeRawUnsafe(`delete from chat.scheduled_call where id = '${row.id}'::uuid`),
    ).rejects.toThrow(/never deleted/);
  });

  it('refuses a call from another conversation', async () => {
    const { row } = await groupCall();
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const other = await g.calls.start(direct.id, s.ownerId);

    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.scheduled_call set call_id = '${other.callId}'::uuid where id = '${row.id}'::uuid`,
      ),
    ).rejects.toThrow(/its own conversation/);
  });

  it('request roles have no access', async () => {
    const grants = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from information_schema.role_table_grants
        where table_schema = 'chat' and table_name = 'scheduled_call'
          and grantee in ('chat_app', 'anon', 'authenticated', 'public')`,
    );
    expect(Number(grants[0].n)).toBe(0);
  });
});
