/**
 * PD-37: the ticks on a message, as a pure function of its receipt rows and who
 * counts as a reader. The mapper never sends per-recipient read state; the
 * author gets one aggregate, everyone else gets null.
 */
import { MessageReceipt } from '@prisma/client';
import { messageStatus, ReceiptView, toMessageDto } from '@communication/contracts/dto';
import { buildReceiptView, isCountableReader, MemberRow } from '@communication/messages/receipt-view';

const CONV = 'c1';
const AUTHOR = 'author';

function receipt(actorId: string, state: string): MessageReceipt {
  return {
    id: `r-${actorId}`,
    messageId: 'm1',
    actorId,
    state,
    sentAt: new Date(0),
    deliveredAt: state === 'sent' ? null : new Date(1),
    readAt: state === 'read' ? new Date(2) : null,
  };
}

function member(actorId: string, over: Partial<MemberRow> = {}): MemberRow {
  return {
    conversationId: CONV,
    actorId,
    actorKind: 'staff',
    memberRole: 'admin',
    isSilent: false,
    leftAt: null,
    ...over,
  };
}

const message = (receipts: MessageReceipt[], over: { authorId?: string; deletedForAll?: boolean } = {}) => ({
  authorId: AUTHOR,
  conversationId: CONV,
  deletedForAll: false,
  receipts,
  ...over,
});

/** A family group: the parent writes; a teacher and a supervisor are seated. */
function groupView(viewerId = AUTHOR, extra: MemberRow[] = []): ReceiptView {
  return buildReceiptView(viewerId, new Map([[CONV, 'student_group']]), [
    member(AUTHOR, { actorKind: 'contact', memberRole: 'parent' }),
    member('teacher', { actorKind: 'teacher', memberRole: 'teacher' }),
    member('supervisor'),
    ...extra,
  ]);
}

describe('PD-37 countable readers', () => {
  it('a live, speaking, non-observer member counts; silent, observer and departed do not', () => {
    expect(isCountableReader(member('a'))).toBe(true);
    expect(isCountableReader(member('a', { isSilent: true }))).toBe(false);
    expect(isCountableReader(member('a', { memberRole: 'observer' }))).toBe(false);
    expect(isCountableReader(member('a', { leftAt: new Date() }))).toBe(false);
  });
});

describe('PD-37 messageStatus: the WhatsApp group rule', () => {
  it('read only when EVERY countable reader read it', () => {
    const view = groupView();
    expect(messageStatus(message([receipt('teacher', 'read'), receipt('supervisor', 'sent')]), view)).toBe('sent');
    expect(messageStatus(message([receipt('teacher', 'read'), receipt('supervisor', 'delivered')]), view)).toBe('delivered');
    expect(messageStatus(message([receipt('teacher', 'read'), receipt('supervisor', 'read')]), view)).toBe('read');
  });

  it('a silent or observer member neither counts nor blocks', () => {
    const view = groupView(AUTHOR, [member('silent', { isSilent: true }), member('watcher', { memberRole: 'observer' })]);
    const receipts = [
      receipt('teacher', 'read'),
      receipt('supervisor', 'read'),
      receipt('silent', 'sent'),
      receipt('watcher', 'sent'),
    ];
    expect(messageStatus(message(receipts), view)).toBe('read');
    // ...and their reading alone never turns anything blue.
    const onlyThem = [receipt('teacher', 'sent'), receipt('supervisor', 'sent'), receipt('silent', 'read'), receipt('watcher', 'read')];
    expect(messageStatus(message(onlyThem), view)).toBe('sent');
  });

  it('a recipient who has left stops blocking', () => {
    const receipts = [receipt('teacher', 'read'), receipt('supervisor', 'read'), receipt('gone', 'sent')];
    expect(messageStatus(message(receipts), groupView())).toBe('read');
  });

  it('is null for anyone but the author, for a deleted message and for PD-7 direct teacher<->parent', () => {
    const receipts = [receipt('teacher', 'read'), receipt('supervisor', 'read')];
    expect(messageStatus(message(receipts), groupView('teacher'))).toBeNull();
    expect(messageStatus(message(receipts, { deletedForAll: true }), groupView())).toBeNull();
    expect(messageStatus(message(receipts), undefined)).toBeNull();

    const direct = buildReceiptView(AUTHOR, new Map([[CONV, 'direct']]), [
      member(AUTHOR, { actorKind: 'contact', memberRole: 'parent' }),
      member('teacher', { actorKind: 'teacher', memberRole: 'teacher' }),
    ]);
    expect(messageStatus(message([receipt('teacher', 'read')]), direct)).toBeNull();
  });
});

describe('PD-37 MessageDto carries no per-recipient read state (closes RT-012)', () => {
  it('has no receipts field, for any viewer', () => {
    const row = {
      id: 'm1',
      conversationId: CONV,
      seq: BigInt(1),
      authorType: 'contact',
      authorId: AUTHOR,
      deletedForAll: false,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(0),
      attachments: [],
      reactions: [],
      receipts: [receipt('teacher', 'read'), receipt('supervisor', 'read')],
      card: null,
    } as unknown as Parameters<typeof toMessageDto>[0];

    const forAuthor = toMessageDto(row, new Map(), new Map(), undefined, groupView());
    const forTeacher = toMessageDto(row, new Map(), new Map(), undefined, groupView('teacher'));
    for (const dto of [forAuthor, forTeacher]) {
      expect(Object.keys(dto)).not.toContain('receipts');
      expect(JSON.stringify(dto)).not.toMatch(/readAt|deliveredAt/);
    }
    expect(forAuthor.status).toBe('read');
    expect(forTeacher.status).toBeNull();
  });
});
