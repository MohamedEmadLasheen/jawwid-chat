import { SuggestionService } from '../../../src/ai/suggestions/suggestion.service';
import { CommErrorCode } from '../../../src/platform/errors';

/**
 * Phase 7 §10 -- AI must never silently send.
 *
 * The guarantee has two halves and both are tested here:
 *
 *   1. generating a draft delivers nothing; and
 *   2. delivery, when a person asks for it, goes through MessageService.send
 *      authored by that person -- so every existing control applies and none of
 *      them had to learn AI exists.
 */

const CONV = { id: 'conv-1', familyId: 'fam-1', organizationId: 'org-1' };

function build(opts: {
  output?: unknown; failure?: boolean; sendThrows?: Error; scanFlagged?: boolean;
} = {}) {
  const created: unknown[] = [];
  const suggestionRow = {
    id: 'sug-1',
    conversationId: 'conv-1',
    requestedBy: 'staff-1',
    body: 'نعتذر عن التأخير، سنعود إليكم اليوم.',
    status: 'pending',
  };

  const prisma = {
    aiSuggestion: {
      create: jest.fn(async ({ data }: any) => { created.push(data); return { ...suggestionRow, ...data }; }),
      update: jest.fn(async ({ data }: any) => ({ ...suggestionRow, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(suggestionRow),
      findMany: jest.fn().mockResolvedValue([]),
    },
    message: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        { seq: 1n, authorType: 'contact', visibility: 'customer', type: 'text',
          body: 'لم يحضر المدرس اليوم!', createdAt: new Date('2026-09-01T10:00:00Z') },
        { seq: 2n, authorType: 'staff', visibility: 'customer', type: 'text',
          body: 'سنتحقق.', createdAt: new Date('2026-09-01T10:05:00Z') },
      ]),
    },
    $transaction: jest.fn(async (fn: any) => fn({})),
  };

  const messages = {
    send: jest.fn(async () => {
      if (opts.sendThrows) throw opts.sendThrows;
      return { id: 'msg-99' };
    }),
  };
  const conversations = { requireForActor: jest.fn().mockResolvedValue(CONV) };
  // Phase 6's scanner, reused. SAFE unless a test says otherwise.
  const moderation = {
    scanBody: jest.fn().mockResolvedValue(
      opts.scanFlagged
        ? { status: 'flagged', matches: [], highestSeverity: 'high', reasons: ['phone_number'], errors: [] }
        : { status: 'safe', matches: [], highestSeverity: null, reasons: [], errors: [] },
    ),
  };
  const knowledge = { searchApproved: jest.fn().mockResolvedValue([]) };
  const ai = {
    isEnabled: jest.fn().mockResolvedValue(true),
    run: jest.fn(async () =>
      opts.failure
        ? { ok: false, failure: 'timeout', detail: 'x' }
        : { ok: true, value: opts.output, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } },
    ),
  };
  const config = {
    get: jest.fn(async (k: string) =>
      ({
        'ai.suggestion_context_messages': 30,
        'ai.faq_max_articles': 6,
        'ai.min_confidence': 0.6,
        'ai.suggestion_stale_minutes': 120,
      })[k] ?? null,
    ),
  };
  const identity = {
    resolveActor: jest.fn().mockResolvedValue({
      actorId: 'staff-1', kind: 'staff', isActive: true, staffRole: 'admin', locale: 'ar',
      permissions: new Set(['ai.use']),
    }),
  };
  const audit = { audit: jest.fn(), event: jest.fn() };

  const service = new SuggestionService(
    prisma as never, identity as never, audit as never,
    conversations as never, messages as never, moderation as never,
    knowledge as never, ai as never, config as never,
  );
  return { service, prisma, messages, conversations, ai, audit, identity, moderation };
}

const GOOD = { hasSuggestion: true, reply: 'نعتذر عن التأخير.', confidence: 0.85, usedSources: [] };

describe('suggested replies never send themselves', () => {
  it('generating a draft sends NOTHING', async () => {
    const { service, messages, prisma } = build({ output: GOOD });

    const suggestion = await service.generate('staff-1', 'conv-1');

    expect(suggestion).not.toBeNull();
    // The whole point.
    expect(messages.send).not.toHaveBeenCalled();
    expect(prisma.aiSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) }),
    );
  });

  it('sending goes through MessageService.send authored by the PERSON', async () => {
    const { service, messages } = build({ output: GOOD });

    const { messageId } = await service.send('staff-1', 'sug-1');

    expect(messageId).toBe('msg-99');
    expect(messages.send).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      // Not a model, not a system actor: the staff member's own id, carrying
      // their permissions and their accountability.
      senderId: 'staff-1',
      body: 'نعتذر عن التأخير، سنعود إليكم اليوم.',
    });
  });

  it('a refused send leaves the suggestion pending and does not swallow the error', async () => {
    // BR-1, scope, a silent member, an inactive actor -- the send pipeline
    // raises, and the assistant must not paper over it.
    const denied = Object.assign(new Error('denied'), { code: CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED });
    const { service, prisma } = build({ output: GOOD, sendThrows: denied });

    await expect(service.send('staff-1', 'sug-1')).rejects.toThrow('denied');
    expect(prisma.aiSuggestion.update).not.toHaveBeenCalled();
  });

  it('records an edited send distinctly from a verbatim one', async () => {
    const { service, messages, prisma } = build({ output: GOOD });

    await service.send('staff-1', 'sug-1', 'نعتذر بشدة، سنعود خلال ساعة.');

    expect(messages.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'نعتذر بشدة، سنعود خلال ساعة.' }),
    );
    expect(prisma.aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'edited_sent' }) }),
    );
  });

  it('an unchanged edit is still a verbatim send', async () => {
    const { service, prisma } = build({ output: GOOD });
    await service.send('staff-1', 'sug-1', 'نعتذر عن التأخير، سنعود إليكم اليوم.');
    expect(prisma.aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }),
    );
  });

  it('refuses to send the same suggestion twice', async () => {
    const { service, prisma } = build({ output: GOOD });
    prisma.aiSuggestion.findUnique.mockResolvedValue({
      id: 'sug-1', conversationId: 'conv-1', requestedBy: 'staff-1', body: 'x', status: 'sent',
    });
    await expect(service.send('staff-1', 'sug-1')).rejects.toMatchObject({
      code: CommErrorCode.SUGGESTION_ALREADY_RESOLVED,
    });
  });

  it('will not let one supervisor send another supervisor\'s draft', async () => {
    const { service, prisma, messages } = build({ output: GOOD });
    prisma.aiSuggestion.findUnique.mockResolvedValue({
      id: 'sug-1', conversationId: 'conv-1', requestedBy: 'someone-else', body: 'x', status: 'pending',
    });
    await expect(service.send('staff-1', 'sug-1')).rejects.toMatchObject({
      // Same code as "does not exist": this endpoint is not an oracle for what
      // other supervisors are being offered.
      code: CommErrorCode.SUGGESTION_NOT_FOUND,
    });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('checks conversation authorization BEFORE reading any context', async () => {
    const { service, conversations, prisma } = build({ output: GOOD });
    conversations.requireForActor.mockRejectedValue(new Error('not a member'));

    await expect(service.generate('staff-1', 'conv-1')).rejects.toThrow('not a member');
    // No transcript was assembled from a conversation the caller cannot open.
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('proposes nothing when the model declines, is unsure, or fails', async () => {
    for (const output of [
      { hasSuggestion: false, reply: '', confidence: 0.9, usedSources: [] },
      { hasSuggestion: true, reply: 'maybe', confidence: 0.2, usedSources: [] },
      { hasSuggestion: true, reply: '   ', confidence: 0.9, usedSources: [] },
    ]) {
      const { service, prisma } = build({ output });
      expect(await service.generate('staff-1', 'conv-1')).toBeNull();
      expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
    }
    const failed = build({ failure: true });
    expect(await failed.service.generate('staff-1', 'conv-1')).toBeNull();
  });

  it('rejects a draft citing knowledge it was never given', async () => {
    const { service, prisma } = build({
      output: { hasSuggestion: true, reply: 'Fees are 200.', confidence: 0.9, usedSources: [3] },
    });
    expect(await service.generate('staff-1', 'conv-1')).toBeNull();
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
  });

  it('discards a draft the organization\'s own moderation rules flag', async () => {
    // The realistic failure is not a jailbreak: it is a model helpfully
    // drafting "call us on 0100 123 4567". A staff send is NOT scanned on its
    // way out (Phase 6's policy), so without this check the assistant would be
    // the one path by which unreviewed text reaches a family.
    const { service, prisma, moderation } = build({ output: GOOD, scanFlagged: true });

    expect(await service.generate('staff-1', 'conv-1')).toBeNull();
    expect(moderation.scanBody).toHaveBeenCalled();
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
  });

  it('scans the DRAFTED text, using Phase 6\'s scanner rather than a second one', async () => {
    const { service, moderation } = build({ output: GOOD });
    await service.generate('staff-1', 'conv-1');
    expect(moderation.scanBody).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'staff-1' }),
      'نعتذر عن التأخير.',
    );
  });

  it('keeps internal staff notes out of a draft meant for a family', async () => {
    const { service, prisma } = build({ output: GOOD });
    await service.generate('staff-1', 'conv-1');
    // The transcript query filters to customer-visible, published, undeleted.
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibility: 'customer',
          moderation: 'published',
          deletedForAll: false,
        }),
      }),
    );
  });
});
