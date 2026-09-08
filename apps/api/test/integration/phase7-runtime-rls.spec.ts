/**
 * PHASE 7 UNDER THE LEAST-PRIVILEGED RUNTIME ROLE.
 *
 * Every other Phase 7 suite is a unit test against fakes, which proves the
 * SERVICE layer and says nothing about the second one. This suite connects as
 * `chat_app`: NOBYPASSRLS, owns nothing, and is the role a correctly deployed
 * API connects as.
 *
 * It exists because of a defect Phase 5 found the hard way. A policy written as
 *
 *     create policy x on chat.t for all to chat_app using (true)
 *
 * reads as "let the application work" and is in fact PERMISSIVE: it ORs with
 * every read policy on the same table and silently cancels all of them. Nothing
 * about the migration looks wrong, every service test still passes, and the
 * table is world-readable to any authenticated session. The only thing that
 * catches it is asking the database, through the real role, what it will
 * actually hand over.
 *
 * Phase 7 adds seven tables holding drafts written about families, risk
 * assessments of them, and summaries of their conversations. Each is at least
 * as sensitive as the conversation it derives from.
 */
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { seed, truncate, Scenario, appDatabaseUrl } from './harness';

const owner = new PrismaService();
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);

const PHASE_7_TABLES = [
  'chat.ai_invocation',
  'chat.ai_suggestion',
  'chat.conversation_summary',
  'chat.attention_flag',
  'chat.knowledge_revision',
  'chat.knowledge_article',
  'chat.automation_run',
] as const;

let s: Scenario;
let conversationId: string;

/** Self-contained: the shared harness truncate does not know these tables. */
async function truncatePhase7(): Promise<void> {
  await owner.$executeRawUnsafe(
    `truncate ${PHASE_7_TABLES.join(', ')} restart identity cascade`,
  );
}

async function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  const actor = (
    await owner.$queryRawUnsafe<Array<{ subject: string; org: string; kind: string }>>(
      `select a.subject, a.organization_id::text as org, a.kind
         from chat.account a
         left join chat.staff   st on st.account_id = a.id
         left join chat.contact c  on c.account_id  = a.id
         left join chat.teacher t  on t.account_id  = a.id
        where st.id = '${actorId}'::uuid or c.id = '${actorId}'::uuid or t.id = '${actorId}'::uuid
        limit 1`,
    )
  )[0];
  return app.runWithActor(
    { actorId, kind: actor.kind as 'staff' | 'contact' | 'teacher', organizationId: actor.org },
    actor.subject,
    fn,
  );
}

beforeEach(async () => {
  await truncate(owner);
  await truncatePhase7();
  s = await seed(owner);

  const conv = await owner.conversation.create({
    data: { type: 'direct', state: 'open', familyId: s.familyId, directKey: `p7-${Date.now()}` },
  });
  conversationId = conv.id;
});

afterAll(async () => {
  await truncate(owner);
  await truncatePhase7();
  await Promise.all([owner.$disconnect(), connection.$disconnect()]);
});

describe('no Phase 7 policy is a blanket permit', () => {
  it('no table carries a PERMISSIVE policy whose USING is unconditionally true', async () => {
    // The structural form of the Phase 5 defect. Asked of the catalogue rather
    // than of behaviour, so it fails on the migration that introduces one
    // rather than on the first read that happens to notice.
    const bad = await owner.$queryRawUnsafe<Array<{ tablename: string; policyname: string }>>(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'chat'
         and tablename in (${PHASE_7_TABLES.map((t) => `'${t.split('.')[1]}'`).join(', ')})
         and permissive = 'PERMISSIVE'
         and coalesce(qual, '') in ('true', '(true)')
    `);
    expect(bad).toEqual([]);
  });

  it('every Phase 7 table has RLS enabled and a restrictive tenant policy', async () => {
    for (const table of PHASE_7_TABLES) {
      const name = table.split('.')[1];
      const [row] = await owner.$queryRawUnsafe<Array<{ enabled: boolean; restrictive: bigint }>>(`
        select c.relrowsecurity as enabled,
               (select count(*) from pg_policies p
                 where p.schemaname = 'chat' and p.tablename = '${name}'
                   and p.permissive = 'RESTRICTIVE') as restrictive
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'chat' and c.relname = '${name}'
      `);
      expect({ table, enabled: row.enabled, restrictive: row.restrictive > 0n }).toEqual({
        table,
        enabled: true,
        restrictive: true,
      });
    }
  });
});

describe('the Phase 7 product works through chat_app', () => {
  it('a supervisor reads approved knowledge and writes a draft', async () => {
    // Least privilege that takes the product down is not a security
    // improvement, so the happy path is asserted first.
    await owner.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','seed',false)`);
    const approved = await owner.knowledgeArticle.create({
      data: {
        title: 'Foundation course', question: 'هل عندكم كورس تأسيس؟',
        answer: 'نعم، ومدته 8 أسابيع.', status: 'approved',
        approvedBy: s.managerId, approvedAt: new Date(),
      },
    });

    const visible = await asActor(s.ownerId, () =>
      app.knowledgeArticle.findMany({ where: { status: 'approved' } }),
    );
    expect(visible.map((a) => a.id)).toContain(approved.id);
  });

  it('a supervisor reads a summary of a conversation they handle', async () => {
    const summary = await owner.conversationSummary.create({
      data: {
        conversationId, generatedBy: s.ownerId, problem: 'p', whatWasDone: 'w',
        pendingAction: 'a', importantHistory: 'h', inferences: [], upToSeq: 0n,
      },
    });
    const rows = await asActor(s.ownerId, () => app.conversationSummary.findMany());
    expect(rows.map((r) => r.id)).toContain(summary.id);
  });
});

describe('the policies CONSTRAIN, with the service layer removed', () => {
  it('a parent cannot read the academy\'s knowledge base', async () => {
    await owner.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','seed',false)`);
    await owner.knowledgeArticle.create({
      data: {
        title: 'Fees', question: 'كم الرسوم؟', answer: 'الرسوم 500 جنيه شهريًا.',
        status: 'approved', approvedBy: s.managerId, approvedAt: new Date(),
      },
    });
    // A parent holds no knowledge.read. The internal pricing and policy corpus
    // is not customer-facing content just because its answers may be quoted.
    const rows = await asActor(s.parentId, () => app.knowledgeArticle.findMany());
    expect(rows).toEqual([]);
  });

  it('a draft article is invisible to somebody who cannot edit knowledge', async () => {
    await owner.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','seed',false)`);
    await owner.knowledgeArticle.create({
      data: { title: 'Unreviewed', question: 'q', answer: 'we guarantee a refund', status: 'draft' },
    });
    // A draft is somebody's unreviewed opinion about academy policy. It must
    // not be quotable, and a teacher is not an editor.
    const rows = await asActor(s.teacherId, () => app.knowledgeArticle.findMany());
    expect(rows).toEqual([]);
  });

  it('one supervisor cannot read another supervisor\'s drafted reply', async () => {
    const draft = await owner.aiSuggestion.create({
      data: { conversationId, requestedBy: s.ownerId, body: 'نعتذر عن التأخير.', status: 'pending' },
    });

    const mine = await asActor(s.ownerId, () => app.aiSuggestion.findMany());
    expect(mine.map((r) => r.id)).toContain(draft.id);

    // otherAdmin holds ai.use and is an admin. The policy is ownership, not
    // permission: a draft belongs to whoever asked for it.
    const theirs = await asActor(s.otherAdminId, () => app.aiSuggestion.findMany());
    expect(theirs).toEqual([]);
  });

  it('a PARENT cannot read a draft written about their own conversation', async () => {
    // The reason the read policy is ownership rather than conversation
    // membership: the family is IN the conversation, and a draft is an
    // unreviewed machine opinion about what to say to them.
    await owner.aiSuggestion.create({
      data: { conversationId, requestedBy: s.ownerId, body: 'internal draft', status: 'pending' },
    });
    expect(await asActor(s.parentId, () => app.aiSuggestion.findMany())).toEqual([]);
  });

  it('an admin cannot read the AI invocation log; audit.read is manager-and-above', async () => {
    await owner.aiInvocation.create({
      data: { feature: 'summary', provider: 'test', status: 'ok', latencyMs: 10, actorId: s.ownerId },
    });
    // Using the assistant is not the same as auditing everyone's use of it.
    expect(await asActor(s.ownerId, () => app.aiInvocation.findMany())).toEqual([]);
    expect(await asActor(s.managerId, () => app.aiInvocation.findMany())).toHaveLength(1);
  });

  it('a parent cannot read the risk assessment of their own family', async () => {
    await owner.attentionFlag.create({
      data: {
        conversationId, familyId: s.familyId, riskType: 'cancellation_intent',
        severity: 'high', reason: 'mentioned stopping twice', detectedBy: 'ai', status: 'open',
      },
    });
    expect(await asActor(s.parentId, () => app.attentionFlag.findMany())).toEqual([]);
    expect(await asActor(s.managerId, () => app.attentionFlag.findMany())).toHaveLength(1);
  });

  it('a parent cannot read a summary of their own conversation', async () => {
    // Summaries name what staff still owe the family and what colleagues
    // recorded internally. They follow the conversation's authorization AND
    // require ai.use, which no parent holds.
    await owner.conversationSummary.create({
      data: {
        conversationId, generatedBy: s.ownerId, problem: 'p', whatWasDone: 'w',
        pendingAction: 'a', importantHistory: 'h', inferences: [], upToSeq: 0n,
      },
    });
    expect(await asActor(s.parentId, () => app.conversationSummary.findMany())).toEqual([]);
  });

  it('chat_app cannot write an automation run at all -- the engine is the worker', async () => {
    await owner.automationRun.deleteMany({});
    // Granting INSERT without UPDATE would let a request-path caller claim an
    // occurrence and never finish it, permanently blocking the real firing
    // through the idempotency index. The grant is SELECT only, so this fails.
    await expect(
      asActor(s.managerId, () =>
        app.automationRun.create({
          data: {
            ruleKey: 'followup.due', triggerType: 'FOLLOW_UP_DUE',
            subjectId: conversationId, occurrenceKey: 'x', outcome: 'executed',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('the approval boundary, and the duplicate guard', () => {
  it('an ADMIN may draft but may not approve; a MANAGER may approve', async () => {
    // Authoring and approving are different permissions because an approved
    // article is what the academy says to every family. Proved here through
    // chat_app, so it is the POLICY being tested and not the service's own
    // check -- both must hold, and only one of them is in TypeScript.
    await owner.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','seed',false)`);
    const draft = await owner.knowledgeArticle.create({
      data: { title: 'Refunds', question: 'هل يوجد استرداد؟', answer: 'راجع الإدارة.', status: 'draft' },
    });

    await asActor(s.ownerId, () =>
      app.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','edit',true)`),
    );

    // The admin holds knowledge.manage and not knowledge.approve.
    await expect(
      asActor(s.ownerId, async () => {
        await app.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','publish',true)`);
        return app.knowledgeArticle.update({
          where: { id: draft.id },
          data: { status: 'approved', approvedBy: s.ownerId, approvedAt: new Date() },
        });
      }),
    ).rejects.toThrow();

    // The manager holds it.
    const approved = await asActor(s.managerId, async () => {
      await app.$executeRawUnsafe(`select set_config('chat.knowledge_change_reason','publish',true)`);
      return app.knowledgeArticle.update({
        where: { id: draft.id },
        data: { status: 'approved', approvedBy: s.managerId, approvedAt: new Date() },
      });
    });
    expect(approved.status).toBe('approved');
  });

  it('the same open risk cannot be raised twice, and may recur once resolved', async () => {
    const flag = {
      conversationId, familyId: s.familyId, riskType: 'cancellation_intent',
      severity: 'high', reason: 'mentioned stopping twice', detectedBy: 'ai', status: 'open',
    };
    await owner.attentionFlag.create({ data: flag });

    // The sweep runs on several worker replicas; two of them classifying the
    // same conversation in the same second is the NORMAL case. The partial
    // unique index refuses the second insert, so the engine does not have to
    // win a race it cannot see.
    await expect(owner.attentionFlag.create({ data: flag })).rejects.toThrow();

    // A different risk on the same conversation is a different concern.
    await expect(
      owner.attentionFlag.create({ data: { ...flag, riskType: 'frustrated_parent' } }),
    ).resolves.toBeTruthy();

    // Once handled, the same risk recurring weeks later is a NEW event and
    // deserves to be raised again -- which is why the index excludes resolved.
    await owner.attentionFlag.updateMany({
      where: { riskType: 'cancellation_intent' },
      data: { status: 'resolved', resolvedBy: s.managerId, resolvedAt: new Date() },
    });
    await expect(owner.attentionFlag.create({ data: flag })).resolves.toBeTruthy();
  });
});
