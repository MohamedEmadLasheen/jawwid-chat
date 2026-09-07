import { Prisma } from '@prisma/client';
import { AutomationEngine } from '../../../src/ai/automation/automation.engine';
import { ConditionEvaluator } from '../../../src/ai/automation/condition.evaluator';
import { Outcome, TriggerType } from '../../../src/ai/automation/automation.types';
import { CommError, CommErrorCode } from '../../../src/platform/errors';

const EVENT = {
  triggerType: TriggerType.MESSAGE_UNANSWERED,
  subjectId: 'conv-1',
  occurrenceKey: '2026-09-01T10:00:00.000Z',
  conversationId: 'conv-1',
  familyId: 'fam-1',
};

function duplicateKeyError() {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '6',
  });
}

function build(opts: {
  rules?: unknown[];
  claimFails?: boolean;
  conditionsPass?: boolean;
  actionThrows?: Error;
} = {}) {
  const runs: Record<string, unknown>[] = [];
  const prisma = {
    automationRule: { findMany: jest.fn().mockResolvedValue(opts.rules ?? []) },
    automationRun: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.claimFails) throw duplicateKeyError();
        runs.push(data);
        return { id: 'run-1', ...data };
      }),
      update: jest.fn(async ({ data }: any) => { runs.push(data); return data; }),
    },
    contact: { findMany: jest.fn().mockResolvedValue([{ id: 'contact-1' }]) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ familyId: 'fam-1', state: 'open' }),
      update: jest.fn().mockResolvedValue({}),
    },
    familyAssignment: { findMany: jest.fn().mockResolvedValue([{ staffId: 'staff-1' }]) },
  };
  const conditions = {
    evaluate: jest.fn().mockResolvedValue(
      opts.conditionsPass === false
        ? { passed: false, detail: 'family_active was false, expected eq true' }
        : { passed: true, detail: 'all conditions met' },
    ),
  };
  const messages = {
    send: jest.fn(async () => {
      if (opts.actionThrows) throw opts.actionThrows;
      return { id: 'msg-1' };
    }),
  };
  const notifications = {
    schedule: jest.fn(async () => {
      if (opts.actionThrows) throw opts.actionThrows;
    }),
  };
  const conversations = {};
  const attention = { assess: jest.fn().mockResolvedValue([{ id: 'flag-1' }]) };

  const engine = new AutomationEngine(
    prisma as never, conditions as never, messages as never,
    notifications as never, conversations as never, attention as never,
  );
  return { engine, prisma, conditions, messages, notifications, attention, runs };
}

const RULE = {
  key: 'conversation.unanswered',
  triggerType: TriggerType.MESSAGE_UNANSWERED,
  conditions: [{ field: 'family_active', op: 'eq', value: true }],
  actionType: 'CREATE_ATTENTION_FLAG',
  actionConfig: {},
  enabled: true,
};

describe('automation engine', () => {
  it('claims the occurrence BEFORE acting', async () => {
    const { engine, prisma } = build({ rules: [RULE] });

    await engine.fire(EVENT);

    // The ordering is the guarantee. Acting first and recording second would
    // mean two workers both act and then discover they collided.
    const claimOrder = prisma.automationRun.create.mock.invocationCallOrder[0];
    const actOrder = prisma.conversation.findUnique.mock.invocationCallOrder[0] ?? Infinity;
    expect(claimOrder).toBeLessThan(actOrder);
    expect(prisma.automationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleKey: 'conversation.unanswered',
          subjectId: 'conv-1',
          occurrenceKey: '2026-09-01T10:00:00.000Z',
        }),
      }),
    );
  });

  it('does nothing at all when the occurrence is already claimed (§25)', async () => {
    const { engine, attention, messages, notifications } = build({
      rules: [RULE],
      claimFails: true,
    });

    const results = await engine.fire(EVENT);

    // A second run of the same sweep must not send the same reminder twice.
    expect(results).toEqual([]);
    expect(attention.assess).not.toHaveBeenCalled();
    expect(messages.send).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it('skips, and records WHY, when a condition is not met', async () => {
    const { engine, attention, prisma } = build({ rules: [RULE], conditionsPass: false });

    const [result] = await engine.fire(EVENT);

    expect(result.outcome).toBe(Outcome.SKIPPED_CONDITION);
    expect(result.detail).toContain('family_active was false');
    expect(attention.assess).not.toHaveBeenCalled();
    expect(prisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'skipped_condition' }) }),
    );
  });

  it('records a pipeline REFUSAL as blocked, with the pipeline\'s own code', async () => {
    // The automation asked for something the rules do not allow, and the rules
    // won. That is a normal recordable outcome, not a bug -- and emphatically
    // not something to route around.
    const denied = new CommError(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED, 'no live admin');
    const { engine, prisma } = build({
      rules: [{ ...RULE, actionType: 'SEND_MESSAGE', actionConfig: { body: 'hi' } }],
      actionThrows: denied,
    });

    const [result] = await engine.fire(EVENT);

    expect(result.outcome).toBe(Outcome.BLOCKED);
    expect(result.detail).toContain('COMM.BR1_ADMIN_PRESENCE_REQUIRED');
    expect(prisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'blocked' }) }),
    );
  });

  it('distinguishes a crash (failed) from a refusal (blocked)', async () => {
    const { engine } = build({
      rules: [{ ...RULE, actionType: 'SEND_MESSAGE', actionConfig: { body: 'hi' } }],
      actionThrows: new Error('database is down'),
    });
    expect((await engine.fire(EVENT))[0].outcome).toBe(Outcome.FAILED);
  });

  it('sends an automated message as the SYSTEM actor, never as a person', async () => {
    const { engine, messages } = build({
      rules: [{ ...RULE, actionType: 'SEND_MESSAGE', actionConfig: { body: 'تذكير' } }],
    });

    await engine.fire(EVENT);

    expect(messages.send).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      senderId: '00000000-0000-0000-0000-000000000000',
      body: 'تذكير',
    });
  });

  it('notifies only contacts the family allows to be messaged', async () => {
    const { engine, prisma } = build({
      rules: [{ ...RULE, actionType: 'CREATE_NOTIFICATION',
        actionConfig: { recipient: 'family_contacts', template_key: 'payment_reminder' } }],
    });

    await engine.fire(EVENT);

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ canMessage: true, isActive: true }),
      }),
    );
  });

  it('gives each notification a dedupe key carrying the occurrence', async () => {
    const { engine, notifications } = build({
      rules: [{ ...RULE, actionType: 'CREATE_NOTIFICATION',
        actionConfig: { recipient: 'family_contacts' } }],
    });

    await engine.fire(EVENT);

    // Idempotent twice over: here by the run claim, and again at the
    // notification layer's own dedupe.
    expect(notifications.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'conversation.unanswered:conv-1:2026-09-01T10:00:00.000Z:contact-1',
      }),
    );
  });

  it('ignores disabled rules', async () => {
    const { engine, prisma } = build({ rules: [] });
    expect(await engine.fire(EVENT)).toEqual([]);
    expect(prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { triggerType: EVENT.triggerType, enabled: true } }),
    );
  });
});

describe('condition evaluation (§23 -- authoritative data, never a model)', () => {
  function evaluator(overrides: Record<string, unknown> = {}) {
    const prisma = {
      family: { findUnique: jest.fn().mockResolvedValue({ state: 'active' }) },
      conversation: { findUnique: jest.fn().mockResolvedValue({ state: 'open' }) },
      contact: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      notificationPreference: { count: jest.fn().mockResolvedValue(0) },
      ...overrides,
    };
    return { evaluator: new ConditionEvaluator(prisma as never), prisma };
  }

  it('passes when every condition matches', async () => {
    const { evaluator: e } = evaluator();
    const r = await e.evaluate(
      [{ field: 'family_active', op: 'eq', value: true },
       { field: 'conversation_open', op: 'eq', value: true }],
      EVENT,
    );
    expect(r.passed).toBe(true);
  });

  it('treats at_risk and renewal_due as ACTIVE -- a family at risk is still a customer', async () => {
    for (const state of ['onboarding', 'active', 'at_risk', 'renewal_due']) {
      const { evaluator: e } = evaluator({ family: { findUnique: jest.fn().mockResolvedValue({ state }) } });
      expect((await e.evaluate([{ field: 'family_active', op: 'eq', value: true }], EVENT)).passed).toBe(true);
    }
    for (const state of ['paused', 'churned']) {
      const { evaluator: e } = evaluator({ family: { findUnique: jest.fn().mockResolvedValue({ state }) } });
      expect((await e.evaluate([{ field: 'family_active', op: 'eq', value: true }], EVENT)).passed).toBe(false);
    }
  });

  it('a resolved conversation is not open', async () => {
    const { evaluator: e } = evaluator({
      conversation: { findUnique: jest.fn().mockResolvedValue({ state: 'resolved' }) },
    });
    expect((await e.evaluate([{ field: 'conversation_open', op: 'eq', value: true }], EVENT)).passed).toBe(false);
  });

  it('FAILS CLOSED on an unknown field', async () => {
    // The failure this prevents: a typo in `family_active` silently removes the
    // only guard on a rule that messages families, and the rule keeps working,
    // more broadly than anybody intended.
    const { evaluator: e } = evaluator();
    const r = await e.evaluate([{ field: 'famly_active', op: 'eq', value: true }], EVENT);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('unknown condition field');
  });

  it('fails closed on subscription_active, whose truth lives in Jawwid Core', async () => {
    const { evaluator: e } = evaluator();
    const r = await e.evaluate([{ field: 'subscription_active', op: 'eq', value: true }], EVENT);
    // Far better than a frozen mirror table quietly answering "active" from
    // data nobody is updating.
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('unknown condition field');
  });

  it('treats an absent notification preference as enabled', async () => {
    const { evaluator: e } = evaluator();
    expect((await e.evaluate([{ field: 'notifications_enabled', op: 'eq', value: true }], EVENT)).passed).toBe(true);
  });

  it('is false when every messageable contact has opted out', async () => {
    const { evaluator: e } = evaluator({
      notificationPreference: { count: jest.fn().mockResolvedValue(1) },
    });
    expect((await e.evaluate([{ field: 'notifications_enabled', op: 'eq', value: true }], EVENT)).passed).toBe(false);
  });
});
