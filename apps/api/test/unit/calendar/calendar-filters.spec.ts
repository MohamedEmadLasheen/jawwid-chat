/**
 * PD-38: the calendar's query string and shift windows, parsed once. The SQL
 * that applies them is covered by test/integration/pd038-schedule-calendar.spec.ts.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { hasLessonFilter, parseFilters, utilization } from '../../../src/calendar/calendar-filters';
import { defaultWindows, parseWindows } from '../../../src/calendar/work-pattern.service';
import { PALETTE_KEYS } from '../../../src/calendar/palette';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function refusal(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof CommError) return `${e.code}: ${e.message}`;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('parseFilters', () => {
  const w = { from: '2026-10-01', to: '2026-10-08' };

  it('a bare window has no filter at all', () => {
    const f = parseFilters(w);
    expect(f).toMatchObject({
      from: '2026-10-01', to: '2026-10-08', teacherIds: null, categories: null, supervisorIds: null,
      withoutSupervisor: false, learnerIds: null, statuses: null, kinds: null, weekdays: null,
      timeFrom: null, timeTo: null, utilization: null, emptyMinutesGte: null, onlyMatching: true,
    });
    expect(hasLessonFilter(f)).toBe(false);
  });

  it('lists are comma-separated, de-duplicated, and checked item by item', () => {
    const f = parseFilters({
      ...w, teacherIds: `${A},${B},${A}`, categories: 'full_shift,hourly', supervisorIds: `${A},none`,
      statuses: 'trial,paused', kinds: 'makeup', weekdays: '6,7,1', utilization: 'lt50,gte80',
      timeFrom: '12:00', timeTo: '24:00', emptyMinutesGte: '120', onlyMatching: 'false',
    });
    expect(f.teacherIds).toEqual([A, B]);
    expect(f.supervisorIds).toEqual([A]);
    expect(f.withoutSupervisor).toBe(true);
    expect(f.weekdays).toEqual([6, 7, 1]);
    expect(f.timeFrom).toBe(720);
    expect(f.timeTo).toBe(1440);
    expect(f.emptyMinutesGte).toBe(120);
    expect(f.onlyMatching).toBe(false);
    expect(hasLessonFilter(f)).toBe(true);
  });

  it('teacher-level filters alone are not lesson filters', () => {
    expect(hasLessonFilter(parseFilters({ ...w, teacherIds: A, categories: 'part_shift', utilization: 'lt50' }))).toBe(false);
    expect(hasLessonFilter(parseFilters({ ...w, supervisorIds: 'none' }))).toBe(true);
  });

  it.each([
    [{ from: '2026-10-01' }, /to: a day/],
    [{ from: '2026-02-30', to: '2026-03-02' }, /from: a day/],
    [{ from: '2026-10-08', to: '2026-10-08' }, /window of 1 to 42 days/],
    [{ from: '2026-09-01', to: '2026-10-14' }, /window of 1 to 42 days/],
    [{ ...w, teacherIds: 'x' }, /teacherIds: uuids/],
    [{ ...w, categories: 'night_shift' }, /categories/],
    [{ ...w, statuses: 'void' }, /statuses/],
    [{ ...w, weekdays: '0' }, /weekdays/],
    [{ ...w, timeFrom: '18:00', timeTo: '12:00' }, /timeTo: after timeFrom/],
    [{ ...w, timeFrom: '24:00' }, /timeFrom: HH:MM/],
    [{ ...w, emptyMinutesGte: '-5' }, /emptyMinutesGte/],
    [{ ...w, onlyMatching: 'yes' }, /onlyMatching/],
    [{ ...w, teacherIds: [A, B] }, /give it once/],
  ])('refuses %j', (q, why) => {
    const r = refusal(() => parseFilters(q as Record<string, string>));
    expect(r).toContain(CommErrorCode.VALIDATION);
    expect(r).toMatch(why);
  });
});

describe('utilization', () => {
  it('is in-shift booked over shift minus leave, and null without a shift', () => {
    expect(utilization({ shiftMinutes: 840, inShiftBookedMinutes: 150, inShiftLeaveMinutes: 420 })).toBe(0.357);
    expect(utilization({ shiftMinutes: 420, inShiftBookedMinutes: 0, inShiftLeaveMinutes: 420 })).toBeNull();
    expect(utilization({ shiftMinutes: 0, inShiftBookedMinutes: 0, inShiftLeaveMinutes: 0 })).toBeNull();
  });
});

describe('shift windows', () => {
  it('the defaults make one window per weekday', () => {
    expect(defaultWindows({ start: '12:00', end: '19:00', weekdays: [6, 7, 1, 2, 3, 4] })).toEqual(
      [6, 7, 1, 2, 3, 4].map((weekday) => ({ weekday, start: 720, end: 1140 })),
    );
  });

  it('a split shift is two windows on one day; overlapping ones are refused', () => {
    expect(parseWindows([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '15:00', end: '24:00' }]))
      .toEqual([{ weekday: 1, start: 540, end: 720 }, { weekday: 1, start: 900, end: 1440 }]);
    expect(refusal(() => parseWindows([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }])))
      .toMatch(/overlap/);
    expect(refusal(() => parseWindows([{ weekday: 8, start: '09:00', end: '12:00' }]))).toMatch(/weekday/);
    expect(refusal(() => parseWindows([{ weekday: 1, start: '12:00', end: '12:00' }]))).toMatch(/end must be after start/);
    expect(refusal(() => parseWindows([]))).toMatch(/1 to 28/);
  });
});

describe('the palette', () => {
  it('matches the database CHECK on chat.staff_calendar_color', () => {
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const path = jest.requireActual<typeof import('node:path')>('node:path');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../../../supabase/migrations/20261026210000_chat_pd038_schedule_calendar.sql'), 'utf8',
    );
    const check = /color_key\s+text not null check \(color_key in \(([^)]*)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const keys = [...(check as RegExpExecArray)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...PALETTE_KEYS]);
  });
});
