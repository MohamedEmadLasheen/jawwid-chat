/**
 * PD-55 PR-4: rewards a teacher gives a child during the child's lesson
 * (docs/product/pd055-whiteboard-teaching-and-rewards-plan.md §3-§4).
 *
 *   * only the learner's own teacher, in that learner's lesson, in its window,
 *     and only a lesson that took place; one star per reward, none for a
 *     celebration; a retried tap records once;
 *   * a teacher withdraws their own reward within 2 minutes, as an 'undo' row;
 *   * a record: never updated, deleted or truncated;
 *   * owner-only: no request role reads, writes or runs the helpers; the
 *     policies (defence in depth) still say the learner's family and the
 *     teacher's supervisors read, a parent of ANOTHER family reads nothing, a
 *     teacher who is not the learner's current teacher cannot insert;
 *   * concurrent identical gives and undos record once, without a 500;
 *   * delivery: the family's LIVE contacts and the teacher, resolved when the
 *     outbox drains.
 */
import { randomUUID } from 'node:crypto';
import { CommEvent } from '@communication/contracts/events';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { RewardService, badgeOf } from '../../src/rewards/reward.service';
import { Scenario, buildGraph, seed, truncate, withAssignmentGate } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let rewards: RewardService;

async function setConfig(key: string, value: unknown) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description) values ($1, $2::jsonb, 'whiteboards', 'test')
     on conflict (key) do update set value = excluded.value`,
    key,
    JSON.stringify(value),
  );
  g.config.invalidate();
}

/** A lesson of learner_l with their teacher, starting [startsInMinutes] from now. */
async function lesson(startsInMinutes = -5, length = 30, outcome: string | null = null): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, 'regular',
             now() + make_interval(mins => $3::int), now() + make_interval(mins => $3::int + $4::int), $5::uuid, 'staff')
     returning id::text as id`,
    s.learnerId, s.teacherId, startsInMinutes, length, s.ownerId,
  );
  if (outcome) {
    await g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = $2, outcome_at = now(), outcome_by_kind = 'staff', outcome_by = $3::uuid,
              outcome_note = case when $2 = 'admin_cancelled' then 'test' else null end
        where id = $1::uuid`,
      id, outcome, s.ownerId,
    );
  }
  return id;
}

const star = (lessonId: string, extra: Record<string, unknown> = {}) => ({ lessonId, kind: 'star', clientEventId: randomUUID(), ...extra });

/**
 * Runs [first] in a transaction held open until [second] has reached the database, then
 * commits it: [second] meets [first]'s uncommitted row, as two taps at once would.
 */
async function race<T>(first: (tx: typeof g.prisma) => Promise<unknown>, second: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let inserted!: () => void;
  const ready = new Promise<void>((r) => (inserted = r));
  const holder = g.prisma.$transaction(async (tx) => {
    await first(tx as never);
    inserted();
    await gate;
  }, { timeout: 30_000 });
  await ready;
  const result = second().then((v) => ({ v }), (e: unknown) => ({ e }));
  await new Promise((r) => setTimeout(r, 750));
  release();
  await holder;
  const out = await result;
  if ('e' in out) throw out.e;
  return out.v;
}

async function rows() {
  return g.prisma.$queryRaw<Array<{ id: string; kind: string; undoes: string | null }>>`
    select id::text, kind, undoes::text from chat.learner_reward_event order by created_at, id`;
}

/** What a request role sees or may do, as [actor] (a contact or teacher id), or as staff [staffId]. */
async function asRequestRole<T>(fn: (tx: typeof g.prisma) => Promise<T>, actor: { actorId?: string; staffId?: string }): Promise<T> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local role authenticated`);
    if (actor.actorId) await tx.$executeRawUnsafe(`select set_config('chat.actor_id', '${actor.actorId}', true)`);
    if (actor.staffId) await tx.$executeRawUnsafe(`select set_config('chat.actor_staff_id', '${actor.staffId}', true)`);
    return fn(tx as never);
  }) as Promise<T>;
}

/** The policies' answer for [actor], asked as the owner (no request role may run the helpers). */
async function asActor<T>(fn: (tx: typeof g.prisma) => Promise<T>, actor: { actorId?: string; staffId?: string }): Promise<T> {
  return g.prisma.$transaction(async (tx) => {
    if (actor.actorId) await tx.$executeRawUnsafe(`select set_config('chat.actor_id', '${actor.actorId}', true)`);
    if (actor.staffId) await tx.$executeRawUnsafe(`select set_config('chat.actor_staff_id', '${actor.staffId}', true)`);
    return fn(tx as never);
  }) as Promise<T>;
}

async function visibleCount(actor: { actorId?: string; staffId?: string }): Promise<number> {
  return asActor(async (tx) => {
    const [r] = await tx.$queryRaw<Array<{ n: number }>>`
      select count(*)::int as n from chat.learner_reward_event where chat.may_read_learner_rewards(learner_id, teacher_id)`;
    return r!.n;
  }, actor);
}

async function mayReward(teacher: string, actor: { actorId?: string; staffId?: string }): Promise<boolean> {
  return asActor(async (tx) => {
    const [r] = await tx.$queryRaw<Array<{ ok: boolean }>>`select chat.may_reward_learner(${s.learnerId}::uuid, ${teacher}::uuid) as ok`;
    return r!.ok;
  }, actor);
}

beforeAll(async () => {
  await g.prisma.$connect();
});
let strictScopeBefore: unknown;
beforeAll(async () => {
  const [row] = await g.prisma.$queryRaw<Array<{ value: unknown }>>`select value from chat.config where key = 'teacher_supervisor.strict_scope'`;
  strictScopeBefore = row?.value;
});
afterAll(async () => {
  await setConfig('rewards.enabled', false);
  // Other suites read the PD-35 switch: put it back as it was.
  if (strictScopeBefore === undefined) await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'teacher_supervisor.strict_scope'`);
  else await setConfig('teacher_supervisor.strict_scope', strictScopeBefore);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  await setConfig('rewards.enabled', true);
  rewards = new RewardService(g.prisma, g.config, g.conversations, g.outbox);
});

describe('giving a reward', () => {
  it('a star, a sticker and a praise stamp are a star each; a celebration none; a retried tap records once', async () => {
    const l = await lesson();
    const first = star(l);
    expect((await rewards.give(s.teacherId, s.learnerId, first)).stars).toBe(1);
    expect((await rewards.give(s.teacherId, s.learnerId, first)).stars).toBe(1);
    expect((await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'sticker', stickerKey: 'rocket', clientEventId: randomUUID() })).stars).toBe(2);
    expect((await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'praise', praiseKey: 'excellent_ar', clientEventId: randomUUID() })).stars).toBe(3);
    expect((await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'praise', praiseText: 'Lovely reading!', clientEventId: randomUUID() })).stars).toBe(4);
    expect((await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'celebration', clientEventId: randomUUID() })).stars).toBe(4);
    expect(await rows()).toHaveLength(5);

    const given = await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.LEARNER_REWARD_GIVEN }, orderBy: { createdAt: 'asc' } });
    expect(given).toHaveLength(5);
    expect(given[0]!.payload).toMatchObject({ learnerId: s.learnerId, lessonId: l, kind: 'star', stars: 1 });
    expect(given[4]!.payload).toMatchObject({ kind: 'celebration', stars: 4 });
  });

  it('refuses a bad shape: an unknown kind, a sticker or praise not in the catalogue, praise over 40 characters', async () => {
    const l = await lesson();
    for (const bad of [
      { kind: 'gold_bar' },
      { kind: 'sticker', stickerKey: 'skull' },
      { kind: 'praise', praiseKey: 'mashallah' },
      { kind: 'praise', praiseText: 'x'.repeat(41) },
    ]) {
      await expect(rewards.give(s.teacherId, s.learnerId, { lessonId: l, clientEventId: randomUUID(), ...bad })).rejects.toMatchObject({ code: 'COMMON.VALIDATION' });
    }
    expect(await rows()).toHaveLength(0);
  });

  it('only in the lesson\'s window: from 10 minutes before it to 30 after', async () => {
    const early = await lesson(20, 5);
    await expect(rewards.give(s.teacherId, s.learnerId, star(early))).rejects.toMatchObject({ status: 409 });
    const soon = await lesson(8, 5);
    expect((await rewards.give(s.teacherId, s.learnerId, star(soon))).stars).toBe(1);
    const over = await lesson(-70, 30); // ended 40 minutes ago
    await expect(rewards.give(s.teacherId, s.learnerId, star(over))).rejects.toMatchObject({ status: 409 });
  });

  it('only in a lesson that took place: never a no-show or cancelled one (voided is refused by the same rule)', async () => {
    // Each inside the window (one teacher is never double-booked, so they follow each other).
    let at = -9;
    for (const outcome of ['teacher_no_show', 'student_no_show', 'admin_cancelled']) {
      const l = await lesson(at, 2, outcome);
      at += 3;
      await expect(rewards.give(s.teacherId, s.learnerId, star(l))).rejects.toMatchObject({ status: 409 });
    }
    // An open lesson in the window still takes one (a held one does too: the
    // same rule, outcome null or held; a held lesson needs a report to exist).
    const open = await lesson(at, 2);
    expect((await rewards.give(s.teacherId, s.learnerId, star(open))).stars).toBe(1);
  });

  it('only the learner\'s own teacher: another teacher, a parent and staff are told there is no such lesson', async () => {
    const l = await lesson();
    for (const who of [s.unrelatedTeacherId, s.newTeacherId, s.parentId, s.ownerId]) {
      await expect(rewards.give(who, s.learnerId, star(l))).rejects.toMatchObject({ status: 404 });
    }
    // The right teacher, the wrong learner: the same answer.
    await expect(rewards.give(s.teacherId, s.secondLearnerId, star(l))).rejects.toMatchObject({ status: 404 });
    expect(await rows()).toHaveLength(0);
  });

  it('is off -- 404 for everyone -- until rewards.enabled is on', async () => {
    const l = await lesson();
    await setConfig('rewards.enabled', false);
    await expect(rewards.give(s.teacherId, s.learnerId, star(l))).rejects.toMatchObject({ status: 404 });
    await expect(rewards.lessonsNow(s.teacherId)).rejects.toMatchObject({ status: 404 });
  });

  it('is off in the database too: the guard refuses every new row, even the owner\'s', async () => {
    const l = await lesson();
    await setConfig('rewards.enabled', false);
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.learner_reward_event (organization_id, learner_id, lesson_id, teacher_id, kind, client_event_id)
         values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, 'star', gen_random_uuid())`,
        s.learnerId, l, s.teacherId,
      ),
    ).rejects.toThrow(/rewards are off/);
    expect(await rows()).toHaveLength(0);
  });

  it('two identical taps at once record once: the second replays the first (not a 500)', async () => {
    const l = await lesson();
    const tap = star(l);
    const firstId = randomUUID();
    const second = await race(
      (tx) => tx.$executeRawUnsafe(
        `insert into chat.learner_reward_event (id, organization_id, learner_id, lesson_id, teacher_id, kind, client_event_id)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid, $4::uuid, 'star', $5::uuid)`,
        firstId, s.learnerId, l, s.teacherId, tap.clientEventId,
      ),
      () => rewards.give(s.teacherId, s.learnerId, tap),
    );
    expect(second.event.id).toBe(firstId);
    expect(second.stars).toBe(1);
    expect(await rows()).toHaveLength(1);
    expect(await g.prisma.outboxEvent.count({ where: { type: CommEvent.LEARNER_REWARD_GIVEN } })).toBe(0);
  });

  it('a clientEventId already used for another lesson is a conflict, not a replay', async () => {
    const earlier = await lesson(-40, 30); // ended 10 minutes ago: still in its window
    const now = await lesson();
    const tap = star(earlier);
    await rewards.give(s.teacherId, s.learnerId, tap);
    await expect(rewards.give(s.teacherId, s.learnerId, { ...tap, lessonId: now })).rejects.toMatchObject({ status: 409 });
    expect(await rows()).toHaveLength(1);
  });

  it('the tray\'s "For": the teacher\'s lessons on now, with each learner and their stars -- nobody else\'s', async () => {
    const now = await lesson();
    await lesson(120); // later today: not on now
    await rewards.give(s.teacherId, s.learnerId, star(now));
    expect(await rewards.lessonsNow(s.teacherId)).toEqual({
      lessons: [expect.objectContaining({ lessonId: now, learnerId: s.learnerId, learnerName: 'learner_l', stars: 1 })],
    });
    expect((await rewards.lessonsNow(s.newTeacherId)).lessons).toEqual([]);
  });
});

describe('the tally and its badges (PR-5)', () => {
  it('a badge for effort at each threshold, and the stars the next one needs -- from the configured thresholds', () => {
    expect(badgeOf(0, [3, 6, 10])).toEqual({ badge: null, nextBadgeAt: 3 });
    expect(badgeOf(4, [3, 6, 10])).toEqual({ badge: 'bronze', nextBadgeAt: 6 });
    expect(badgeOf(6, [3, 6, 10])).toEqual({ badge: 'silver', nextBadgeAt: 10 });
    expect(badgeOf(12, [3, 6, 10])).toEqual({ badge: 'gold', nextBadgeAt: null });
    expect(badgeOf(2, [10, 2, 5])).toEqual({ badge: 'bronze', nextBadgeAt: 5 });
  });

  it('the live event, the tray and the report all carry the same tally', async () => {
    const l = await lesson();
    for (let i = 0; i < 3; i++) await rewards.give(s.teacherId, s.learnerId, star(l));
    const given = await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.LEARNER_REWARD_GIVEN }, orderBy: { createdAt: 'asc' } });
    expect(given[2]!.payload).toMatchObject({ stars: 3, badge: 'bronze', nextBadgeAt: 6 });
    expect((await rewards.lessonsNow(s.teacherId)).lessons[0]).toMatchObject({ stars: 3, badge: 'bronze', nextBadgeAt: 6 });
    await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'praise', praiseKey: 'excellent_ar', clientEventId: randomUUID() });
    await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'praise', praiseText: 'Lovely!', clientEventId: randomUUID() });
    expect(await rewards.forLesson(s.parentId, l)).toEqual({
      stars: 5,
      badge: 'bronze',
      nextBadgeAt: 6,
      praise: [{ key: 'excellent_ar', text: null }, { key: null, text: 'Lovely!' }],
    });
  });

  it('the report\'s tally: the teacher, the family and the staff who supervise the teacher (strict, whatever the PD-35 switch says) -- a parent of ANOTHER family and another teacher get 404', async () => {
    const l = await lesson();
    await rewards.give(s.teacherId, s.learnerId, star(l));
    expect((await rewards.forLesson(s.teacherId, l)).stars).toBe(1);
    expect((await rewards.forLesson(s.otherParentId, l)).stars).toBe(1);

    const family = randomUUID(), outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_other', $2::uuid, 'en')`, family, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values ($1::uuid, $2::uuid, 'parent_other', 'primary_guardian', true, true)`,
      outsider, family,
    );
    for (const who of [outsider, s.unrelatedTeacherId, s.newTeacherId]) {
      await expect(rewards.forLesson(who, l)).rejects.toMatchObject({ status: 404 });
    }
    // Staff reach is strict whatever TEACHER_SUPERVISOR_STRICT_SCOPE says: staff
    // who supervise no teacher are told there is no such lesson -- with the
    // department-wide switch on or off.
    for (const strict of [false, true]) {
      await setConfig('teacher_supervisor.strict_scope', strict);
      await expect(rewards.forLesson(s.ownerId, l)).rejects.toMatchObject({ status: 404 });
    }
    // A Teachers supervisor: only once assigned this teacher -- again either way.
    const manager = randomUUID();
    const supervisor = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'teachers_mgr', 'manager', true), ($2::uuid, 'teachers_sup', 'admin', true)`,
      manager, supervisor,
    );
    const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, manager,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      supervisor, dept,
    );
    for (const strict of [false, true]) {
      await setConfig('teacher_supervisor.strict_scope', strict);
      await expect(rewards.forLesson(supervisor, l)).rejects.toMatchObject({ status: 404 });
    }
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
      s.teacherId, supervisor,
    );
    for (const strict of [false, true]) {
      await setConfig('teacher_supervisor.strict_scope', strict);
      expect((await rewards.forLesson(supervisor, l)).stars).toBe(1);
    }
    // The Teachers manager supervises every teacher.
    expect((await rewards.forLesson(manager, l)).stars).toBe(1);
    const superAdmin = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root', 'super_admin', true)`, superAdmin);
    });
    expect((await rewards.forLesson(superAdmin, l)).stars).toBe(1);
  });
});

describe('withdrawing a mistaken reward', () => {
  it('within 2 minutes, by its teacher: the star goes, as a neutral undo row; twice changes nothing', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    await rewards.give(s.teacherId, s.learnerId, star(l));
    expect((await rewards.undo(s.teacherId, s.learnerId, event.id)).stars).toBe(1);
    expect((await rewards.undo(s.teacherId, s.learnerId, event.id)).stars).toBe(1);
    expect((await rows()).map((r) => r.kind)).toEqual(['star', 'star', 'undo']);
    const undone = await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.LEARNER_REWARD_UNDONE } });
    expect(undone).toHaveLength(1);
    expect(undone[0]!.payload).toMatchObject({ eventId: event.id, stars: 1 });
    // Another teacher cannot withdraw it.
    const { event: second } = await rewards.give(s.teacherId, s.learnerId, star(l));
    await expect(rewards.undo(s.newTeacherId, s.learnerId, second.id)).rejects.toMatchObject({ status: 404 });
  });

  it('two identical undos at once withdraw it once: the second changes nothing (not a 500)', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    const second = await race(
      (tx) => tx.$executeRawUnsafe(
        `insert into chat.learner_reward_event (organization_id, learner_id, lesson_id, teacher_id, kind, undoes, client_event_id)
         values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, 'undo', $4::uuid, gen_random_uuid())`,
        s.learnerId, l, s.teacherId, event.id,
      ),
      () => rewards.undo(s.teacherId, s.learnerId, event.id),
    );
    expect(second.stars).toBe(0);
    expect((await rows()).map((r) => r.kind)).toEqual(['star', 'undo']);
    expect(await g.prisma.outboxEvent.count({ where: { type: CommEvent.LEARNER_REWARD_UNDONE } })).toBe(0);
  });

  it('after the learner moves to another teacher, the old teacher\'s undo is 404 (not a 500)', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid where id = '${s.learnerId}'::uuid`);
    await expect(rewards.undo(s.teacherId, s.learnerId, event.id)).rejects.toMatchObject({ status: 404 });
    expect((await rows()).map((r) => r.kind)).toEqual(['star']);
  });

  it('is off while rewards.enabled is off: 404, and nothing is withdrawn', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    await setConfig('rewards.enabled', false);
    await expect(rewards.undo(s.teacherId, s.learnerId, event.id)).rejects.toMatchObject({ status: 404 });
    expect((await rows()).map((r) => r.kind)).toEqual(['star']);
  });

  it('not after 2 minutes -- in the API and in the database', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    // Age the reward (the record guard forbids updates; the test steps around it as the owner).
    await g.prisma.$executeRawUnsafe(`alter table chat.learner_reward_event disable trigger learner_reward_event_is_a_record`);
    await g.prisma.$executeRawUnsafe(`update chat.learner_reward_event set created_at = now() - interval '3 minutes' where id = $1::uuid`, event.id);
    await g.prisma.$executeRawUnsafe(`alter table chat.learner_reward_event enable trigger learner_reward_event_is_a_record`);
    await expect(rewards.undo(s.teacherId, s.learnerId, event.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.learner_reward_event (organization_id, learner_id, lesson_id, teacher_id, kind, undoes, client_event_id)
         values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, 'undo', $4::uuid, gen_random_uuid())`,
        s.learnerId, l, s.teacherId, event.id,
      ),
    ).rejects.toThrow(/within 2 minutes/);
  });
});

describe('a record', () => {
  it('is never updated, deleted or truncated', async () => {
    const l = await lesson();
    const { event } = await rewards.give(s.teacherId, s.learnerId, star(l));
    await expect(g.prisma.$executeRawUnsafe(`update chat.learner_reward_event set kind = 'celebration' where id = $1::uuid`, event.id)).rejects.toThrow(/never changed/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.learner_reward_event where id = $1::uuid`, event.id)).rejects.toThrow(/never deleted/);
    await expect(g.prisma.$executeRawUnsafe(`truncate chat.learner_reward_event`)).rejects.toThrow(/never truncated/);
    expect(await rows()).toHaveLength(1);
  });
});

describe('access: owner-only, with the policies as defence in depth', () => {
  let otherFamilyParent: string;
  let l: string;

  beforeEach(async () => {
    const family = randomUUID();
    otherFamilyParent = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_other', $2::uuid, 'en')`, family, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values ($1::uuid, $2::uuid, 'parent_other', 'primary_guardian', true, true)`,
      otherFamilyParent, family,
    );
    l = await lesson();
    await rewards.give(s.teacherId, s.learnerId, star(l));
    await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'celebration', clientEventId: randomUUID() });
  });

  it('the learner\'s family and teacher read; a parent of ANOTHER family reads 0 rows; so does staff who supervise no teacher', async () => {
    expect(await visibleCount({ actorId: s.parentId })).toBe(2);
    expect(await visibleCount({ actorId: s.otherParentId })).toBe(2);
    expect(await visibleCount({ actorId: s.teacherId })).toBe(2);
    expect(await visibleCount({ actorId: otherFamilyParent })).toBe(0);
    expect(await visibleCount({ actorId: s.unrelatedTeacherId })).toBe(0);
    expect(await visibleCount({ staffId: s.ownerId })).toBe(0);
    expect(await visibleCount({})).toBe(0);
  });

  it('a super admin -- who supervises every teacher -- reads them', async () => {
    const superAdmin = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root', 'super_admin', true)`, superAdmin);
    });
    expect(await visibleCount({ staffId: superAdmin })).toBe(2);
  });

  it('the policy lets only the learner\'s current teacher, as themself, insert', async () => {
    expect(await mayReward(s.teacherId, { actorId: s.teacherId })).toBe(true);
    expect(await mayReward(s.teacherId, { actorId: s.newTeacherId })).toBe(false);
    expect(await mayReward(s.newTeacherId, { actorId: s.newTeacherId })).toBe(false);
    expect(await mayReward(s.teacherId, { actorId: s.parentId })).toBe(false);
  });

  it('a request role cannot read, insert, update or delete -- not even the learner\'s own teacher -- nor run the helpers', async () => {
    const insert = (tx: typeof g.prisma) =>
      tx.$executeRawUnsafe(
        `insert into chat.learner_reward_event (organization_id, learner_id, lesson_id, teacher_id, kind, client_event_id)
         values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, 'star', gen_random_uuid())`,
        s.learnerId, l, s.teacherId,
      );
    const me = { actorId: s.teacherId };
    await expect(asRequestRole(insert, me)).rejects.toThrow(/permission denied/);
    await expect(asRequestRole((tx) => tx.$queryRawUnsafe(`select * from chat.learner_reward_event`), me)).rejects.toThrow(/permission denied/);
    await expect(asRequestRole((tx) => tx.$executeRawUnsafe(`update chat.learner_reward_event set kind = 'star'`), me)).rejects.toThrow(/permission denied/);
    await expect(asRequestRole((tx) => tx.$executeRawUnsafe(`delete from chat.learner_reward_event`), me)).rejects.toThrow(/permission denied/);
    await expect(
      asRequestRole((tx) => tx.$queryRawUnsafe(`select chat.may_reward_learner($1::uuid, $2::uuid)`, s.learnerId, s.teacherId), me),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRequestRole((tx) => tx.$queryRawUnsafe(`select chat.may_read_learner_rewards($1::uuid, $2::uuid)`, s.learnerId, s.teacherId), me),
    ).rejects.toThrow(/permission denied/);
    expect(await rows()).toHaveLength(2);
  });
});

describe('delivery', () => {
  it('to the family\'s live contacts and the teacher, resolved when the outbox drains: a contact deactivated meanwhile is not told', async () => {
    const sent: Array<{ ids: string[]; event: string }> = [];
    const realtime = {
      toUsers: async (ids: string[], event: string) => {
        sent.push({ ids: [...ids].sort(), event });
      },
      toThread: async () => undefined,
    };
    const worker = new OutboxWorker(
      g.prisma,
      new NotificationService(g.prisma, g.templates, g.quietHours, g.config, { send: async () => ({ ok: true }) } as never),
      realtime as never,
      g.identity,
    );
    const l = await lesson();
    await rewards.give(s.teacherId, s.learnerId, { lessonId: l, kind: 'celebration', clientEventId: randomUUID() });
    await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = $1::uuid`, s.otherParentId);
    await worker.drain(100);
    await worker.drain(100);
    const given = sent.filter((x) => x.event === CommEvent.LEARNER_REWARD_GIVEN);
    expect(given).toHaveLength(1);
    expect(given[0]!.ids).toEqual([s.parentId, s.teacherId].sort());
  });
});
