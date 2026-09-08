import { AutomationAdminService } from '../../../src/ai/automation/automation-admin.service';
import { CommErrorCode } from '../../../src/platform/errors';

/**
 * The automation read surface.
 *
 * It exists because §26 requires executions to be auditable, and a record
 * nobody can reach is not an audit trail. Until it existed, `automation.manage`
 * was a permission that granted access to nothing.
 */
const RULE = { key: 'followup.due', enabled: true, triggerType: 'FOLLOW_UP_DUE' };

function build(permissions: string[], rule: unknown = RULE) {
  const tx = { automationRule: { update: jest.fn(async ({ data }: any) => ({ ...RULE, ...data })) } };
  const prisma = {
    automationRule: {
      findMany: jest.fn().mockResolvedValue([RULE]),
      findUnique: jest.fn().mockResolvedValue(rule),
    },
    automationRun: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit = { audit: jest.fn(), event: jest.fn() };
  const identity = {
    resolveActor: jest.fn().mockResolvedValue({
      actorId: 'staff-1', kind: 'staff', isActive: true, staffRole: 'manager',
      permissions: new Set(permissions),
    }),
  };
  return {
    service: new AutomationAdminService(prisma as never, identity as never, audit as never),
    prisma, audit, tx,
  };
}

describe('automation administration', () => {
  it('refuses an actor without automation.manage', async () => {
    // An admin holds ai.use and attention.* and NOT this: one rule reaches
    // every family in the organization at once.
    const { service } = build(['ai.use', 'attention.read']);
    for (const call of [
      () => service.listRules('staff-1'),
      () => service.listRuns('staff-1'),
      () => service.setEnabled('staff-1', 'followup.due', false, 'stop it'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
    }
  });

  it('answers the §26 questions: what ran, and what was blocked', async () => {
    const { service, prisma } = build(['automation.manage']);
    await service.listRuns('staff-1', { outcome: 'blocked' });
    expect(prisma.automationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outcome: 'blocked' }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('disables a rule, and audits who and why', async () => {
    const { service, tx, audit } = build(['automation.manage']);

    await service.setEnabled('staff-1', 'followup.due', false, 'reminders are duplicating');

    expect(tx.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'followup.due' }, data: { enabled: false } }),
    );
    // Silently disabling the rule that reminds families about their classes,
    // with nobody able to say who or why, is the incident this prevents.
    expect(audit.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'automation_rule.disabled',
        actorId: 'staff-1',
        reason: 'reminders are duplicating',
      }),
    );
  });

  it('requires a reason', async () => {
    const { service } = build(['automation.manage']);
    await expect(service.setEnabled('staff-1', 'followup.due', false, '  ')).rejects.toMatchObject({
      code: CommErrorCode.KNOWLEDGE_REASON_REQUIRED,
    });
  });

  it('404s an unknown rule', async () => {
    const { service } = build(['automation.manage'], null);
    await expect(service.setEnabled('staff-1', 'nope', false, 'x')).rejects.toMatchObject({
      code: CommErrorCode.AUTOMATION_RULE_NOT_FOUND,
    });
  });
});
