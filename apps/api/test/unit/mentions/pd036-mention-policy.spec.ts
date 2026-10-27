/**
 * PD-36 -- the pure half of @mentions: what a client may send (spans that
 * really are "@..." in the text, in UTF-16 offsets), how the rate limits
 * count (per span, in the order written, dropped whole), and which mentions
 * survive an edit. Who may be mentioned is the database's answer and is
 * covered by the integration spec.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import {
  applyMentionCaps,
  mentionRuleFor,
  mentionSpanSurvivesEdit,
  parseMentionRequests,
  type PlannedMention,
} from '@communication/mentions/mention-policy';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function refusal(fn: () => unknown): CommError {
  try {
    fn();
  } catch (e) {
    return e as CommError;
  }
  throw new Error('expected a refusal');
}

describe('parseMentionRequests', () => {
  it('no list is no mentions', () => {
    expect(parseMentionRequests(undefined, 'hi')).toEqual([]);
    expect(parseMentionRequests(null, 'hi')).toEqual([]);
    expect(parseMentionRequests([], 'hi')).toEqual([]);
  });

  it('accepts a person and a role, by UTF-16 offset', () => {
    const body = '@Laila please check, @supervisor too';
    expect(
      parseMentionRequests(
        [
          { start: 0, length: 6, actorId: A },
          { start: 21, length: 11, role: 'supervisor' },
        ],
        body,
      ),
    ).toEqual([
      { start: 0, length: 6, actorId: A },
      { start: 21, length: 11, role: 'supervisor' },
    ]);
  });

  it('measures Arabic text in the units both clients index by', () => {
    const body = 'مرحبا @ليلى شكرا';
    const start = body.indexOf('@');
    expect(parseMentionRequests([{ start, length: 5, actorId: A }], body)).toHaveLength(1);
  });

  it.each([
    ['not a list', { start: 0 }],
    ['not an object', ['x']],
    ['outside the text', [{ start: 3, length: 9, actorId: A }]],
    ['not starting with @', [{ start: 1, length: 3, actorId: A }]],
    ['too short', [{ start: 0, length: 1, actorId: A }]],
    ['both a person and a role', [{ start: 0, length: 3, actorId: A, role: 'admin' }]],
    ['neither', [{ start: 0, length: 3 }]],
    ['an unknown role', [{ start: 0, length: 3, role: 'super_admin' }]],
    ['a person that is not an id', [{ start: 0, length: 3, actorId: 'laila' }]],
    ['a fractional offset', [{ start: 0.5, length: 3, actorId: A }]],
  ])('refuses %s (400, nothing sent)', (_why, raw) => {
    const e = refusal(() => parseMentionRequests(raw, '@ab cd'));
    expect(e.code).toBe(CommErrorCode.MENTION_INVALID);
    expect(e.status).toBe(400);
  });

  it('refuses overlapping spans', () => {
    const e = refusal(() =>
      parseMentionRequests(
        [
          { start: 0, length: 4, actorId: A },
          { start: 2, length: 3, actorId: B },
        ],
        '@a@bc',
      ),
    );
    expect(e.code).toBe(CommErrorCode.MENTION_INVALID);
  });

  it('refuses mentions with no text, and more than ten', () => {
    expect(refusal(() => parseMentionRequests([{ start: 0, length: 2, actorId: A }], null)).code).toBe(
      CommErrorCode.MENTION_INVALID,
    );
    const body = '@a '.repeat(11);
    const many = Array.from({ length: 11 }, (_, i) => ({ start: i * 3, length: 2, actorId: A }));
    expect(refusal(() => parseMentionRequests(many, body)).code).toBe(CommErrorCode.MENTION_INVALID);
  });
});

describe('applyMentionCaps', () => {
  const caps = { perSenderHour: 5, superAdminDay: 3, parentRoleDay: 3 };
  const none = { senderHour: 0, superAdminDay: 0, senderRoleDay: 0 };
  const person = (start: number, over: Partial<PlannedMention> = {}): PlannedMention => ({
    start,
    length: 2,
    targetActorId: `${A.slice(0, -2)}${String(start).padStart(2, '0')}`,
    targetKind: 'staff',
    viaRole: null,
    isSummons: false,
    targetIsSuperAdmin: false,
    ...over,
  });

  it('keeps everything under the caps', () => {
    const planned = [person(0), person(3)];
    expect(applyMentionCaps(planned, none, caps)).toEqual({ kept: planned, limited: false });
  });

  it('counts a role mention reaching two people as ONE mention', () => {
    const role = [person(0, { viaRole: 'admin', targetActorId: A }), person(0, { viaRole: 'admin', targetActorId: B })];
    const { kept, limited } = applyMentionCaps(role, { ...none, senderHour: 4 }, caps);
    expect(kept).toHaveLength(2);
    expect(limited).toBe(false);
  });

  it('drops the spans past the per-sender hour cap, in the order written', () => {
    const { kept, limited } = applyMentionCaps([person(9), person(0), person(3)], { ...none, senderHour: 3 }, caps);
    expect(kept.map((k) => k.start)).toEqual([0, 3]);
    expect(limited).toBe(true);
  });

  it('caps the super admin per conversation per day, whoever mentions them', () => {
    const sa = person(0, { targetIsSuperAdmin: true, isSummons: true });
    expect(applyMentionCaps([sa], { ...none, superAdminDay: 3 }, caps)).toEqual({ kept: [], limited: true });
    expect(applyMentionCaps([sa, person(3)], { ...none, superAdminDay: 2 }, caps).kept).toHaveLength(2);
  });

  it("caps a parent's role mentions per day, leaving named mentions alone", () => {
    const role = person(0, { viaRole: 'supervisor' });
    const { kept, limited } = applyMentionCaps([role, person(3)], { ...none, senderRoleDay: 3 }, caps);
    expect(kept.map((k) => k.start)).toEqual([3]);
    expect(limited).toBe(true);
  });
});

describe('mentionSpanSurvivesEdit', () => {
  it('keeps a mention whose text is unchanged', () => {
    expect(mentionSpanSurvivesEdit('@Laila hi', '@Laila hello', { start: 0, length: 6 })).toBe(true);
  });
  it('takes back a mention the edit changed, moved or cut off', () => {
    expect(mentionSpanSurvivesEdit('@Laila hi', '@Layla hi', { start: 0, length: 6 })).toBe(false);
    expect(mentionSpanSurvivesEdit('@Laila hi', 'so @Laila hi', { start: 0, length: 6 })).toBe(false);
    expect(mentionSpanSurvivesEdit('hi @Laila', 'hi', { start: 3, length: 6 })).toBe(false);
  });
});

describe('mentionRuleFor', () => {
  it('words a family-facing group as a family group, anything else as a conversation', () => {
    expect(mentionRuleFor('student_group')).toBe('mention_group');
    expect(mentionRuleFor('family_group')).toBe('mention_group');
    expect(mentionRuleFor('direct')).toBe('mention');
    expect(mentionRuleFor('teacher_supervision')).toBe('mention');
  });
});
