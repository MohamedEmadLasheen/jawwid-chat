/**
 * PD-57 WP-1 (roadmap §5.5, §5.6 "Unit: DTO shaping"): what each side reads.
 *
 *   - the reporter's row has no evidence, no reviewer, no resolution, no note;
 *     `answer` only once answered
 *   - no staff shape names the reporter (id, kind, account) or the conversation
 *   - the evidence's attachment object keys stay on the server
 *   - the request parsers refuse what the contract does not allow
 */
import type { ContentReport } from '@prisma/client';
import { CommError, CommErrorCode } from '@platform/errors';
import {
  bodyDigest,
  decisionRow,
  detail,
  forReporter,
  parseIdempotencyKey,
  parseQueueFilter,
  parseReportInput,
  parseResolveInput,
  queueRow,
  receipt,
  requestDigest,
} from '../../../src/moderation/dto';

const REPORTER = '11111111-1111-4111-8111-111111111111';
const REPORTER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const REVIEWER = '44444444-4444-4444-8444-444444444444';

function report(over: Partial<ContentReport> = {}): ContentReport {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: '66666666-6666-4666-8666-666666666666',
    reporterKind: 'contact',
    reporterId: REPORTER,
    reporterAccountId: REPORTER_ACCOUNT,
    targetKind: 'message',
    messageId: '77777777-7777-4777-8777-777777777777',
    conversationId: CONVERSATION,
    subjectKind: 'teacher',
    subjectId: '88888888-8888-4888-8888-888888888888',
    reason: 'harassment',
    note: 'reporter note',
    evidence: {
      type: 'image',
      body: 'what was said',
      attachments: [{ kind: 'image', objectKey: 'conversations/secret-key.png', mimeType: 'image/png', byteSize: 10, name: 'a.png' }],
      author: { kind: 'teacher', id: '88888888-8888-4888-8888-888888888888', name: 'Teacher T' },
      sentAt: '2026-01-05T09:00:00.000Z',
    },
    priority: 'normal',
    status: 'actioned',
    dueAt: new Date('2026-01-07T10:00:00Z'),
    overdueAt: null,
    takenBy: REVIEWER,
    takenAt: new Date('2026-01-05T11:00:00Z'),
    resolution: 'warned',
    resolutionNote: 'internal staff note',
    resolvedBy: REVIEWER,
    resolvedAt: new Date('2026-01-05T12:00:00Z'),
    answerText: 'We spoke to the teacher.',
    reporterAnsweredAt: new Date('2026-01-05T12:00:00Z'),
    createdAt: new Date('2026-01-05T10:00:00Z'),
    ...over,
  } as ContentReport;
}

const names = new Map([[REVIEWER, 'Reviewer R']]);

function refusal(fn: () => unknown): { code: string; status: number } {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommError) return { code: e.code, status: e.status };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('the reporter reads status and the answer, nothing else', () => {
  it('an answered report', () => {
    expect(forReporter(report())).toEqual({
      id: report().id,
      targetKind: 'message',
      reason: 'harassment',
      status: 'actioned',
      createdAt: '2026-01-05T10:00:00.000Z',
      answer: { text: 'We spoke to the teacher.', at: '2026-01-05T12:00:00.000Z' },
    });
    const text = JSON.stringify(forReporter(report()));
    for (const leak of ['what was said', 'Teacher T', 'Reviewer R', REVIEWER, 'internal staff note', 'warned', 'reporter note']) {
      expect(text).not.toContain(leak);
    }
  });

  it('an open one has no answer key at all; the receipt is {id, status, dueAt}', () => {
    const open = report({ status: 'open', answerText: null, reporterAnsweredAt: null, resolution: null, resolvedBy: null, resolvedAt: null });
    expect(Object.keys(forReporter(open)).sort()).toEqual(['createdAt', 'id', 'reason', 'status', 'targetKind']);
    expect(receipt(open)).toEqual({ id: open.id, status: 'open', dueAt: '2026-01-07T10:00:00.000Z' });
  });
});

describe('no staff shape names the reporter', () => {
  it('the queue row, the decision and the detail', () => {
    const shapes = [queueRow(report(), names), decisionRow(report(), names), detail(report(), names, { deletedAt: null, subjectName: 'Teacher T' })];
    for (const shape of shapes) {
      const text = JSON.stringify(shape);
      for (const leak of [REPORTER, REPORTER_ACCOUNT, CONVERSATION, 'reporterId', 'reporterKind', 'reporterAccountId', 'conversationId']) {
        expect(text).not.toContain(leak);
      }
    }
    expect(Object.keys(queueRow(report(), names)).sort()).toEqual(
      ['createdAt', 'dueAt', 'id', 'overdueAt', 'priority', 'reason', 'reporterAnsweredAt', 'status', 'takenBy', 'takenByName', 'targetKind'].sort(),
    );
  });

  it('the detail: evidence without object keys; deletedAt read live', () => {
    const d = detail(report(), names, { deletedAt: new Date('2026-01-06T00:00:00Z'), subjectName: 'Teacher T' });
    expect(d.evidence).toEqual({
      type: 'image',
      body: 'what was said',
      attachments: [{ kind: 'image', mimeType: 'image/png', byteSize: 10, name: 'a.png' }],
      author: { kind: 'teacher', name: 'Teacher T' },
      sentAt: '2026-01-05T09:00:00.000Z',
      editedAt: null,
      forwarded: false,
      deletedAt: '2026-01-06T00:00:00.000Z',
    });
    expect(JSON.stringify(d)).not.toContain('secret-key');
    expect(d).toMatchObject({ note: 'reporter note', resolution: 'warned', resolutionNote: 'internal staff note', answerText: 'We spoke to the teacher.', takenByName: 'Reviewer R' });
  });
});

describe('POST /reports body', () => {
  const messageId = '77777777-7777-4777-8777-777777777777';
  it('a message, a person; an empty note is none', () => {
    expect(parseReportInput({ targetKind: 'message', messageId, reason: 'spam', note: '' })).toEqual({ targetKind: 'message', messageId, reason: 'spam', note: null });
    expect(parseReportInput({ targetKind: 'person', subject: { kind: 'teacher', id: 'x' }, reason: 'other', note: ' why ' })).toEqual({
      targetKind: 'person',
      subject: { kind: 'teacher', id: 'x' },
      reason: 'other',
      note: 'why',
    });
  });

  it('refusals', () => {
    expect(refusal(() => parseReportInput({ targetKind: 'message', messageId, reason: 'other' }))).toEqual({ code: CommErrorCode.REPORT_NOTE_REQUIRED, status: 400 });
    for (const body of [
      { targetKind: 'message', messageId, reason: 'blocked' },
      { targetKind: 'message', messageId, reason: 'spam', note: 'x'.repeat(501) },
      { targetKind: 'message', messageId, reason: 'spam', conversationId: 'c' },
      { targetKind: 'message', reason: 'spam' },
      { targetKind: 'person', reason: 'spam' },
      { targetKind: 'person', messageId, subject: { kind: 'teacher', id: 'x' }, reason: 'spam' },
      { reason: 'spam' },
    ]) {
      expect(refusal(() => parseReportInput(body))).toEqual({ code: CommErrorCode.VALIDATION, status: 400 });
    }
  });

  it('keys and digests: a key is bound to its reporter; another body is another digest', () => {
    expect(parseIdempotencyKey(undefined, 'abc')).toBe('abc');
    expect(parseIdempotencyKey('', undefined)).toBeNull();
    expect(refusal(() => parseIdempotencyKey('has space'))).toEqual({ code: CommErrorCode.VALIDATION, status: 400 });
    expect(requestDigest('contact', REPORTER, 'k')).not.toBe(requestDigest('contact', REVIEWER, 'k'));
    expect(requestDigest('contact', REPORTER, 'k')).not.toContain(REPORTER);
    const a = parseReportInput({ targetKind: 'message', messageId, reason: 'spam' });
    const b = parseReportInput({ targetKind: 'message', messageId, reason: 'harassment' });
    expect(bodyDigest(a)).not.toBe(bodyDigest(b));
    expect(bodyDigest(a)).toBe(bodyDigest(parseReportInput({ targetKind: 'message', messageId: messageId.toUpperCase(), reason: 'spam' })));
  });
});

describe('staff requests', () => {
  it('resolve: the answer is required and bounded', () => {
    expect(parseResolveInput({ resolution: 'no_action', answer: ' ok ', note: '' })).toEqual({ resolution: 'no_action', answer: 'ok', note: null });
    for (const body of [{ resolution: 'warned' }, { resolution: 'warned', answer: 'x'.repeat(1001) }, { resolution: 'nope', answer: 'x' }, { resolution: 'warned', answer: 'x', extra: 1 }]) {
      expect(refusal(() => parseResolveInput(body))).toEqual({ code: CommErrorCode.VALIDATION, status: 400 });
    }
  });

  it('the queue filters', () => {
    expect(parseQueueFilter({ status: 'open', priority: 'urgent', overdue: 'true' })).toEqual({ status: 'open', priority: 'urgent', overdue: true });
    expect(parseQueueFilter({})).toEqual({});
    for (const q of [{ status: 'closed' }, { priority: 'high' }, { overdue: '1' }]) {
      expect(refusal(() => parseQueueFilter(q))).toEqual({ code: CommErrorCode.VALIDATION, status: 400 });
    }
  });
});
