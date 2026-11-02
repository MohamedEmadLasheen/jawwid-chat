/**
 * PD-46 §3.3: whether a staff member's calendar scope covers a lesson, the test
 * the worker applies before a lesson.changed reaches that staff member. The
 * scopes themselves (CalendarService.scopeOf) and the fan-out are covered by
 * test/integration/pd046-lesson-events.spec.ts.
 */
import { covers } from '../../../src/calendar/lesson-audience.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';

describe('covers', () => {
  it('an academy-wide scope covers every lesson', () => {
    expect(covers({ kind: 'academy', staffId: 's' }, { teacherId: T1, learnerId: null })).toBe(true);
  });

  it('a Teachers scope covers its teachers\' lessons only', () => {
    const scope = { kind: 'teachers' as const, staffId: 's', teacherIds: new Set([T1]) };
    expect(covers(scope, { teacherId: T1, learnerId: L1 })).toBe(true);
    expect(covers(scope, { teacherId: T2, learnerId: L1 })).toBe(false);
  });

  it('a supervisor is covered by a named teacher (PD-35) or by an own learner (PD-8), either one', () => {
    const scope = { kind: 'supervisor' as const, staffId: 's', namedTeachers: new Set([T1]), ownLearners: new Set([L1]) };
    expect(covers(scope, { teacherId: T1, learnerId: L2 })).toBe(true);
    expect(covers(scope, { teacherId: T1, learnerId: null })).toBe(true);
    expect(covers(scope, { teacherId: T2, learnerId: L1 })).toBe(true);
    expect(covers(scope, { teacherId: T2, learnerId: L2 })).toBe(false);
    expect(covers(scope, { teacherId: T2, learnerId: null })).toBe(false);
  });
});
