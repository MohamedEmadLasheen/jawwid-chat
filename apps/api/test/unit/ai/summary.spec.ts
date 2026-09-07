import { SummaryService } from '../../../src/ai/summaries/summary.service';
import { buildTranscript } from '../../../src/ai/context/transcript';

const FULL = {
  problem: 'المدرس لم يحضر.',
  whatWasDone: 'اعتذرنا ووعدنا بالرد.',
  pendingAction: 'إبلاغ الأسرة بموعد التعويض.',
  importantHistory: 'حدث نفس الشيء الشهر الماضي.',
  inferences: ['الأسرة تبدو غير راضية؛ لم تقل ذلك صراحة.'],
};

function build(opts: { output?: unknown; failure?: boolean; cached?: unknown; lastSeq?: bigint } = {}) {
  const prisma = {
    conversationSummary: {
      findFirst: jest.fn().mockResolvedValue(opts.cached ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'sum-1', ...data })),
    },
    message: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        { seq: 1n, authorType: 'contact', visibility: 'customer', type: 'text', body: 'المدرس لم يحضر', createdAt: new Date('2026-09-01T10:00:00Z') },
        { seq: 2n, authorType: 'staff', visibility: 'internal', type: 'text', body: 'راجعت الجدول', createdAt: new Date('2026-09-01T10:05:00Z') },
      ]),
    },
  };
  const conversations = {
    requireForActor: jest.fn().mockResolvedValue({
      id: 'conv-1', familyId: 'fam-1', organizationId: 'org-1', lastSeq: opts.lastSeq ?? 2n,
    }),
  };
  const ai = {
    isEnabled: jest.fn().mockResolvedValue(true),
    run: jest.fn(async () =>
      opts.failure
        ? { ok: false, failure: 'timeout', detail: 'x' }
        : { ok: true, value: opts.output, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } },
    ),
  };
  const config = { get: jest.fn(async () => 120) };
  const identity = {
    resolveActor: jest.fn().mockResolvedValue({
      actorId: 'staff-1', kind: 'staff', isActive: true, staffRole: 'admin',
      permissions: new Set(['ai.use']),
    }),
  };
  const service = new SummaryService(
    prisma as never, identity as never, conversations as never, ai as never, config as never,
  );
  return { service, prisma, conversations, ai, identity };
}

describe('conversation summary', () => {
  it('returns the four required sections and keeps inferences separate', async () => {
    const { service } = build({ output: FULL });

    const { summary } = await service.summarize('staff-1', 'conv-1');

    expect(summary).toMatchObject({
      problem: FULL.problem,
      whatWasDone: FULL.whatWasDone,
      pendingAction: FULL.pendingAction,
      importantHistory: FULL.importantHistory,
    });
    // §13: what the model concluded is NOT mixed into the record.
    expect(summary!.inferences).toEqual(FULL.inferences);
    expect(summary!.problem).not.toContain('غير راضية');
  });

  it('rejects a summary missing any one section', async () => {
    for (const missing of ['problem', 'whatWasDone', 'pendingAction', 'importantHistory']) {
      const { service, prisma } = build({ output: { ...FULL, [missing]: '   ' } });
      const { summary } = await service.summarize('staff-1', 'conv-1');
      // Better no summary than one whose "pending action" is silently absent.
      expect(summary).toBeNull();
      expect(prisma.conversationSummary.create).not.toHaveBeenCalled();
    }
  });

  it('reuses a cached summary while the conversation has not advanced', async () => {
    const cached = { id: 'old', upToSeq: 2n, problem: 'p' };
    const { service, ai } = build({ cached, lastSeq: 2n });

    const result = await service.summarize('staff-1', 'conv-1');

    expect(result.cached).toBe(true);
    expect(result.summary).toBe(cached);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('looks up the cache at the CURRENT seq, so a moved-on thread misses it', async () => {
    const { service, prisma } = build({ output: FULL, lastSeq: 9n });
    await service.summarize('staff-1', 'conv-1');
    expect(prisma.conversationSummary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'conv-1', upToSeq: 9n } }),
    );
    expect(prisma.conversationSummary.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ upToSeq: 9n }) }),
    );
  });

  it('refresh bypasses the cache', async () => {
    const { service, prisma, ai } = build({ output: FULL, cached: { id: 'old' } });
    await service.summarize('staff-1', 'conv-1', { refresh: true });
    expect(prisma.conversationSummary.findFirst).not.toHaveBeenCalled();
    expect(ai.run).toHaveBeenCalled();
  });

  it('refuses a conversation the caller cannot open, before reading it', async () => {
    const { service, conversations, prisma } = build({ output: FULL });
    conversations.requireForActor.mockRejectedValue(new Error('out of scope'));

    await expect(service.summarize('staff-1', 'conv-1')).rejects.toThrow('out of scope');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('degrades to no summary rather than throwing when the model fails', async () => {
    const { service } = build({ failure: true });
    const result = await service.summarize('staff-1', 'conv-1');
    expect(result.summary).toBeNull();
    // The conversation itself is still readable; that is the degradation §28 wants.
  });

  it('includes internal notes, which a suggested reply does not', async () => {
    const { service, prisma } = build({ output: FULL });
    await service.summarize('staff-1', 'conv-1');
    const where = prisma.message.findMany.mock.calls[0][0].where;
    expect(where.visibility).toBeUndefined();
    expect(where.moderation).toBe('published');
    expect(where.deletedForAll).toBe(false);
  });
});

describe('bounded context (§30)', () => {
  const msg = (seq: number, body: string) => ({
    seq: BigInt(seq), authorType: 'contact', visibility: 'customer', type: 'text',
    body, createdAt: new Date('2026-09-01T10:00:00Z'),
  });

  it('keeps the OPENING as well as the tail, and marks the gap', async () => {
    // The failure this prevents: a 200-message complaint thread summarised from
    // its tail describes an argument about scheduling and never mentions that
    // it began as a refund request.
    const tail = Array.from({ length: 10 }, (_, i) => msg(191 + i, `late-${i}`));
    const head = Array.from({ length: 6 }, (_, i) => msg(1 + i, `early-${i}`));
    const prisma = {
      message: {
        count: jest.fn().mockResolvedValue(200),
        findMany: jest.fn()
          .mockResolvedValueOnce([...tail].reverse())
          .mockResolvedValueOnce(head),
      },
    };

    const t = await buildTranscript(prisma as never, 'c', 10);

    expect(t.truncated).toBe(true);
    expect(t.text).toContain('early-0');
    expect(t.text).toContain('late-9');
    // Told that something is missing -- the difference between a summary with a
    // gap and a summary that is wrong.
    expect(t.text).toContain('earlier messages are not shown');
  });

  it('does not duplicate the opening when it is already in the tail', async () => {
    const all = Array.from({ length: 4 }, (_, i) => msg(1 + i, `m-${i}`));
    const prisma = {
      message: {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValueOnce([...all].reverse()),
      },
    };
    const t = await buildTranscript(prisma as never, 'c', 30);
    expect(t.truncated).toBe(false);
    expect(t.messages).toHaveLength(4);
    expect(t.text).not.toContain('not shown');
  });

  it('renders roles, never names (§31)', async () => {
    const prisma = {
      message: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { seq: 2n, authorType: 'staff', visibility: 'internal', type: 'text', body: 'note', createdAt: new Date() },
          { seq: 1n, authorType: 'contact', visibility: 'customer', type: 'text', body: 'hi', createdAt: new Date() },
        ]),
      },
    };
    const t = await buildTranscript(prisma as never, 'c', 30, { includeInternal: true });
    expect(t.text).toContain('Parent:');
    expect(t.text).toContain('Staff (internal note):');
  });
});
