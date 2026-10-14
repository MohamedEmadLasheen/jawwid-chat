/**
 * C1 -- the interim active-handler exception against the REAL chat.on_duty().
 *
 * Every other suite pins on_duty() (harness PinnedCoverage). Here
 * ConversationService.activeHandler() reaches the real SqlCoverageService, so
 * the routing the read policy relies on is the database's own: shifts, coverage
 * rules, absences and backups, evaluated by chat.on_duty() / coverage_chain().
 *
 * Fixtures: an always-on shift is days 0..6 with starts = ends = 00:00 (the
 * wrap-around branch of chat.window_contains matches every instant).
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { AuthorizationService } from '@platform/authorization.service';
import { SqlCoverageService } from '@platform/coverage.service';
import { PrismaAuditService } from '@platform/audit.service';
import { ConversationService } from '@communication/conversations/conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const sqlCoverage = new SqlCoverageService(g.prisma);
const conversations = new ConversationService(
  g.prisma,
  new AuthorizationService(sqlCoverage),
  g.outbox,
  g.identity,
  sqlCoverage,
  new PrismaAuditService(),
  g.relationships,
);
let s: Scenario;
const ORG_SLUG_PREFIX = 'advd-';

let ids: {
  owner2: string; // owns family 2, never in shift
  covering: string; // coverage role, always in shift, covers owner2 by rule
  sticky: string; // admin, used as a live sticky handler
  family2: string;
  contact2: string;
  foreignOrg: string;
  foreignCovering: string; // coverage role in ANOTHER organization
};
let conv: { f1: string; f2: string; familyLess: string };

async function onDutySql(familyId: string): Promise<string | null> {
  const rows = await g.prisma.$queryRawUnsafe<Array<{ d: string | null }>>(
    `select chat.on_duty('${familyId}'::uuid)::text as d`,
  );
  return rows[0].d;
}

async function alwaysOnShift(staffId: string, organizationId?: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.shift (staff_id, days, starts, ends, valid_from${organizationId ? ', organization_id' : ''})
     values ('${staffId}'::uuid, '{0,1,2,3,4,5,6}', '00:00', '00:00', current_date - 2${organizationId ? `, '${organizationId}'::uuid` : ''})`,
  );
}

async function read(actorId: string, conversationId: string) {
  const onDuty = jest.spyOn(sqlCoverage, 'onDuty');
  try {
    const actor = await conversations.requireActor(actorId);
    const c = await conversations.requireConversation(conversationId);
    const membership = await conversations.membershipOf(c.id, actor.actorId);
    onDuty.mockClear();
    const decision = await conversations.canReadResolved(actor, c, membership);
    return { decision, onDutyCalls: onDuty.mock.calls.length };
  } finally {
    onDuty.mockRestore();
  }
}

beforeAll(async () => {
  await g.prisma.$connect();
});

afterAll(async () => {
  await truncate(g.prisma); // cascades to shift / absence / coverage_rule through chat.staff
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  s = await seed(g.prisma);
  ids = {
    owner2: randomUUID(),
    covering: randomUUID(),
    sticky: randomUUID(),
    family2: randomUUID(),
    contact2: randomUUID(),
    foreignOrg: randomUUID(),
    foreignCovering: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${ids.owner2}'::uuid, 'owner_two', 'admin', true),
       ('${ids.covering}'::uuid, 'covering_k', 'coverage', true),
       ('${ids.sticky}'::uuid, 'sticky_s', 'admin', true)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.family2}'::uuid, 'family_two', '${ids.owner2}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${ids.contact2}'::uuid, '${ids.family2}'::uuid, 'parent_two', 'primary_guardian', true, true)`,
  );

  // Family 1 (seed, owner = s.ownerId): the owner is always in shift -> on duty.
  await alwaysOnShift(s.ownerId);
  // Family 2: its owner has NO shift; a coverage rule hands it to `covering`.
  await alwaysOnShift(ids.covering);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, valid_from)
     values ('${ids.covering}'::uuid, '${ids.owner2}'::uuid, '{0,1,2,3,4,5,6}', 'all_day', current_date - 2)`,
  );

  conv = {
    f1: (await conversations.getOrCreateDirect(s.parentId, s.otherAdminId)).id,
    f2: (await conversations.getOrCreateDirect(ids.contact2, s.otherAdminId)).id,
    familyLess: (await conversations.getOrCreateDirect(s.teacherId, s.otherAdminId)).id,
  };
});

describe('the real chat.on_duty()', () => {
  it('sanity: the database routes family 1 to its owner and family 2 to the covering staff', async () => {
    expect(await onDutySql(s.familyId)).toBe(s.ownerId);
    expect(await onDutySql(ids.family2)).toBe(ids.covering);
  });

  it('the staff member on duty for THIS family reads it (one real on_duty call)', async () => {
    const r = await read(ids.covering, conv.f2);
    expect(r.decision.allowed).toBe(true);
    expect(r.onDutyCalls).toBe(1);
  });

  it('on duty for a DIFFERENT family grants nothing here', async () => {
    // `covering` is on duty for family 2 only; family 1 routes to its owner.
    const r = await read(ids.covering, conv.f1);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('a LIVE sticky handler takes precedence: on_duty() is not consulted, the on-duty staff is refused', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set sticky_handler_id = '${ids.sticky}'::uuid, sticky_until = now() + interval '1 hour'
       where id = '${conv.f2}'::uuid`,
    );
    const handler = await read(ids.sticky, conv.f2);
    expect(handler.decision.allowed).toBe(true);
    expect(handler.onDutyCalls).toBe(0);
    expect((await read(ids.covering, conv.f2)).decision).toMatchObject({
      allowed: false,
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });

  it('an EXPIRED sticky handler falls back to the real on_duty()', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set sticky_handler_id = '${ids.sticky}'::uuid, sticky_until = now() - interval '1 minute'
       where id = '${conv.f2}'::uuid`,
    );
    expect((await read(ids.covering, conv.f2)).decision.allowed).toBe(true);
    expect((await read(ids.sticky, conv.f2)).decision.allowed).toBe(false);
  });

  it('an ABSENT owner hands the family to the absence backup, per the database', async () => {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.absence (staff_id, from_at, to_at, backup_id, type)
       values ('${s.ownerId}'::uuid, now() - interval '1 hour', now() + interval '1 hour', '${ids.covering}'::uuid, 'planned')`,
    );
    expect(await onDutySql(s.familyId)).toBe(ids.covering);
    expect((await read(ids.covering, conv.f1)).decision.allowed).toBe(true);
  });

  it('a family-less conversation never consults on_duty(); only membership or a sticky handler', async () => {
    const r = await read(ids.covering, conv.familyLess);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(r.onDutyCalls).toBe(0);
  });

  it('organization boundary: on_duty() can name another organization\'s staff; the read policy still refuses them as "not found"', async () => {
    // chat.on_duty() / coverage_chain() do not filter by organization, and a
    // rule with covered_id NULL covers every owner. Recorded, not changed here.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${ids.foreignOrg}'::uuid, '${ORG_SLUG_PREFIX}${ids.foreignOrg.slice(0, 8)}', 'org_b')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id)
       values ('${ids.foreignCovering}'::uuid, 'covering_b', 'coverage', true, '${ids.foreignOrg}'::uuid)`,
    );
    await alwaysOnShift(ids.foreignCovering, ids.foreignOrg);
    await g.prisma.$executeRawUnsafe(`delete from chat.coverage_rule`);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, valid_from, priority)
       values ('${ids.foreignCovering}'::uuid, null, '{0,1,2,3,4,5,6}', 'all_day', current_date - 2, 1)`,
    );
    expect(await onDutySql(ids.family2)).toBe(ids.foreignCovering); // the database names a foreign staff member

    const foreign = await read(ids.foreignCovering, conv.f2);
    expect(foreign.decision).toMatchObject({ allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, status: 404 });
    expect(foreign.onDutyCalls).toBe(0); // refused before any fact is resolved
    // ...and nobody in organization A gains handler scope from that answer.
    expect((await read(ids.covering, conv.f2)).decision.allowed).toBe(false);
  });

  it('execution facts: on_duty() is SECURITY INVOKER and STABLE (it runs with the caller\'s rights, read-only)', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ definer: boolean; volatility: string }>>(
      `select prosecdef as definer, provolatile::text as volatility from pg_proc
        where oid = 'chat.on_duty(uuid,timestamptz)'::regprocedure`,
    );
    expect(rows[0]).toEqual({ definer: false, volatility: 's' });
  });
});
