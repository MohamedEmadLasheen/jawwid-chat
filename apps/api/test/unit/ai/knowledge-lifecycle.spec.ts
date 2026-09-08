import { KnowledgeService } from '../../../src/ai/knowledge/knowledge.service';
import { CommErrorCode } from '../../../src/platform/errors';

/**
 * The knowledge lifecycle guards, at the SERVICE layer.
 *
 * The RLS policies enforce the same boundaries and are proved separately in
 * phase7-runtime-rls.spec.ts. Both layers are tested because they fail
 * differently: the policy is the boundary, and this is the layer that turns a
 * refusal into an error a person can act on rather than a silent empty result.
 */
const ARTICLE = {
  id: 'a-1', title: 'Fees', question: 'كم الرسوم؟', answer: 'الرسوم 500 جنيه.',
  status: 'draft', version: 1,
};

function build(permissions: string[], article: unknown = ARTICLE) {
  const tx = {
    $executeRaw: jest.fn(),
    knowledgeArticle: { create: jest.fn(async ({ data }: any) => data), update: jest.fn(async ({ data }: any) => data) },
  };
  const prisma = {
    knowledgeArticle: { findUnique: jest.fn().mockResolvedValue(article) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const identity = {
    resolveActor: jest.fn().mockResolvedValue({
      actorId: 'staff-1', kind: 'staff', isActive: true, staffRole: 'admin',
      permissions: new Set(permissions),
    }),
  };
  const authz = { hasPermission: (a: any, p: string) => a.permissions.has(p) };
  return {
    service: new KnowledgeService(prisma as never, identity as never, authz as never),
    prisma, tx,
  };
}

const EDITOR = ['knowledge.read', 'knowledge.manage'];
const PUBLISHER = [...EDITOR, 'knowledge.approve'];

describe('knowledge lifecycle', () => {
  it('an editor cannot approve -- publishing is a separate permission', async () => {
    // An approved article is what the academy says to EVERY family, so
    // publishing one is an organization-wide commitment in the way renaming a
    // label is. Holding knowledge.manage is not holding knowledge.approve.
    const { service } = build(EDITOR);
    await expect(service.approve('staff-1', 'a-1', 'looks right')).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('a publisher can, and the approval is attributed', async () => {
    const { service, tx } = build(PUBLISHER);
    await service.approve('staff-1', 'a-1', 'reviewed with operations');
    expect(tx.knowledgeArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'approved', approvedBy: 'staff-1', approvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('creates as a DRAFT even when the author could also approve', async () => {
    // Authoring and approving cannot collapse into one act just because one
    // person holds both keys.
    const { service, tx } = build(PUBLISHER);
    await service.create('staff-1', { title: 't', question: 'q', answer: 'a' }, 'new policy');
    expect(tx.knowledgeArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) }),
    );
  });

  it('refuses to edit an APPROVED article in place', async () => {
    // It is returned to draft or retired first. Editing live academy policy
    // without re-review is exactly what the approval permission prevents.
    const { service } = build(EDITOR, { ...ARTICLE, status: 'approved' });
    await expect(
      service.update('staff-1', 'a-1', { answer: 'الرسوم 200 جنيه.' }, 'price change'),
    ).rejects.toMatchObject({ code: CommErrorCode.KNOWLEDGE_APPROVED_IS_FROZEN });
  });

  it('requires a reason on every change', async () => {
    const { service } = build(PUBLISHER);
    for (const call of [
      () => service.create('staff-1', { title: 't', question: 'q', answer: 'a' }, '  '),
      () => service.update('staff-1', 'a-1', { answer: 'x' }, ''),
      () => service.approve('staff-1', 'a-1', ''),
      () => service.retire('staff-1', 'a-1', '   '),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: CommErrorCode.KNOWLEDGE_REASON_REQUIRED,
      });
    }
  });

  it('publishes the reason to the database as a transaction-local setting', async () => {
    // chat.knowledge_write_revision reads it. A write without one fails, which
    // is the pressure that keeps the revision log honest.
    const { service, tx } = build(PUBLISHER);
    await service.approve('staff-1', 'a-1', 'reviewed with operations');
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('retires rather than deletes, so earlier citations still resolve', async () => {
    const { service, tx } = build(PUBLISHER, { ...ARTICLE, status: 'approved' });
    await service.retire('staff-1', 'a-1', 'no longer accurate');
    expect(tx.knowledgeArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'inactive' }) }),
    );
  });

  it('never retrieves a draft or a retired article for grounding', async () => {
    const { service, prisma } = build(EDITOR);
    (prisma as never as { $queryRaw: unknown }).$queryRaw = jest.fn().mockResolvedValue([]);
    await service.searchApproved('كم الرسوم', 'ar', 6);
    const sql = (prisma as never as { $queryRaw: jest.Mock }).$queryRaw.mock.calls[0][0];
    expect(sql.join('')).toContain("status = 'approved'");
  });
});
