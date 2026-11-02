/**
 * PD-52, review of #369: a write on the pages needs the key of what it writes,
 * not just any key the route admits.
 */
import { entryKeyAllows, feedbackKeyAllows } from '@platform/teacher-records-policy';

const keys = (...k: string[]) => new Set(k);

describe('PD-52: entries need the key of their kind', () => {
  it('a complaint and a follow-up are recorded; a resolution is decided', () => {
    expect(entryKeyAllows('complaint', keys('teacher_attendance.record'))).toBe(true);
    expect(entryKeyAllows('complaint_followup', keys('teacher_attendance.record'))).toBe(true);
    expect(entryKeyAllows('complaint_resolution', keys('teacher_attendance.record'))).toBe(false);
    expect(entryKeyAllows('complaint_resolution', keys('teacher_attendance.decide'))).toBe(true);
    expect(entryKeyAllows('complaint', keys('teacher_attendance.decide'))).toBe(false);
    expect(entryKeyAllows('complaint', keys('teacher_grants.record'))).toBe(false);
  });

  it('the old key still counts, for one release', () => {
    for (const kind of ['complaint', 'complaint_followup', 'complaint_resolution', 'monthly_comment']) {
      expect(entryKeyAllows(kind, keys('teacher_supervision.record'))).toBe(true);
    }
  });
});

describe('PD-52: parent feedback by page', () => {
  it('praise is page B\'s; a complaint or a suggestion page A\'s', () => {
    expect(feedbackKeyAllows('praise', 'read', keys('teacher_grants.view'))).toBe(true);
    expect(feedbackKeyAllows('complaint', 'read', keys('teacher_grants.view'))).toBe(false);
    expect(feedbackKeyAllows('suggestion', 'read', keys('teacher_grants.view'))).toBe(false);
    expect(feedbackKeyAllows('complaint', 'read', keys('teacher_attendance.view'))).toBe(true);
    expect(feedbackKeyAllows('praise', 'read', keys('teacher_attendance.view'))).toBe(false);
  });

  it('Sales-like grants.record never takes or replies to a complaint', () => {
    expect(feedbackKeyAllows('complaint', 'write', keys('teacher_grants.view', 'teacher_grants.record'))).toBe(false);
    expect(feedbackKeyAllows('suggestion', 'write', keys('teacher_grants.record'))).toBe(false);
    expect(feedbackKeyAllows('praise', 'write', keys('teacher_grants.record'))).toBe(true);
    expect(feedbackKeyAllows('complaint', 'write', keys('teacher_attendance.record'))).toBe(false);
    expect(feedbackKeyAllows('complaint', 'write', keys('teacher_attendance.decide'))).toBe(true);
  });

  it('the old keys still count, for one release', () => {
    expect(feedbackKeyAllows('complaint', 'read', keys('teacher_supervision.view'))).toBe(true);
    expect(feedbackKeyAllows('complaint', 'write', keys('teacher_supervision.record'))).toBe(true);
  });
});
