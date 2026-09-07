import { RiskDetectionService, RiskType } from '../../../src/ai/risk/risk-detection.service';

const CONFIG: Record<string, unknown> = {
  'attention.unanswered_hours': 24,
  'attention.unanswered_severe_hours': 72,
  'attention.classify_min_customer_messages': 2,
  'ai.risk_context_messages': 40,
  'ai.min_confidence': 0.6,
};

function build(opts: { conv?: unknown; output?: unknown; failure?: boolean; aiEnabled?: boolean; messages?: unknown[] } = {}) {
  const prisma = {
    conversation: { findUnique: jest.fn().mockResolvedValue(opts.conv ?? null) },
    message: {
      count: jest.fn().mockResolvedValue((opts.messages ?? []).length),
      findMany: jest.fn().mockResolvedValue([...(opts.messages ?? [])].reverse()),
    },
  };
  const ai = {
    isEnabled: jest.fn().mockResolvedValue(opts.aiEnabled ?? true),
    run: jest.fn(async (_ctx: unknown, _req: unknown) =>
      opts.failure
        ? { ok: false, failure: 'timeout', detail: 'x' }
        : { ok: true, value: opts.output, model: 'm', usage: { inputTokens: 1, outputTokens: 1 } },
    ),
  };
  const config = { get: jest.fn(async (k: string) => CONFIG[k]) };
  return { service: new RiskDetectionService(prisma as never, ai as never, config as never), ai, prisma };
}

const parent = (body: string) => ({
  seq: 1n, authorType: 'contact', visibility: 'customer', type: 'text', body,
  createdAt: new Date('2026-09-01T10:00:00Z'),
});

const HOURS = (n: number) => new Date(Date.parse('2026-09-02T00:00:00Z') - n * 3_600_000);
const NOW = new Date('2026-09-02T00:00:00Z');

describe('deterministic unanswered detection (§20 -- no model)', () => {
  it('raises nothing when staff replied after the family', async () => {
    const { service, ai } = build({
      conv: { lastCustomerMessageAt: HOURS(50), lastStaffMessageAt: HOURS(2) },
    });
    expect(await service.detectUnanswered('c', NOW)).toBeNull();
    // Not even consulted: this is arithmetic.
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('raises nothing inside the window', async () => {
    const { service } = build({ conv: { lastCustomerMessageAt: HOURS(5), lastStaffMessageAt: null } });
    expect(await service.detectUnanswered('c', NOW)).toBeNull();
  });

  it('raises medium past the threshold, with the real number of hours', async () => {
    const { service } = build({ conv: { lastCustomerMessageAt: HOURS(41), lastStaffMessageAt: null } });
    const risk = (await service.detectUnanswered('c', NOW))!;
    expect(risk.type).toBe(RiskType.UNANSWERED_MESSAGES);
    expect(risk.severity).toBe('medium');
    expect(risk.reason).toContain('41 hours');
    expect(risk.detectedBy).toBe('sweep');
    // Null, not 1.0: putting a model's units on arithmetic invites somebody to
    // compare the two numbers as though they meant the same thing.
    expect(risk.confidence).toBeNull();
  });

  it('escalates to high past the severe threshold', async () => {
    const { service } = build({ conv: { lastCustomerMessageAt: HOURS(100), lastStaffMessageAt: null } });
    expect((await service.detectUnanswered('c', NOW))!.severity).toBe('high');
  });

  it('keeps working when the assistant is switched off', async () => {
    const { service } = build({
      conv: { lastCustomerMessageAt: HOURS(41), lastStaffMessageAt: null },
      aiEnabled: false,
    });
    // The half of risk detection that must never depend on AI being available.
    expect(await service.detectUnanswered('c', NOW)).not.toBeNull();
  });
});

describe('AI classification (content judgement only)', () => {
  const TWO = [parent('المدرس لم يحضر مرتين'), parent('سأوقف الدروس')];

  it('reports cancellation intent with evidence a manager can check', async () => {
    const { service } = build({
      messages: TWO,
      output: { risks: [{ type: 'cancellation_intent', severity: 'high', confidence: 0.82, reason: 'Mentioned stopping the lessons twice.' }] },
    });

    const risks = await service.classify('c');

    expect(risks).toEqual([
      expect.objectContaining({
        type: RiskType.CANCELLATION_INTENT,
        severity: 'high',
        confidence: 0.82,
        reason: 'Mentioned stopping the lessons twice.',
        detectedBy: 'ai',
      }),
    ]);
  });

  it('does not classify a single message -- one message is not a pattern', async () => {
    const { service, ai } = build({ messages: [parent('كم الرسوم؟')], output: { risks: [] } });
    expect(await service.classify('c')).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('drops a low-confidence guess', async () => {
    const { service } = build({
      messages: TWO,
      output: { risks: [{ type: 'frustrated_parent', severity: 'low', confidence: 0.3, reason: 'maybe' }] },
    });
    expect(await service.classify('c')).toEqual([]);
  });

  it('collapses a risk the model listed twice into one', async () => {
    const { service } = build({
      messages: TWO,
      output: { risks: [
        { type: 'frustrated_parent', severity: 'high', confidence: 0.9, reason: 'a' },
        { type: 'frustrated_parent', severity: 'low', confidence: 0.8, reason: 'b' },
      ] },
    });
    expect(await service.classify('c')).toHaveLength(1);
  });

  it('returns nothing rather than throwing when the model fails', async () => {
    const { service } = build({ messages: TWO, failure: true });
    expect(await service.classify('c')).toEqual([]);
  });

  it('caps the reason, which is rendered straight into a manager queue', async () => {
    const { service } = build({
      messages: TWO,
      output: { risks: [{ type: 'frustrated_parent', severity: 'low', confidence: 0.9, reason: 'x'.repeat(5000) }] },
    });
    expect((await service.classify('c'))[0].reason.length).toBe(500);
  });

  it('never sees internal staff notes', async () => {
    const { service, prisma } = build({ messages: TWO, output: { risks: [] } });
    await service.classify('c');
    // A risk assessment is about what the FAMILY said; feeding it staff notes
    // invites classifying a colleague's annoyance as the parent's.
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ visibility: 'customer' }) }),
    );
  });

  it('puts the conversation in an untrusted envelope', async () => {
    const { service, ai } = build({ messages: TWO, output: { risks: [] } });
    await service.classify('c');
    const req = ai.run.mock.calls[0][1] as { untrusted: unknown; system: string };
    expect(req.untrusted).toEqual([{ label: 'conversation', text: expect.any(String) }]);
    expect(req.system).not.toContain('سأوقف الدروس');
  });
});
