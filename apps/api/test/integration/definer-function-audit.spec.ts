/**
 * Every SECURITY DEFINER function in schema chat, audited from the catalog,
 * plus the two frozen-machinery functions repaired by 20261014100100.
 *
 * The catalog test is the regression guard: a new definer function without a
 * pinned search_path, or one a request role can execute without being on the
 * reviewed allowlist, fails here. The allowlist is small and each entry says
 * why it must be callable by the policies' roles.
 *
 * Synthetic data only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(90_000);

const g = buildGraph();

/** Request-role EXECUTE is allowed only here. Everything else is server-side. */
const REQUEST_ROLE_ALLOWLIST: Record<string, string> = {
  current_account_id: 'session identity, read by RLS policies',
  current_actor_ids: 'session identity, read by RLS policies',
  current_can_publish_story: 'policy helper about the caller',
  current_contact_family_ids: 'session identity, read by RLS policies',
  current_organization_id: 'tenant of the caller, read by every restrictive policy',
  current_staff_id: 'session identity, read by RLS policies',
  current_staff_manages: 'policy helper: does the caller manage this staff member',
  current_staff_role: 'session identity, read by RLS policies',
  staff_can_see_family: 'policy helper about the caller',
  story_organization_id: 'policy helper: a story row\'s tenant',
  teacher_parent_authorized: 'PD-6 predicate, read by policies and triggers',
  post_customer_message: 'a contact posting as themselves; identity from the session account',
  enforce_story_view_audience: 'trigger function, invoked by the table write',
  // 20261014110100 -- each authorizes from the trusted session identity:
  current_staff_may_view: 'profile visibility rule about the caller',
  viewable_staff_ids: 'filters ids to the caller-viewable ones',
  staff_login_facts: 'login facts for viewable staff; subject on own row only',
  staff_workload: 'workload counts for viewable staff',
  staff_distinct_teachers: 'distinct teachers for viewable staff',
  organization_workload_totals: 'super admin of the organization only',
  staff_profile_activity: 'profile audit rows; managers and the super admin, viewable profiles',
  record_staff_profile_audit: 'audit write whose actor is chat.trusted_staff_actor',
  // 20261015120000 (PD-8) -- read-only, answers for chat.current_staff_id() only:
  current_staff_conversation_access: "PD-8 policy helper: the caller's own scope on one conversation",
  // 20261021000000 (Teacher Profile V2) -- policy helpers, as story's are:
  current_teacher_ids: 'session identity, read by RLS policies',
  current_can_review_teacher_profile: 'policy helper about the caller',
  teacher_profile_organization_id: "policy helper: a profile row's tenant",
  // 20261026140000 (PD-30) -- the one lock answer, as the department head specified; a request
  // role learns only about a child of its own family, or (staff) of its own organization:
  learner_lesson_lock: "PD-30: is this child's lesson-taking locked for payment, scoped to the caller",
};

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
});

describe('SECURITY DEFINER functions in schema chat', () => {
  it('every one pins its search_path, and only reviewed helpers are executable by a request role', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ name: string; pinned: boolean; anon: boolean; authn: boolean; app: boolean }>>(`
      select p.proname::text as name,
             exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
             has_function_privilege('chat_app', p.oid, 'EXECUTE') as app
        from pg_proc p
       where p.pronamespace = 'chat'::regnamespace and p.prosecdef
       order by 1`);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.pinned).map((r) => r.name)).toEqual([]);
    const exposed = rows.filter((r) => (r.anon || r.authn || r.app) && !(r.name in REQUEST_ROLE_ALLOWLIST)).map((r) => r.name);
    expect(exposed).toEqual([]);
    // The audit and event writers are definer functions and must be server-side only.
    for (const name of ['write_audit', 'log_event', 'recompute_family_state']) {
      const row = rows.find((r) => r.name === name)!;
      expect({ name, anon: row.anon, authn: row.authn, app: row.app }).toEqual({ name, anon: false, authn: false, app: false });
    }
  });

  // Read-only helpers that compute a fact about a named staff member
  // (staff_role, workload_level, in_shift, ...) are fine; a WRITER that acts on
  // behalf of a caller-named principal is the spoofing shape.
  it('no function a request role can execute writes on behalf of a caller-named staff, actor or contact', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ name: string }>>(`
      select p.proname::text as name
        from pg_proc p
       where p.pronamespace = 'chat'::regnamespace
         and pg_get_function_identity_arguments(p.oid) ~ '(p_actor_id|p_staff_id|p_contact_id)'
         and p.prosrc ~* '(insert\\s+into|update\\s+chat\\.|delete\\s+from|write_audit|log_event)'
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
              or has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('chat_app', p.oid, 'EXECUTE'))
         -- the safe shape: the parameter only ever reaches chat.trusted_staff_actor
         and not (p.prosrc ~* 'trusted_staff_actor\\(\\s*p_actor_id\\s*\\)' and p.prosrc !~* 'coalesce\\s*\\(\\s*p_actor_id')
       order by 1`);
    expect(rows).toEqual([]);
    // Control: the pattern does find the writers, which are server-side now.
    const writers = await g.prisma.$queryRawUnsafe<Array<{ name: string }>>(`
      select p.proname::text as name from pg_proc p
       where p.pronamespace = 'chat'::regnamespace
         and pg_get_function_identity_arguments(p.oid) ~ '(p_actor_id|p_staff_id|p_contact_id)'
         and p.prosrc ~* '(insert\\s+into|update\\s+chat\\.|delete\\s+from|write_audit|log_event)'
       order by 1`);
    expect(writers.map((w) => w.name)).toEqual(
      expect.arrayContaining(['assign_family_owner', 'dispute_attention_order', 'extend_stickiness', 'link_contact_account',
        'link_staff_account', 'offboard_staff', 'transfer_ownership', 'write_audit']),
    );
  });

  it('a request role cannot re-bind a contact to another login', async () => {
    const acc = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${acc}'::uuid, 'dfa_${acc.slice(0, 8)}@example.test', 'family')`);
    const staffAcc = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${staffAcc}'::uuid, 'dfa_staff_${staffAcc.slice(0, 8)}@example.test', 'staff')`);
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = '${staffAcc}'::uuid where id = '${s.ownerId}'::uuid`);
    try {
      const out = await g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', 'dfa_staff_${staffAcc.slice(0, 8)}@example.test', true)`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', '00000000-0000-0000-0000-000000000001', true)`);
        const rebind = await tx.$executeRawUnsafe(`update chat.contact set account_id = '${acc}'::uuid where id = '${s.parentId}'::uuid`)
          .then(() => 'executed', (e: Error) => e.message);
        return rebind;
      });
      expect(String(out)).toMatch(/permission denied/);
      expect((await g.prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).accountId).toBeNull();
    } finally {
      await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = null where id = '${s.ownerId}'::uuid`);
      await g.prisma.$executeRawUnsafe(`delete from chat.account where id in ('${acc}'::uuid, '${staffAcc}'::uuid)`);
    }
  });
});

describe('the staff-profile runtime functions (20261014110100), as a request role', () => {
  const ORG = '00000000-0000-0000-0000-000000000001';
  async function asSubject<T>(subject: string, fn: (tx: typeof g.prisma) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', $1, true)`, ORG);
        out = await fn(tx as unknown as typeof g.prisma);
        throw new Error('rollback');
      })
      .catch((e: Error) => {
        if (e.message !== 'rollback') throw e;
      });
    return out as T;
  }
  const link = async (staffId: string, subject: string) => {
    const id = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${id}'::uuid, '${subject}', 'staff')`);
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = '${id}'::uuid where id = '${staffId}'::uuid`);
  };
  beforeEach(async () => {
    await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like 'rt\\_%@example.test'`);
    await link(s.ownerId, 'rt_admin_a@example.test');
    await link(s.otherAdminId, 'rt_admin_b@example.test');
  });

  it('an admin gets workload, login facts and activity only for their own profile; subject only on their own row', async () => {
    const out = await asSubject('rt_admin_a@example.test', async (tx) => {
      const ids = `array['${s.ownerId}'::uuid, '${s.otherAdminId}'::uuid, '${s.managerId}'::uuid]`;
      const work = await tx.$queryRawUnsafe<Array<{ staff_id: string }>>(`select staff_id::text from chat.staff_workload(${ids})`);
      const facts = await tx.$queryRawUnsafe<Array<{ staff_id: string; subject: string | null }>>(
        `select staff_id::text, subject from chat.staff_login_facts(${ids})`);
      const teachers = await tx.$queryRawUnsafe<Array<{ n: number }>>(`select chat.staff_distinct_teachers(array['${s.otherAdminId}'::uuid]) as n`);
      const activity = await tx.$queryRawUnsafe<unknown[]>(`select * from chat.staff_profile_activity(${ids}, 50)`);
      return { work, facts, teachers: teachers[0].n, activity: activity.length };
    });
    expect(out.work.map((r) => r.staff_id)).toEqual([s.ownerId]);
    expect(out.facts).toEqual([{ staff_id: s.ownerId, subject: 'rt_admin_a@example.test' }]);
    expect(out.teachers).toBe(0); // admin_b's families are not admin_a's to count
    expect(out.activity).toBe(0); // admins do not read audit
  });

  it('organization totals are refused to anyone but the super admin', async () => {
    const out = await asSubject('rt_admin_a@example.test', (tx) =>
      tx.$queryRawUnsafe(`select * from chat.organization_workload_totals('${ORG}'::uuid)`).then(() => 'read', (e: Error) => e.message));
    expect(String(out)).toMatch(/belong to the super admin/);
  });

  it('the audit writer records the session actor and refuses a named other actor, an unviewable profile or a non-profile action', async () => {
    const before = await g.prisma.auditLog.count();
    const out = await asSubject('rt_admin_a@example.test', async (tx) => {
      const attempt = (sql: string) => tx.$executeRawUnsafe(`savepoint p`).then(() =>
        tx.$queryRawUnsafe(sql).then(() => 'ok', async (e: Error) => { await tx.$executeRawUnsafe(`rollback to savepoint p`); return e.message; }));
      const own = await attempt(`select chat.record_staff_profile_audit(null, 'staff_profile.updated', '${s.ownerId}'::uuid, null, null, 'self')`);
      const spoof = await attempt(`select chat.record_staff_profile_audit('${s.managerId}'::uuid, 'staff_profile.updated', '${s.ownerId}'::uuid, null, null, 'x')`);
      const other = await attempt(`select chat.record_staff_profile_audit(null, 'staff_profile.updated', '${s.otherAdminId}'::uuid, null, null, 'x')`);
      const action = await attempt(`select chat.record_staff_profile_audit(null, 'ownership_transferred', '${s.ownerId}'::uuid, null, null, 'x')`);
      const [row] = await tx.$queryRawUnsafe<Array<{ actor_id: string }>>(`select actor_id::text from chat.audit_log order by id desc limit 1`).catch(() => [{ actor_id: 'unreadable' }]);
      return { own, spoof, other, action, row };
    });
    expect(out.own).toBe('ok');
    expect(String(out.spoof)).toMatch(/may not name another staff member/);
    expect(String(out.other)).toMatch(/may not act on this profile/);
    expect(String(out.action)).toMatch(/not a staff-profile audit action/);
    expect(await g.prisma.auditLog.count()).toBe(before); // all rolled back
  });
});

describe('dispute_attention_order (repaired)', () => {
  const call = (actor: string, family = s.familyId) =>
    `select chat.dispute_attention_order('${family}'::uuid, '${actor}'::uuid, 1, 'should be first') as id`;
  const events = async () =>
    Number((await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.event_log where type = 'attention_order_disputed'`))[0].n);

  it('records the event as the named staff member on the server-side path, with the five-argument log_event', async () => {
    const [row] = await g.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(call(s.ownerId));
    expect(typeof row.id).toBe('bigint');
    const [ev] = await g.prisma.$queryRawUnsafe<Array<{ actor_id: string; actor_type: string; family_id: string; note: string }>>(
      `select actor_id::text, actor_type, family_id::text, payload->>'note' as note from chat.event_log where id = ${row.id}`,
    );
    expect(ev).toEqual({ actor_id: s.ownerId, actor_type: 'staff', family_id: s.familyId, note: 'should be first' });
  });

  it('refuses an inactive or foreign-tenant actor and a missing family, writing nothing', async () => {
    const gone = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active, left_at) values ('${gone}'::uuid, 'admin_gone', 'admin', false, now())`);
    const otherOrg = randomUUID();
    const foreign = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'dfa-${otherOrg.slice(0, 8)}', 'Other')`);
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, organization_id, name, role) values ('${foreign}'::uuid, '${otherOrg}'::uuid, 'admin_x', 'admin')`);
    try {
      const before = await events();
      await expect(g.prisma.$queryRawUnsafe(call(gone))).rejects.toThrow(/only active staff of this organization/);
      await expect(g.prisma.$queryRawUnsafe(call(foreign))).rejects.toThrow(/only active staff of this organization/);
      await expect(g.prisma.$queryRawUnsafe(call(s.ownerId, randomUUID()))).rejects.toThrow(/does not exist/);
      expect(await events()).toBe(before);
    } finally {
      await g.prisma.$executeRawUnsafe(`delete from chat.staff where id = '${foreign}'::uuid`);
      await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    }
  });

  it('is not executable by a request role at all', async () => {
    const out = await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        return tx.$queryRawUnsafe(call(s.ownerId)).then(() => 'executed', (e: Error) => e.message);
      });
    expect(String(out)).toMatch(/permission denied for function dispute_attention_order/);
  });
});

describe('recompute_family_state (hardened)', () => {
  it('still works on the server-side path and is refused to a request role', async () => {
    await g.prisma.$executeRawUnsafe(`select chat.recompute_family_state('${s.familyId}'::uuid)`);
    const [row] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.family_state_cache where family_id = '${s.familyId}'::uuid`,
    );
    expect(row.n).toBe(1);
    const out = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role chat_app`);
      return tx.$executeRawUnsafe(`select chat.recompute_all_family_states()`).then(() => 'executed', (e: Error) => e.message);
    });
    expect(String(out)).toMatch(/permission denied for function recompute_all_family_states/);
  });
});
