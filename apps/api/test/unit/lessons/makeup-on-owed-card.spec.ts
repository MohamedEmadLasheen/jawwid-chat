/**
 * 2026-10-29 owner report: the group never learnt when the make-up of an excused
 * lesson is. A card is written once, so every read joins the card that owed a
 * make-up with its live make-up; booking or moving the make-up announces
 * message.updated for that card so open threads re-read it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_LIVE_MAKEUP_OUTCOMES, owesMakeup, withOwedMakeups } from '../../../src/communication/messages/owed-makeup';
import { LessonService } from '../../../src/lessons/lesson.service';
import { renderCardBody } from '../../../src/lessons/lesson-card';

const base = { lessonId: 'l1', learnerName: 'Omar', teacherName: 'T', startsAt: '2026-11-02T15:00:00.000Z' };
const makeup = { id: 'm1', makeupFor: 'l1', startsAt: new Date('2026-11-04T16:00:00.000Z'), endsAt: new Date('2026-11-04T16:30:00.000Z') };
const row = (id: string, kind: string, payload: Record<string, unknown>, lessonId: string | null = 'l1') => ({ id, card: { kind, lessonId, payload } });

describe('owesMakeup', () => {
  it('picks the cards that owe a make-up and nothing else', () => {
    expect(owesMakeup('lesson_apology', {})).toBe(true);
    expect(owesMakeup('lesson_teacher_apology', {})).toBe(true);
    expect(owesMakeup('lesson_cancelled', { outcome: 'teacher_no_show' })).toBe(true);
    expect(owesMakeup('lesson_cancelled', { outcome: 'admin_cancelled' })).toBe(false);
    expect(owesMakeup('lesson_ruling', { decision: 'excused' })).toBe(true);
    expect(owesMakeup('lesson_ruling', { decision: 'teacher_credited' })).toBe(false);
    expect(owesMakeup('lesson_report', {})).toBe(false);
  });
});

describe('withOwedMakeups', () => {
  it('merges the standing make-up into an owed card, keeping what the card said', async () => {
    const findMany = jest.fn().mockResolvedValue([makeup]);
    const rows = [
      row('a', 'lesson_apology', { ...base, reason: 'exams', makeupOwed: true }),
      row('b', 'lesson_report', { ...base }),
      { id: 'c', card: null },
    ];
    const out = await withOwedMakeups({ lesson: { findMany } } as never, rows);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.makeupFor).toEqual({ in: ['l1'] });
    // Only the make-up the database counts as live (see the next describe).
    expect(where.kind).toBe('makeup');
    expect(where.OR).toEqual([{ outcome: null }, { outcome: { notIn: [...NOT_LIVE_MAKEUP_OUTCOMES] } }]);
    expect(out[0].card!.payload).toEqual({
      ...base, reason: 'exams', makeupOwed: true,
      makeupLessonId: 'm1', makeupStartsAt: '2026-11-04T16:00:00.000Z', makeupEndsAt: '2026-11-04T16:30:00.000Z',
    });
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
    // The stored row is never touched.
    expect(rows[0].card!.payload).not.toHaveProperty('makeupStartsAt');
  });

  it('a page with no owed card costs no query', async () => {
    const findMany = jest.fn();
    const rows = [row('a', 'lesson_report', base), row('b', 'lesson_cancelled', { ...base, outcome: 'admin_cancelled' })];
    expect(await withOwedMakeups({ lesson: { findMany } } as never, rows)).toBe(rows);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('no standing make-up: the card is unchanged and still says one is owed', async () => {
    const rows = [row('a', 'lesson_teacher_apology', { ...base, makeupOwed: true })];
    const out = await withOwedMakeups({ lesson: { findMany: jest.fn().mockResolvedValue([]) } } as never, rows);
    expect(out[0]).toBe(rows[0]);
  });
});

describe('a standing make-up is the database\'s live make-up', () => {
  it('excludes exactly the outcomes the latest chat.lesson_one_live_makeup excludes', () => {
    const dir = join(__dirname, '../../../../../supabase/migrations');
    const latest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .flatMap((sql) => [...sql.matchAll(/create unique index lesson_one_live_makeup[\s\S]*?;/gi)].map((m) => m[0]))
      .pop();
    expect(latest).toBeDefined();
    expect(latest).toMatch(/where kind = 'makeup'/);
    const list = /outcome not in \(([^)]*)\)/.exec(latest!)![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect([...NOT_LIVE_MAKEUP_OUTCOMES].sort()).toEqual(list.sort());
  });
});

describe('announceOwedCard', () => {
  it('tells the thread to re-read every live card that owed the make-up', async () => {
    const svc = Object.create(LessonService.prototype) as LessonService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { outbox: unknown }).outbox = { enqueue };
    const findMany = jest.fn().mockResolvedValue([
      { messageId: 'x', kind: 'lesson_apology', payload: base, message: { conversationId: 'c1', visibility: 'customer' } },
      { messageId: 'y', kind: 'lesson_ruling', payload: { ...base, decision: 'teacher_credited' }, message: { conversationId: 'c1', visibility: 'customer' } },
    ]);
    await svc.announceOwedCard({ messageCard: { findMany } } as never, 'l1');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ lessonId: 'l1', message: { deletedForAll: false } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toBe('message.updated');
    expect(enqueue.mock.calls[0][2]).toMatchObject({ conversationId: 'c1', messageId: 'x', visibility: 'customer' });
  });
});

describe('the plain-text body', () => {
  it('still never shows a teacher\'s or a supervisor\'s internal reason', () => {
    expect(renderCardBody('lesson_teacher_apology', { ...base, reason: 'doctor' }, 'en')).not.toContain('doctor');
    expect(renderCardBody('lesson_apology', { ...base, timing: 'after_start', reason: 'hospital' }, 'en')).not.toContain('hospital');
  });
});
