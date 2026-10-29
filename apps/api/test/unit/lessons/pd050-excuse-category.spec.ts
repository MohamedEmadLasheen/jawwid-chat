/**
 * PD-50 (the owner, 2026-10-29: "Parents see a category"): an excuse carries a
 * fixed reason category the family reads; the free-text reason stays with staff
 * and the lesson's teacher (PD-15). The pure parts, plus the make-up refreshes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXCUSE_CATEGORIES } from '../../../src/communication/contracts/vocab';
import { renderCardBody, excuseCategoryLabel } from '../../../src/lessons/lesson-card';
import { LessonService, categoryAfterCorrection, excuseCategoryField, excuseCategoryFor, excuseOnCard } from '../../../src/lessons/lesson.service';

const base = { lessonId: 'l1', learnerName: 'Omar', teacherName: 'T', startsAt: '2026-11-02T15:00:00.000Z' };

describe('the category list', () => {
  it('is the one both columns of 20261030040000 check, and every code has EN and AR words', () => {
    const sql = readFileSync(join(__dirname, '../../../../../supabase/migrations/20261030040000_chat_pd050_excuse_category.sql'), 'utf8');
    const lists = [...sql.matchAll(/check \(excuse_category in \(([^)]*)\)\)/g)].map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')));
    expect(lists).toHaveLength(2);
    for (const l of lists) expect(l).toEqual([...EXCUSE_CATEGORIES]);
    for (const c of EXCUSE_CATEGORIES) {
      expect(excuseCategoryLabel(c, false)).toBeTruthy();
      expect(excuseCategoryLabel(c, true)).toMatch(/[؀-ۿ]/);
    }
    expect(excuseCategoryLabel('secret', false)).toBeNull();
  });
});

describe('who reads the category (department head review of #298)', () => {
  it('a family reads its own excuse\'s category, never a teacher\'s; staff and the teacher read both', () => {
    const student = { outcome: 'student_apology', excuseCategory: 'travel' };
    const teacher = { outcome: 'teacher_apology', excuseCategory: 'illness' };
    expect(excuseCategoryFor('family', student)).toBe('travel');
    expect(excuseCategoryFor('family', teacher)).toBeNull();
    for (const s of ['teacher', 'supervisor', 'manager'] as const) {
      expect(excuseCategoryFor(s, teacher)).toBe('illness');
      expect(excuseCategoryFor(s, student)).toBe('travel');
    }
  });
});

describe('categoryAfterCorrection', () => {
  it('keeps the category only while the same party stays excused', () => {
    expect(categoryAfterCorrection('student_apology', 'student_apology', 'exams')).toBe('exams');
    expect(categoryAfterCorrection('teacher_apology', 'teacher_apology', 'illness')).toBe('illness');
    // The other party: one party's reason is never passed off as the other's.
    expect(categoryAfterCorrection('teacher_apology', 'student_apology', 'illness')).toBeNull();
    expect(categoryAfterCorrection('student_apology', 'teacher_apology', 'travel')).toBeNull();
    // Away from an excuse.
    expect(categoryAfterCorrection('student_apology', 'held', 'travel')).toBeNull();
    expect(categoryAfterCorrection('student_apology', 'voided', 'travel')).toBeNull();
  });
});

describe('the migration\'s guard', () => {
  it('refuses a category without its outcome on INSERT as well as on UPDATE', () => {
    const sql = readFileSync(join(__dirname, '../../../../../supabase/migrations/20261030040000_chat_pd050_excuse_category.sql'), 'utf8');
    expect(sql).toMatch(/before insert or update of excuse_category on chat\.lesson\b/);
    expect(sql).toMatch(/tg_op = 'INSERT'[\s\S]*new\.excuse_category is not null and new\.outcome is null[\s\S]*raise exception/);
  });
});

describe('excuseCategoryField', () => {
  it('takes a known code, treats absence as none, and refuses anything else', () => {
    expect(excuseCategoryField({ reasonCategory: 'travel' })).toBe('travel');
    expect(excuseCategoryField({})).toBeNull();
    expect(excuseCategoryField({ reasonCategory: '' })).toBeNull();
    expect(() => excuseCategoryField({ reasonCategory: 'hospital' })).toThrow(/reasonCategory/);
    expect(() => excuseCategoryField({ reasonCategory: 3 })).toThrow(/reasonCategory/);
  });
});

describe('excuseOnCard', () => {
  it('a category keeps everyone\'s words off the card; without one, only the family\'s own words show', () => {
    expect(excuseOnCard('illness', 'the child has a fever')).toEqual({ reasonCategory: 'illness' });
    expect(excuseOnCard(null, 'travelling')).toEqual({ reason: 'travelling' });
    expect(excuseOnCard(null, null)).toEqual({});
  });
});

describe('the plain-text body', () => {
  it('names the category on every excuse card, in both languages', () => {
    expect(renderCardBody('lesson_apology', { ...base, timing: 'before_start', reasonCategory: 'travel' }, 'en')).toContain('Reason: Travel');
    expect(renderCardBody('lesson_apology', { ...base, timing: 'after_start', reasonCategory: 'exams' }, 'ar')).toContain('السبب: امتحانات');
    expect(renderCardBody('lesson_late_apology', { ...base, reasonCategory: 'emergency' }, 'ar')).toContain('ظرف طارئ');
    expect(renderCardBody('lesson_ruling', { ...base, decision: 'excused', reasonCategory: 'other' }, 'en')).toContain('Reason: Other');
    expect(renderCardBody('lesson_ruling', { ...base, decision: 'teacher_credited', reasonCategory: 'other' }, 'en')).not.toContain('Reason');
  });

  it('a teacher apology never names a category to the family, even if a payload carried one', () => {
    expect(renderCardBody('lesson_teacher_apology', { ...base, reasonCategory: 'illness' }, 'en')).not.toContain('Illness');
    expect(renderCardBody('lesson_teacher_apology', { ...base, reasonCategory: 'illness' }, 'ar')).not.toContain('مرض');
  });

  it('a card without a category reads exactly as before', () => {
    expect(renderCardBody('lesson_teacher_apology', base, 'en')).not.toContain('Reason');
  });
});

describe('a make-up that changes refreshes the card that owed it', () => {
  function service() {
    const svc = Object.create(LessonService.prototype) as LessonService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const announce = jest.fn().mockResolvedValue(undefined);
    Object.assign(svc as object, { outbox: { enqueue }, announceOwedCard: announce });
    return { svc, enqueue, announce };
  }
  const lesson = (kind: string, makeupFor: string | null) => ({
    id: 'm1', learnerId: 'k', teacherId: 't', kind, makeupFor, outcome: 'admin_cancelled',
    startsAt: new Date('2026-11-04T16:00:00Z'), endsAt: new Date('2026-11-04T16:30:00Z'),
  });

  it('when a make-up is closed (cancelled, voided, excused, corrected)', async () => {
    const { svc, announce, enqueue } = service();
    await svc.emitClosed({} as never, lesson('makeup', 'l1') as never, false);
    expect(announce).toHaveBeenCalledWith({}, 'l1');
    expect(enqueue).toHaveBeenCalledWith({}, 'lesson.closed', expect.objectContaining({ lessonId: 'm1' }));
  });

  it('never for a regular lesson', async () => {
    const { svc, announce } = service();
    await svc.emitClosed({} as never, lesson('regular', null) as never, false);
    expect(announce).not.toHaveBeenCalled();
  });

  it('the announcement carries the card\'s seq, so a client re-reads that one message', async () => {
    const svc = Object.create(LessonService.prototype) as LessonService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    Object.assign(svc as object, { outbox: { enqueue } });
    const findMany = jest.fn().mockResolvedValue([
      { messageId: 'x', kind: 'lesson_apology', payload: base, message: { conversationId: 'c1', visibility: 'customer', seq: BigInt(42) } },
    ]);
    await svc.announceOwedCard({ messageCard: { findMany } } as never, 'l1');
    expect(enqueue.mock.calls[0][2]).toMatchObject({ conversationId: 'c1', messageId: 'x', seq: '42' });
  });
});
