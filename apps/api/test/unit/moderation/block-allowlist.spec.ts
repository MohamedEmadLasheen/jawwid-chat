/**
 * PD-57 WP-2 (ENG-03), the pure rules of a block (closure plan 2026-11-06 §5, D-6):
 *
 *   - the Notification Center allowlist: lesson, payment, task and system kinds
 *     are never suppressed; conversation, call, announcement and marketing are
 *   - which message types a block hides (never system or card)
 *   - the placeholder DTO and the chat list preview carry no content
 *   - canOpenDirect refuses a blocked person (COMM.DIRECT_BLOCKED), nobody else
 *   - the realtime copy a blocker receives is marked, the payload never has a body
 */
import { CommErrorCode } from '@platform/errors';
import { AuthorizationService } from '@platform/authorization.service';
import type { Actor } from '@platform/types';
import { BLOCK_HIDEABLE_MESSAGE_TYPES, hideableByBlock } from '@platform/blocks';
import { BLOCK_EXEMPT_CATEGORIES, NOTIFICATION_CATEGORIES, suppressedByBlock } from '@communication/notifications/notification-catalog';
import { hideForBlock, toLastMessageDto, type MessageDto } from '@communication/contracts/dto';
import { ActorKind } from '@communication/contracts/vocab';
import type { CoverageService } from '@platform/coverage.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { CommEvent } from '@communication/contracts/events';

describe('PD-57: the Notification Center allowlist (D-6 exception 3)', () => {
  it('exactly lesson, payment, task and system are exempt', () => {
    expect([...BLOCK_EXEMPT_CATEGORIES].sort()).toEqual(['lesson', 'payment', 'system', 'task']);
    const suppressed = NOTIFICATION_CATEGORIES.filter((c) => !BLOCK_EXEMPT_CATEGORIES.has(c)).sort();
    expect(suppressed).toEqual(['announcement', 'call', 'conversation', 'marketing']);
  });

  it.each([
    ['lesson_parent_t24h', 'lesson_reminder', false],
    ['lesson_parent_t30m', 'lesson_reminder', false],
    ['lesson_clock_shift_parent', 'lesson_clock_shift', false],
    [null, 'case_opened', false],
    [null, 'block_created_manager', false],
    [null, 'conduct_warning', false],
    [null, 'payment_received', false],
    [null, 'lesson_changed', false], // not in the catalog: the system fallback, exempt
    ['new_message', 'message_published', true],
    ['mention', 'mention_created', true],
    ['missed_call', 'call_missed', true],
    ['story_published', 'story_published', true],
  ] as const)('%s / %s suppressed: %s', (rule, event, want) => {
    expect(suppressedByBlock(rule, event)).toBe(want);
  });
});

describe('PD-57: what a block hides', () => {
  it('text, image, video, voice and file; never system or card', () => {
    expect([...BLOCK_HIDEABLE_MESSAGE_TYPES].sort()).toEqual(['file', 'image', 'text', 'video', 'voice']);
    expect(hideableByBlock('system')).toBe(false);
    expect(hideableByBlock('card')).toBe(false);
    expect(hideableByBlock(null)).toBe(false);
  });

  it('the placeholder keeps who and when, and nothing of what', () => {
    const dto = {
      id: 'm1', conversationId: 'c1', seq: '4', authorKind: 'teacher', authorId: 't1', authorDisplayName: 'T', authorAvatarUrl: null,
      onBehalfMode: null, type: 'text', body: 'secret words', systemEvent: null, visibility: 'customer', moderation: 'published',
      origin: 'app', replyToMessageId: null, clientMessageId: null, deletedAt: null, deletedForAll: false, createdAt: '2026-11-06T00:00:00Z',
      editedAt: '2026-11-06T00:01:00Z', attachments: [{ id: 'a' }] as never, reactions: [{ actorId: 'x', emoji: 'x' }], forwarded: false,
      sentBySupport: false, status: null, card: null, mentions: [{}] as never, mentionsViewer: true,
    } as MessageDto;
    const hidden = hideForBlock(dto);
    expect(hidden).toMatchObject({ id: 'm1', authorKind: 'teacher', authorId: 't1', createdAt: dto.createdAt, hiddenByBlock: true });
    expect(hidden).toMatchObject({ body: null, editedAt: null, attachments: [], reactions: [], mentions: [], mentionsViewer: false });
    expect(JSON.stringify(hidden)).not.toContain('secret');
  });

  it('the chat list preview of a hidden message has no text', () => {
    const row = { seq: 3n, type: 'text', body: 'secret words', authorType: 'teacher', authorId: 't1', deletedForAll: false, createdAt: new Date(0), hiddenByBlock: true };
    const preview = toLastMessageDto(row as never);
    expect(preview).toMatchObject({ text: null, hiddenByBlock: true, authorId: 't1' });
    expect(toLastMessageDto({ ...row, hiddenByBlock: false } as never).text).toBe('secret words');
  });
});

describe('PD-57: canOpenDirect refuses only the blocked person', () => {
  const ORG = 'org';
  const authz = new AuthorizationService({ onDuty: async () => null } as CoverageService);
  const supervisor: Actor = { actorId: 's', kind: ActorKind.STAFF, displayName: 's', locale: 'ar', staffRole: 'admin' as Actor['staffRole'], isActive: true, organizationId: ORG };
  const parent: Actor = { actorId: 'p', kind: ActorKind.CONTACT, displayName: 'p', locale: 'ar', isActive: true, organizationId: ORG, familyId: 'f' };
  it('COMM.DIRECT_BLOCKED when the other side blocked the requester; allowed otherwise', () => {
    expect(authz.canOpenDirect(supervisor, parent, true, true)).toMatchObject({ allowed: false, code: CommErrorCode.DIRECT_BLOCKED });
    expect(authz.canOpenDirect(supervisor, parent, true, false)).toMatchObject({ allowed: true });
    expect(authz.canOpenDirect(supervisor, parent, true)).toMatchObject({ allowed: true });
  });
});

describe('PD-57: the realtime copy a blocker receives', () => {
  it('message.created: the blocker\'s copy is marked hiddenByBlock; everyone else\'s is the shared payload; no body anywhere', async () => {
    const sent: Array<{ how: string; payload: unknown; audience?: unknown }> = [];
    const realtime = {
      toThread: async (_t: string, _e: string, payload: unknown) => void sent.push({ how: 'thread', payload }),
      toUsers: async () => undefined,
      toThreadAudience: async (_t: string, _e: string, payload: unknown, audience: unknown) => void sent.push({ how: 'audience', payload, audience }),
    };
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray) =>
        strings.join('?').includes('FROM chat.actor_block WHERE blocked_id') ? [{ id: 'blocker-1' }] : [],
      outboxEvent: {},
    };
    const worker = new OutboxWorker(prisma as never, {} as never, realtime as never, {} as never);
    const payload = { conversationId: 'c', messageId: 'm', seq: '1', authorKind: 'teacher', authorId: 't', type: 'text', visibility: 'customer', moderation: 'published', createdAt: 'x' };
    await (worker as unknown as { toThreadMarkingBlocked(c: string, p: unknown): Promise<void> }).toThreadMarkingBlocked('c', payload);
    expect(sent).toEqual([{ how: 'audience', payload, audience: { perActor: { 'blocker-1': { ...payload, hiddenByBlock: true } } } }]);
    sent.length = 0;
    await (worker as unknown as { toThreadMarkingBlocked(c: string, p: unknown): Promise<void> }).toThreadMarkingBlocked('c', { ...payload, type: 'card' });
    expect(sent.map((x) => x.how)).toEqual(['thread']);
    expect(CommEvent.MESSAGE_CREATED).toBe('message.created');
  });
});
