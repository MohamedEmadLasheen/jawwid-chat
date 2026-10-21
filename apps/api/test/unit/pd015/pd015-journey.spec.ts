/**
 * PD-15, the pure parts: the month summary's counting rules, the report's
 * fields, what a card tells a family, who may do what, a child's age and a
 * family group's name.
 */
import { renderCardBody } from '../../../src/lessons/lesson-card';
import { availableActs, reportFields } from '../../../src/lessons/lesson.service';
import { monthSummary } from '../../../src/lessons/stats.service';
import { ageOn } from '../../../src/lessons/enrollment.service';
import { familyGroupTitle } from '../../../src/communication/conversations/conversation.service';
import { AuthorizationService } from '../../../src/platform/authorization.service';
import { CommError } from '../../../src/platform/errors';

const row = (category: string, lessons: number, kind = 'regular') => ({
  teacher_id: 't', category, kind, duration_minutes: 30, lessons, minutes: lessons * 30,
});

describe('monthSummary', () => {
  it('puts every lesson in exactly one line and adds make-ups to the completed total', () => {
    const rows = [
      row('held', 100), row('held', 8, 'makeup'), row('upcoming', 2, 'makeup'),
      row('student_no_show', 3), row('student_apology', 5), row('teacher_apology', 2),
      row('teacher_no_show', 1), row('admin_cancelled', 1), row('unreported', 4), row('upcoming', 6),
      row('rescheduled', 9), row('suspended', 7), row('held', 3, 'trial'),
    ];
    const s = monthSummary(rows, [{ teacher_id: 't', kind: 'regular', before_start: 3, after_start: 2 }]);
    expect(s.completed).toEqual({ regular: 100, makeup: 8, total: 108 });
    expect(s.makeups).toEqual({ completed: 8, scheduled: 2, total: 10 });
    expect(s.studentExcuses).toEqual({ total: 5, beforeStart: 3, afterStart: 2 });
    expect(s.pending).toEqual({ total: 12, upcoming: 8, awaitingReport: 4 });
    // Replaced and paused lessons are not scheduled lessons any more; trials are not a student's.
    expect(s.totalScheduled).toBe(132);
    const lines = s.conducted + s.studentNoShow + s.studentExcuses.total + s.teacherExcuses + s.teacherNoShow + s.cancelled + s.pending.total;
    expect(lines).toBe(s.totalScheduled);
  });

  it('a teacher excuse is never a lesson conducted', () => {
    const s = monthSummary([row('teacher_apology', 4)], []);
    expect(s.conducted).toBe(0);
    expect(s.teacherExcuses).toBe(4);
  });
});

describe('reportFields', () => {
  const fail = (body: Record<string, unknown>) => {
    expect(() => reportFields(body)).toThrow(CommError);
  };
  it('needs a topic or a short text, and only known codes', () => {
    expect(reportFields({ coveredTopics: ['revision', 'revision'] }).coveredTopics).toEqual(['revision']);
    expect(reportFields({ covered: 'Al-Fatiha' }).covered).toBe('Al-Fatiha');
    fail({});
    fail({ coveredTopics: ['astrology'] });
    fail({ coveredTopics: ['revision'], nextTasks: ['sleep'] });
    fail({ coveredTopics: ['revision'], rating: 6 });
    fail({ coveredTopics: ['revision'], lessonNumber: 1.5 });
  });
});

describe('cards a family reads', () => {
  const base = { learnerName: 'Sara' };
  it('a report card never carries the private note', () => {
    const body = renderCardBody('lesson_report', { ...base, coveredTopics: ['tajweed'], rating: 5, note: 'secret' }, 'en');
    expect(body).toContain('Tajweed rules');
    expect(body).toContain('Excellent');
    expect(body).not.toContain('secret');
  });
  it('a teacher\'s excuse and a supervisor\'s late excuse never show a reason', () => {
    expect(renderCardBody('lesson_teacher_apology', { ...base, reason: 'doctor' }, 'en')).not.toContain('doctor');
    expect(renderCardBody('lesson_apology', { ...base, timing: 'after_start', reason: 'hospital' }, 'ar')).not.toContain('hospital');
  });
  it('a correction says what the lesson is now, in Arabic too', () => {
    expect(renderCardBody('lesson_corrected', { ...base, outcome: 'student_apology', apologyTiming: 'after_start' }, 'ar'))
      .toContain('بعد بداية الحصة');
  });
});

describe('who may do what (PD-15)', () => {
  const authz = new AuthorizationService({} as never);
  const staff = { kind: 'staff', actorId: 's', organizationId: 'o', isActive: true, staffRole: 'admin' } as never;
  const teacher = { kind: 'teacher', actorId: 't', organizationId: 'o', isActive: true } as never;
  const parent = { kind: 'contact', actorId: 'c', organizationId: 'o', isActive: true, familyId: 'f', canMessage: true } as never;
  it.each([
    ['late_excuse', staff, 'supervisor', true], ['late_excuse', parent, 'family', false], ['late_excuse', teacher, 'teacher', false],
    ['correct_outcome', staff, 'supervisor', true], ['correct_outcome', staff, 'manager', true], ['correct_outcome', teacher, 'teacher', false],
    ['edit_report', teacher, 'teacher', true], ['edit_report', parent, 'family', false],
    ['delete_report', teacher, 'teacher', false], ['delete_report', staff, 'supervisor', true],
    ['book_makeup', teacher, 'teacher', true], ['apology', staff, 'supervisor', true], ['report', staff, 'supervisor', false],
  ] as const)('%s by %s standing %s -> %s', (act, actor, standing, allowed) => {
    expect(authz.canRecordLessonAct(actor, standing, act).allowed).toBe(allowed);
  });
});

describe('availableActs', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it('offers the supervisor\'s late excuse after the start, also over a waiting family late apology', () => {
    const lesson = { outcome: null, startsAt: new Date('2026-10-21T09:00:00Z') };
    expect(availableActs({ ...lesson, rulings: [] }, now)).toContain('late_excuse');
    expect(availableActs({ ...lesson, rulings: [{ kind: 'late_apology', decision: null }] }, now)).toContain('late_excuse');
    expect(availableActs({ ...lesson, rulings: [{ kind: 'late_apology', decision: 'excused' }] }, now)).not.toContain('late_excuse');
    expect(availableActs({ outcome: 'held', startsAt: lesson.startsAt, rulings: [] }, now)).not.toContain('late_excuse');
  });
});

describe('a child\'s age and a family group\'s name', () => {
  it('counts whole years', () => {
    expect(ageOn(new Date('2016-10-22T00:00:00Z'), new Date('2026-10-21T00:00:00Z'))).toBe(9);
    expect(ageOn(new Date('2016-10-21T00:00:00Z'), new Date('2026-10-21T00:00:00Z'))).toBe(10);
  });
  it('names the teacher and the children when there is one teacher', () => {
    expect(familyGroupTitle(['Ahmed'], ['Sara', 'Ali'])).toBe('Ahmed — Sara · Ali');
    expect(familyGroupTitle(['Ahmed', 'Mona'], ['Sara', 'Ali'])).toBe('Sara · Ali · Jawwid');
    expect(familyGroupTitle([], ['Sara'])).toBe('Sara · Jawwid');
  });
});
