/**
 * PD-52 PR-2, the pure parts: who a testimonial or grant is about (for
 * pageRowVisible), a void in the complaint timeline, and the month filter.
 */
import type { Prisma } from '@prisma/client';
import { pageRowVisible, type PageScope } from '@platform/teacher-scope';
import { aboutOf, monthRange } from '../../../src/teacher-file/teacher-records.service';
import { shapeTimeline } from '../../../src/teacher-file/teacher-file.service';
import { complaintAbout } from '../../../src/teacher-file/complaint-family';

type Entry = Prisma.TeacherSupervisionEntryGetPayload<object>;

const opsOnly: PageScope = {
  teachers: { all: false, teacherIds: new Set(['t1']) },
  whole: { all: false, teacherIds: new Set() },
  learnerIds: new Set(['l-mine']),
  familyIds: new Set(['f-mine']),
};

const entry = (over: Partial<Entry>): Entry =>
  ({
    id: 'e1',
    organizationId: 'o',
    teacherId: 't1',
    kind: 'complaint',
    body: 'b',
    period: null,
    conversationId: null,
    createdBy: 's1',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    refersTo: null,
    sourceMessageId: null,
    complaintSource: 'management',
    handledBy: null,
    parentFeedbackId: null,
    testimonialSource: null,
    learnerId: null,
    familyId: null,
    trialProspectId: null,
    ...over,
  }) as Entry;

describe('PD-52: what a record is about', () => {
  it('a student, else a family, else a trial family (nobody\'s), else the teacher', () => {
    expect(aboutOf({ learnerId: 'l', familyId: 'f', trialProspectId: null })).toEqual({ learnerId: 'l', familyId: 'f' });
    expect(aboutOf({ learnerId: null, familyId: 'f', trialProspectId: null })).toEqual({ familyId: 'f' });
    expect(aboutOf({ learnerId: null, familyId: null, trialProspectId: 'p' })).toEqual({ learnerId: null });
    expect(aboutOf({ learnerId: null, familyId: null, trialProspectId: null })).toBeNull();
  });

  it('Operations sees its own child\'s rows and teacher-level rows, never another family\'s or a trial\'s', () => {
    const seen = (r: Parameters<typeof aboutOf>[0]) => pageRowVisible(opsOnly, 't1', aboutOf(r));
    expect(seen({ learnerId: 'l-mine', familyId: 'f-mine', trialProspectId: null })).toBe(true);
    expect(seen({ learnerId: 'l-other', familyId: 'f-other', trialProspectId: null })).toBe(false);
    expect(seen({ learnerId: null, familyId: 'f-other', trialProspectId: null })).toBe(false);
    expect(seen({ learnerId: null, familyId: null, trialProspectId: 'p' })).toBe(false);
    expect(seen({ learnerId: null, familyId: null, trialProspectId: null })).toBe(true);
  });

  it('a management complaint that names a family is about that family (before PD-52 it was teacher-level)', () => {
    const named = { id: 'c', complaintSource: 'management', learnerId: null, familyId: 'f-other' };
    expect(complaintAbout(named, new Map())).toEqual({ familyId: 'f-other' });
    expect(pageRowVisible(opsOnly, 't1', complaintAbout(named, new Map()))).toBe(false);
    expect(complaintAbout({ id: 'c', complaintSource: 'management' }, new Map())).toBeNull();
  });
});

describe('PD-52: a void in the complaint timeline', () => {
  it('is the complaint\'s correction, never one of its follow-ups', () => {
    const complaint = entry({ id: 'c1' });
    const followUp = entry({ id: 'f1', kind: 'complaint_followup', refersTo: 'c1', complaintSource: null });
    const voided = entry({ id: 'v1', kind: 'entry_void', refersTo: 'c1', body: 'duplicate', complaintSource: null });
    const [c] = shapeTimeline([voided, followUp, complaint], [], (id) => ({ id, name: id })).complaints;
    expect(c?.followUps.map((f) => f.id)).toEqual(['f1']);
    expect(c?.voided).toMatchObject({ id: 'v1', body: 'duplicate' });
    expect(shapeTimeline([complaint], [], (id) => ({ id, name: id })).complaints[0]?.voided).toBeNull();
  });
});

describe('PD-52: the month filter', () => {
  it('YYYY-MM is [first day, next first day); nothing is everything; anything else is refused', () => {
    expect(monthRange('2026-12')).toEqual({ from: new Date('2026-12-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') });
    expect(monthRange(undefined)).toEqual({});
    expect(() => monthRange('2026-13')).toThrow(/YYYY-MM/);
    expect(() => monthRange('Nov')).toThrow(/YYYY-MM/);
  });
});
