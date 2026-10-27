/**
 * PD-37 P1a-2: online / last seen, and who may see whose.
 *
 *   staff -> staff     online always; last seen unless EITHER side hides it;
 *   staff -> teacher   the super admin and the Teachers department only;
 *   anyone else        nothing -- families and teachers see nobody, nobody
 *                      sees a family; inactive or other-organization people
 *                      are never in an answer.
 *
 * Also: the Redis store reports transitions (not heartbeats), the gateway
 * announces only to PresencePolicy's audience and holds "offline" for a grace
 * period, and GET /presence leaves out -- rather than shows offline -- anyone
 * the caller may not see.
 *
 * Requires Redis: AUTH_TEST_REDIS_URL / REDIS_URL, your own instance.
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CommErrorCode } from '@platform/errors';
import { AppConfigService } from '@platform/app-config.service';
import type { Actor } from '@platform/types';
import { CommEvent } from '@communication/contracts/events';
import { PRESENCE_OFFLINE_GRACE_MS, PresenceService } from '@communication/realtime/presence.service';
import { PresencePolicy } from '@communication/realtime/presence-policy';
import { PresenceController } from '@communication/api/presence.controller';
import { ActionScope, RATE_LIMITED_ACTION } from '@platform/auth/action-throttle.guard';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { TeacherScopeService } from '@platform/teacher-scope';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';

const g = buildGraph();
let s: Scenario;
let redis: Redis;
let presence: PresenceService;
let policy: PresencePolicy;

/** Everyone beyond the harness's cast: one of each case the rule distinguishes. */
const x = {
  superAdmin: '', teachersManager: '', teachersMember: '', hider: '', gone: '', otherOrgStaff: '', otherOrg: '',
};

/** PD-35's switch, written where chat.teacher_scope_strict() reads it (as boot does). */
async function setStrict(on: boolean) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description)
     values ('teacher_supervisor.strict_scope', '${on}'::jsonb, 'teachers', 'pd037 test')
     on conflict (key) do update set value = excluded.value`,
  );
}

async function actor(id: string): Promise<Actor> {
  return g.conversations.requireActor(id);
}

beforeAll(async () => {
  await g.prisma.$connect();
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
});
afterAll(async () => {
  await redis.quit();
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd037-%'`).catch(() => undefined);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  presence = new PresenceService(redis, new AppConfigService(g.prisma));
  policy = new PresencePolicy(g.prisma, new TeacherScopeService(g.prisma));
  await setStrict(false);
  for (const k of Object.keys(x) as Array<keyof typeof x>) x[k] = randomUUID();
  const exec = (sql: string) => g.prisma.$executeRawUnsafe(sql);

  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ('${x.superAdmin}'::uuid, 'super_s', 'super_admin', true)`);
  });
  await exec(`insert into chat.staff (id, name, role, is_active, left_at, hide_last_seen) values
    ('${x.teachersManager}'::uuid, 'tmanager_t', 'manager', true, null, false),
    ('${x.teachersMember}'::uuid, 'tsupervisor_t', 'admin', true, null, false),
    ('${x.hider}'::uuid, 'hider_h', 'admin', true, null, true),
    ('${x.gone}'::uuid, 'gone_g', 'admin', false, now(), false)`);
  await exec(`insert into chat.department (kind, display_name, manager_id)
              values ('teachers', 'teachers', '${x.teachersManager}'::uuid)`);
  await exec(`insert into chat.department_member (staff_id, organization_id, department_id, position)
              select '${x.teachersMember}'::uuid, chat.default_organization_id(), d.id, 'supervisor'
                from chat.department d where d.kind = 'teachers' and d.organization_id = chat.default_organization_id()`);
  await exec(`insert into chat.organization (id, slug, display_name) values ('${x.otherOrg}'::uuid, 'pd037-${x.otherOrg.slice(0, 8)}', 'pd037 other')`);
  await exec(`insert into chat.staff (id, organization_id, name, role, is_active)
              values ('${x.otherOrgStaff}'::uuid, '${x.otherOrg}'::uuid, 'far_f', 'admin', true)`);
});

describe('PD-37 PresencePolicy: who may see a staff member', () => {
  it('every active colleague in the organization; last seen unless either side hides it', async () => {
    const a = await policy.audienceOf(await actor(s.ownerId));
    const all = [...a.withLastSeen, ...a.withoutLastSeen];
    for (const id of [s.otherAdminId, s.managerId, x.superAdmin, x.teachersManager, x.teachersMember, x.hider]) {
      expect(all).toContain(id);
    }
    // Never: the subject, an inactive colleague, another organization, a teacher, a parent.
    for (const id of [s.ownerId, x.gone, x.otherOrgStaff, s.teacherId, s.parentId]) expect(all).not.toContain(id);
    // The one who hides their own last seen sees nobody else's (reciprocity).
    expect(a.withoutLastSeen).toEqual([x.hider]);
  });

  it("a staff member who hides it: everyone sees them online, nobody sees their last seen", async () => {
    const a = await policy.audienceOf(await actor(x.hider));
    expect(a.withLastSeen).toEqual([]);
    expect(a.withoutLastSeen).toContain(s.ownerId);
  });
});

describe("PD-37 PresencePolicy: who may see a teacher, a parent", () => {
  it('a teacher: the super admin and the Teachers department -- not Operations', async () => {
    const a = await policy.audienceOf(await actor(s.teacherId));
    expect([...a.withLastSeen].sort()).toEqual([x.superAdmin, x.teachersManager, x.teachersMember].sort());
  });

  it("PD-35 strict scope ON: a teacher supervisor sees only the teachers assigned to them", async () => {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id)
       values ('${s.teacherId}'::uuid, chat.default_organization_id(), '${x.teachersMember}'::uuid)`,
    );
    await setStrict(true);
    try {
      // Theirs: the supervisor, the Teachers Manager and the super admin see it.
      const mine = await policy.audienceOf(await actor(s.teacherId));
      expect([...mine.withLastSeen].sort()).toEqual([x.superAdmin, x.teachersManager, x.teachersMember].sort());
      // Not theirs: the supervisor drops out; the manager and the super admin remain.
      const other = await policy.audienceOf(await actor(s.newTeacherId));
      expect([...other.withLastSeen].sort()).toEqual([x.superAdmin, x.teachersManager].sort());
      // The read direction agrees.
      const seen = await policy.visibleTo(await actor(x.teachersMember), { staffIds: [], teacherIds: [s.teacherId, s.newTeacherId] });
      expect([...seen.keys()]).toEqual([s.teacherId]);
    } finally {
      await setStrict(false);
    }
  });

  it("a parent: nobody", async () => {
    expect(await policy.audienceOf(await actor(s.parentId))).toEqual({ withLastSeen: [], withoutLastSeen: [] });
  });

  it('a family or a teacher sees nobody at all', async () => {
    const ask = { staffIds: [s.ownerId, s.otherAdminId], teacherIds: [s.newTeacherId] };
    expect((await policy.visibleTo(await actor(s.parentId), ask)).size).toBe(0);
    expect((await policy.visibleTo(await actor(s.teacherId), ask)).size).toBe(0);
  });

  it('Operations sees colleagues but no teacher; the Teachers department sees the teacher', async () => {
    const ask = { staffIds: [s.otherAdminId, x.otherOrgStaff, x.gone], teacherIds: [s.teacherId] };
    const ops = await policy.visibleTo(await actor(s.ownerId), ask);
    expect([...ops.keys()]).toEqual([s.otherAdminId]);
    const tdm = await policy.visibleTo(await actor(x.teachersMember), ask);
    expect([...tdm.keys()].sort()).toEqual([s.otherAdminId, s.teacherId].sort());
    // Asking about a teacher id as staff (or the reverse) finds nobody.
    const swapped = await policy.visibleTo(await actor(x.teachersMember), { staffIds: [s.teacherId], teacherIds: [s.otherAdminId] });
    expect(swapped.size).toBe(0);
  });
});

describe('PD-37 PresenceService: transitions, not heartbeats', () => {
  it('online once for the first device; the last disconnect starts the grace; last seen set', async () => {
    const who = randomUUID();
    const t0 = Date.now();
    expect(await presence.online(who, 'phone', t0)).toBe(true);
    expect(await presence.online(who, 'laptop', t0)).toBe(false); // already online
    expect(await presence.heartbeat(who, 'phone', t0)).toBe(false);
    expect(await presence.offline(who, 'phone', t0)).toBe(false); // the laptop is still here
    expect(await presence.isOnline(who, t0)).toBe(true);
    expect(await presence.offline(who, 'laptop', t0)).toBe(true);
    expect(await presence.isOnline(who, t0)).toBe(false);
    expect(await presence.lastSeen(who)).not.toBeNull();
    // Not lapsed inside the grace...
    expect(await presence.claimLapsed(t0 + PRESENCE_OFFLINE_GRACE_MS - 1)).not.toContain(who);
    // ...lapsed after it, and claimed exactly once.
    expect(await presence.claimLapsed(t0 + PRESENCE_OFFLINE_GRACE_MS + 1)).toContain(who);
    expect(await presence.claimLapsed(t0 + PRESENCE_OFFLINE_GRACE_MS + 2)).not.toContain(who);
    // And having been announced offline, coming back is a transition again.
    expect(await presence.online(who, 'phone', t0 + PRESENCE_OFFLINE_GRACE_MS + 3)).toBe(true);
  });

  it('a reconnect inside the grace is no transition, and never lapses', async () => {
    const who = randomUUID();
    const t0 = Date.now();
    await presence.online(who, 'phone', t0);
    await presence.offline(who, 'phone', t0 + 1);
    expect(await presence.online(who, 'phone', t0 + 1000)).toBe(false); // back in time: nothing to announce
    expect(await presence.claimLapsed(t0 + PRESENCE_OFFLINE_GRACE_MS + 10)).not.toContain(who);
  });

  it('a crashed node: connections that stopped heart-beating lapse and are claimed', async () => {
    const who = randomUUID();
    const t0 = Date.now();
    await presence.online(who, 'crashed', t0); // and never an offline()
    const ttlMs = 45_000;
    expect(await presence.isOnline(who, t0 + ttlMs + 1)).toBe(false);
    expect(await presence.claimLapsed(t0 + ttlMs + 1)).toContain(who);
    const snap = await presence.snapshot([who, randomUUID()], t0 + ttlMs + 2);
    expect([...snap.values()].map((v) => v.online)).toEqual([false, false]);
  });
});

describe('PD-37 gateway: announced to the audience only; offline from the sweep', () => {
  function gatewayWith(fake: Partial<PresenceService>) {
    const gw = new RealtimeGateway(
      g.authz, g.conversations, {} as never, fake as PresenceService, {} as never, {} as never,
      undefined, undefined, undefined, policy,
    );
    const sent: Array<{ to: string[]; payload: { state: string; lastSeenAt: string | null } }> = [];
    jest.spyOn(gw, 'toUsers').mockImplementation(async (to, _e, payload) => {
      sent.push({ to: [...to], payload: payload as never });
    });
    return { gw, sent };
  }
  const internals = (gw: RealtimeGateway) => gw as unknown as { wentOnline(a: Actor): void };
  const settle = () => new Promise((r) => setTimeout(r, 120));

  it("a colleague's coming online and going offline reach the audience; last seen only where allowed", async () => {
    const seenAt = new Date('2026-10-26T09:00:00.000Z');
    const { gw, sent } = gatewayWith({
      lastSeen: async () => seenAt,
      claimLapsed: async () => [s.ownerId],
    });
    const me = await actor(s.ownerId);

    internals(gw).wentOnline(me);
    await settle();
    expect(sent.every((d) => d.payload.state === 'online' && d.payload.lastSeenAt === null)).toBe(true);
    expect(sent.flatMap((d) => d.to)).toContain(s.otherAdminId);
    expect(sent.flatMap((d) => d.to)).not.toContain(s.parentId);
    expect(sent.flatMap((d) => d.to)).not.toContain(s.teacherId);

    sent.length = 0;
    await gw.sweepPresence();
    const full = sent.find((d) => d.to.includes(s.otherAdminId))!;
    expect(full.payload).toEqual({ actorId: s.ownerId, state: 'offline', lastSeenAt: seenAt.toISOString() });
    const hidden = sent.find((d) => d.to.includes(x.hider))!;
    expect(hidden.payload.lastSeenAt).toBeNull();
    await gw.onModuleDestroy().catch(() => undefined);
  });

  it('nothing lapsed, nothing announced', async () => {
    const { gw, sent } = gatewayWith({ lastSeen: async () => new Date(), claimLapsed: async () => [] });
    await gw.sweepPresence();
    expect(sent).toEqual([]);
    await gw.onModuleDestroy().catch(() => undefined);
  });

  it('a parent coming online or lapsing is announced to nobody', async () => {
    const { gw, sent } = gatewayWith({ lastSeen: async () => new Date(), claimLapsed: async () => [s.parentId] });
    internals(gw).wentOnline(await actor(s.parentId));
    await gw.sweepPresence();
    await settle();
    expect(sent).toEqual([]);
    await gw.onModuleDestroy().catch(() => undefined);
  });
});

describe('PD-37 GET /presence and /me/presence', () => {
  const controller = () => new PresenceController(g.conversations, presence, policy, g.prisma);

  it('answers only for people the caller may see; the rest are absent, not "offline"', async () => {
    await presence.online(s.otherAdminId, 'c1');
    const res = await controller().read(s.ownerId, [s.otherAdminId, x.otherOrgStaff, 'not-a-uuid'].join(','), s.teacherId);
    expect(res.presence.map((p) => p.actorId)).toEqual([s.otherAdminId]);
    expect(res.presence[0].online).toBe(true);
    expect((await controller().read(s.parentId, s.otherAdminId, undefined)).presence).toEqual([]);
  });

  it('hide my last seen: staff only, a boolean only, and it takes effect', async () => {
    await presence.online(x.teachersMember, 'c');
    await presence.offline(x.teachersMember, 'c');
    const before = await controller().read(s.ownerId, x.teachersMember, undefined);
    expect(before.presence[0].lastSeenAt).not.toBeNull();

    expect(await controller().update(s.ownerId, { hideLastSeen: true })).toEqual({ hideLastSeen: true });
    const after = await controller().read(s.ownerId, x.teachersMember, undefined);
    expect(after.presence[0].lastSeenAt).toBeNull(); // reciprocity: the hider sees nobody's

    await expect(controller().update(s.ownerId, { hideLastSeen: 'yes' })).rejects.toMatchObject({ code: CommErrorCode.VALIDATION });
    await expect(controller().update(s.parentId, { hideLastSeen: true })).rejects.toMatchObject({ code: CommErrorCode.PRESENCE_DENIED });
    await expect(controller().settings(s.teacherId)).rejects.toMatchObject({ code: CommErrorCode.PRESENCE_DENIED });
  });

  it('GET /presence is rate limited (presence_read_actor)', () => {
    const scope = Reflect.getMetadata(RATE_LIMITED_ACTION, PresenceController.prototype.read);
    expect(scope).toBe(ActionScope.PRESENCE_READ);
  });

  it('refuses more than 100 people in one question', async () => {
    const many = Array.from({ length: 101 }, () => randomUUID()).join(',');
    await expect(controller().read(s.ownerId, many, undefined)).rejects.toMatchObject({ code: CommErrorCode.VALIDATION });
  });
});

// The event name is part of the contract the clients read.
it('presence.changed is the event the gateway announces', () => {
  expect(CommEvent.PRESENCE_CHANGED).toBe('presence.changed');
});
