/**
 * PHASE 6 UNDER THE LEAST-PRIVILEGED RUNTIME ROLE.
 *
 * Every other Phase 6 suite runs as the database OWNER, which BYPASSES RLS --
 * so those suites prove the SERVICE layer and say nothing whatever about the
 * second one. This suite connects as `chat_app`: NOBYPASSRLS, owns nothing, and
 * is the role a correctly deployed API connects as.
 *
 * Phase 6 adds two tables carrying privileged operational data -- the detection
 * patterns the academy runs, and the record of what each held message matched --
 * so the policies have to be proved in both directions:
 *
 *   1. the product still WORKS through the role (least privilege that takes the
 *      product down is not a security improvement); and
 *   2. the policies actually CONSTRAIN, with the service layer removed from the
 *      picture entirely -- raw SQL, as the connection, with no service to ask.
 *
 * THE SPECIFIC MISTAKE THIS SUITE EXISTS TO CATCH. Phase 5 shipped a
 * `for all to chat_app using (true)` policy once. It reads as "let the
 * application work" and is in fact PERMISSIVE: it ORs with every other policy
 * on the table and silently cancels every read restriction beside it. Nothing
 * failed, because the service layer was still correct. The last three tests
 * here would have failed.
 */
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';
import { MatchType, ModerationCategory, ModerationSeverity } from '@communication/contracts/vocab';

const owner = new PrismaService();
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const g = buildGraphOn(app);

let s: Scenario;

async function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  const actor = (await owner.$queryRawUnsafe<Array<{ subject: string; org: string; kind: string }>>(
    `select a.subject, a.organization_id::text as org, a.kind
       from chat.account a
       left join chat.staff   s on s.account_id = a.id
       left join chat.contact c on c.account_id = a.id
       left join chat.teacher t on t.account_id = a.id
      where s.id = '${actorId}'::uuid or c.id = '${actorId}'::uuid or t.id = '${actorId}'::uuid
      limit 1`,
  ))[0];
  return app.runWithActor(
    { actorId, kind: actor.kind as 'staff' | 'contact' | 'teacher', organizationId: actor.org },
    actor.subject,
    fn,
  );
}

/**
 * A raw read AS THE ACTOR, with no service in the way.
 *
 * Through `app`, NOT through `connection`. The actor context is set with
 * `set_config(..., true)` -- TRANSACTION-local -- so a statement issued on the
 * bare connection runs with no actor at all and every policy evaluates false.
 * That returns zero rows, which looks exactly like a policy correctly refusing
 * a read, and would make every negative assertion below pass for the wrong
 * reason. The positive assertions are what catch it.
 */
async function readAs<T>(actorId: string, sql: string): Promise<T[]> {
  return asActor(actorId, () => app.$queryRawUnsafe<T[]>(sql));
}

const PHONE_BODY = 'call me on +201012345678';

beforeEach(async () => {
  await truncate(owner);
  s = await seed(owner);
  g.coverage.onDutyId = s.ownerId;
  g.moderationRules.invalidate();
  g.config.invalidate();
});

afterAll(async () => {
  await truncate(owner);
  await Promise.all([owner.$disconnect(), connection.$disconnect()]);
});

// =========================================================================
describe('Phase 6 works through chat_app', () => {
  it('a teacher\'s flagged message is held, and the flags are written', async () => {
    const group = await asActor(s.ownerId, () =>
      g.conversations.ensureStudentGroup(s.learnerId, s.ownerId),
    );
    const msg = await asActor(s.teacherId, () =>
      g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY }),
    );
    expect(msg.moderation).toBe('pending');

    // Written through the least-privileged connection, so the INSERT policy and
    // the grant both allow what the product actually does.
    const flags = await owner.messageModerationFlag.findMany({ where: { messageId: msg.id } });
    expect(flags.length).toBeGreaterThan(0);
  });

  it('a supervisor works the queue end to end', async () => {
    const group = await asActor(s.ownerId, () =>
      g.conversations.ensureStudentGroup(s.learnerId, s.ownerId),
    );
    const msg = await asActor(s.teacherId, () =>
      g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY }),
    );

    const queue = await asActor(s.ownerId, () => g.approvals.listPending(s.ownerId));
    expect(queue.map((a) => a.messageId)).toContain(msg.id);
    // The reason reached the queue THROUGH the read policy, which is the half
    // a service-layer test cannot see.
    expect(queue[0].flags.length).toBeGreaterThan(0);

    await asActor(s.ownerId, () =>
      g.approvals.editThenSend(queue[0].approvalId, s.ownerId, 'message me here instead'),
    );
    const after = await owner.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe('published');
    expect(after!.body).toBe('message me here instead');
    // The append-only revision was written through the role too.
    expect(await owner.messageRevision.count({ where: { messageId: msg.id } })).toBe(1);
  });

  it('a manager creates and disables a rule', async () => {
    const rule = await asActor(s.managerId, () =>
      g.moderationRules.create(s.managerId, {
        name: 'Refund promise',
        category: ModerationCategory.CUSTOM,
        severity: ModerationSeverity.HIGH,
        matchType: MatchType.PHRASE,
        pattern: 'i will refund you',
      }),
    );
    const disabled = await asActor(s.managerId, () =>
      g.moderationRules.setEnabled(s.managerId, rule.id, false),
    );
    expect(disabled.isEnabled).toBe(false);
  });

  it('the escalation sweep runs, and its writes are not blocked', async () => {
    const group = await asActor(s.ownerId, () =>
      g.conversations.ensureStudentGroup(s.learnerId, s.ownerId),
    );
    const msg = await asActor(s.teacherId, () =>
      g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY }),
    );
    await owner.$executeRawUnsafe(
      `update chat.message_approval set created_at = now() - interval '9 hours'
        where message_id = '${msg.id}'::uuid`,
    );

    // The sweep runs in the WORKER, which connects as chat_service and bypasses
    // RLS by design (RLS-STRATEGY.md §6) -- so it is driven on the owner graph,
    // which is the deployed topology and not a convenience.
    const service = buildGraphOn(owner);
    expect(await service.moderation.escalateOverdue()).toBe(1);
  });

  it('the Command Center reports through the role', async () => {
    const conv = await asActor(s.ownerId, () =>
      g.conversations.getOrCreateDirect(s.ownerId, s.parentId),
    );
    await asActor(s.parentId, () =>
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'waiting' }),
    );

    // The KPI functions are SECURITY DEFINER precisely so this works: the
    // counts are organization-wide and the connection is under RLS, so an
    // invoker-rights function would return a silently narrowed total.
    const kpis = await asActor(s.managerId, () => g.commandCenter.kpis(s.managerId));
    expect(kpis.unansweredMessages).toBe(1);
    expect(kpis.activeFamilies).toBeGreaterThan(0);
  });
});

// =========================================================================
describe('the policies constrain, with the service layer removed', () => {
  async function heldMessage() {
    const group = await asActor(s.ownerId, () =>
      g.conversations.ensureStudentGroup(s.learnerId, s.ownerId),
    );
    return asActor(s.teacherId, () =>
      g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY }),
    );
  }

  it('a TEACHER cannot read the detection patterns, even by raw SQL', async () => {
    // Publishing the patterns to the people being detected would tell them
    // exactly how to word their way past them. The service refuses; this
    // asserts the database refuses too.
    const rows = await readAs<{ id: string }>(
      s.teacherId, 'select id from chat.moderation_rule',
    );
    expect(rows).toEqual([]);
  });

  it('a PARENT cannot read them either', async () => {
    const rows = await readAs<{ id: string }>(
      s.parentId, 'select id from chat.moderation_rule',
    );
    expect(rows).toEqual([]);
  });

  it('a SUPERVISOR can, because they have to explain the queue', async () => {
    const rows = await readAs<{ id: string }>(
      s.ownerId, 'select id from chat.moderation_rule',
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a TEACHER cannot read the flags on their OWN held message', async () => {
    const msg = await heldMessage();
    const rows = await readAs<{ id: string }>(
      s.teacherId,
      `select id from chat.message_moderation_flag where message_id = '${msg.id}'::uuid`,
    );
    // The sender learns the OUTCOME through the queue's own `listMine`, not the
    // detection internals.
    expect(rows).toEqual([]);
  });

  it('a supervisor cannot read the flags on ANOTHER supervisor\'s family', async () => {
    const msg = await heldMessage();
    const mine = await readAs<{ id: string }>(
      s.ownerId,
      `select id from chat.message_moderation_flag where message_id = '${msg.id}'::uuid`,
    );
    expect(mine.length).toBeGreaterThan(0);

    // The other admin supervises a different family. Same query, no rows --
    // which is the check a permissive blanket policy would have destroyed.
    const theirs = await readAs<{ id: string }>(
      s.otherAdminId,
      `select id from chat.message_moderation_flag where message_id = '${msg.id}'::uuid`,
    );
    expect(theirs).toEqual([]);
  });

  it('a SUPERVISOR cannot write a moderation rule, even by raw SQL', async () => {
    // moderation_rules.manage is manager-and-above. The service refuses; so
    // does the policy, which is what makes hiding the button not the control.
    await expect(
      asActor(s.ownerId, () =>
        app.$executeRawUnsafe(
          `insert into chat.moderation_rule (name, category, severity, match_type, pattern)
           values ('Smuggled', 'custom', 'low', 'phrase', 'anything')`,
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('a TEACHER cannot disable a rule, even by raw SQL', async () => {
    await asActor(s.teacherId, async () => {
      const affected = await app.$executeRawUnsafe(
        `update chat.moderation_rule set is_enabled = false where is_builtin`,
      );
      // Not an error: an UPDATE whose USING clause matches nothing updates
      // nothing. Zero rows is the refusal.
      expect(affected).toBe(0);
    });
    expect(await owner.moderationRule.count({ where: { isEnabled: true } })).toBeGreaterThan(0);
  });

  it('NOBODY may rewrite the record of why a message was held', async () => {
    const msg = await heldMessage();
    // Append-only, enforced by a trigger -- so it holds for the owner too, not
    // only for the least-privileged role.
    await expect(
      owner.$executeRawUnsafe(
        `update chat.message_moderation_flag set severity = 'low'
          where message_id = '${msg.id}'::uuid`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('chat_app holds no DELETE on either table, so nothing can be tidied away', async () => {
    const privileges = await owner.$queryRawUnsafe<Array<{ table_name: string; privilege_type: string }>>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'chat_app'
          and table_schema = 'chat'
          and table_name in ('moderation_rule', 'message_moderation_flag')
          and privilege_type = 'DELETE'`,
    );
    expect(privileges).toEqual([]);
  });

  it('no PERMISSIVE blanket policy was added to either table', async () => {
    // The Phase 5 mistake, asserted structurally rather than remembered.
    const blanket = await owner.$queryRawUnsafe<Array<{ tablename: string; policyname: string }>>(
      `select tablename, policyname
         from pg_policies
        where schemaname = 'chat'
          and tablename in ('moderation_rule', 'message_moderation_flag')
          and permissive = 'PERMISSIVE'
          and coalesce(qual, '') in ('true', '(true)')`,
    );
    expect(blanket).toEqual([]);
  });
});
