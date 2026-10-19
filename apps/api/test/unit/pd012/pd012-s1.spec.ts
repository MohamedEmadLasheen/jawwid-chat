/**
 * PD-12 S1, the pure parts: the access matrix, the certificate file sniffer, the
 * calendar-date helpers leave depends on, and the cards' plain-text bodies.
 */
import { decidePd012StaffAccess, canRequestCertificate, isLiveTeacher } from '@platform/pd012-policy';
import type { Actor } from '@platform/types';
import { sniffCertificateFile } from '../../../src/certificates/certificate-file';
import { daysBetween, todayIn } from '../../../src/leave/leave.service';
import { renderPd012CardBody } from '../../../src/supervision/pd012-cards';

const ORG = '11111111-1111-1111-1111-111111111111';

function staff(role: string, over: Partial<Actor> = {}): Actor {
  return { actorId: 's', kind: 'staff', displayName: 's', locale: 'ar', isActive: true, staffRole: role as never, organizationId: ORG, ...over };
}
function teacher(over: Partial<Actor> = {}): Actor {
  return { actorId: 't', kind: 'teacher', displayName: 't', locale: 'ar', isActive: true, organizationId: ORG, ...over };
}

describe('the PD-12 access matrix', () => {
  it.each`
    role             | dept         | supervise | allowance
    ${'super_admin'} | ${null}      | ${true}   | ${true}
    ${'manager'}     | ${'manager'} | ${true}   | ${true}
    ${'admin'}       | ${'member'}  | ${true}   | ${false}
    ${'coverage'}    | ${'member'}  | ${true}   | ${false}
    ${'manager'}     | ${null}      | ${false}  | ${false}
    ${'admin'}       | ${null}      | ${false}  | ${false}
    ${'manager'}     | ${'member'}  | ${false}  | ${false}
    ${'admin'}       | ${'manager'} | ${false}  | ${false}
    ${'finance'}     | ${'member'}  | ${false}  | ${false}
  `('$role in the Teachers department as $dept: supervise $supervise, allowance $allowance', ({ role, dept, supervise, allowance }) => {
    expect(decidePd012StaffAccess(staff(role), dept)).toEqual({ canSupervise: supervise, canSetAllowance: allowance });
  });

  it('an inactive or org-less staff member, a teacher and a contact get nothing', () => {
    expect(decidePd012StaffAccess(staff('super_admin', { isActive: false }), null).canSupervise).toBe(false);
    expect(decidePd012StaffAccess(staff('manager', { organizationId: undefined }), 'manager').canSupervise).toBe(false);
    expect(decidePd012StaffAccess(teacher(), 'member').canSupervise).toBe(false);
    expect(decidePd012StaffAccess({ ...teacher(), kind: 'contact' }, 'member').canSupervise).toBe(false);
  });

  it('a teacher requests a certificate only for a learner they teach, in their organization', () => {
    expect(canRequestCertificate(teacher(), { organizationId: ORG, teacherId: 't' })).toBe(true);
    expect(canRequestCertificate(teacher(), { organizationId: ORG, teacherId: 'other' })).toBe(false);
    expect(canRequestCertificate(teacher(), { organizationId: 'elsewhere', teacherId: 't' })).toBe(false);
    expect(canRequestCertificate(teacher(), null)).toBe(false);
    expect(canRequestCertificate(teacher({ isActive: false }), { organizationId: ORG, teacherId: 't' })).toBe(false);
    expect(canRequestCertificate(staff('super_admin', { actorId: 't' }), { organizationId: ORG, teacherId: 't' })).toBe(false);
    expect(isLiveTeacher(teacher())).toBe(true);
  });
});

describe('a certificate file is what its bytes say', () => {
  it.each`
    name      | bytes                                                                                   | mime
    ${'pdf'}  | ${Buffer.from('%PDF-1.7')}                                                              | ${'application/pdf'}
    ${'jpeg'} | ${Buffer.from([0xff, 0xd8, 0xff, 0xe0])}                                                 | ${'image/jpeg'}
    ${'png'}  | ${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])}                         | ${'image/png'}
    ${'webp'} | ${Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])}            | ${'image/webp'}
    ${'html'} | ${Buffer.from('<html><body>')}                                                          | ${null}
    ${'zip'}  | ${Buffer.from([0x50, 0x4b, 0x03, 0x04])}                                                 | ${null}
    ${'cut'}  | ${Buffer.from('%PD')}                                                                   | ${null}
  `('$name -> $mime', ({ bytes, mime }) => {
    expect(sniffCertificateFile(bytes)).toBe(mime);
  });
});

describe('leave counts calendar days', () => {
  it('inclusive ranges, across month and leap-day boundaries', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(daysBetween('2027-02-28', '2027-03-01')).toEqual(['2027-02-28', '2027-03-01']);
    expect(daysBetween('2027-05-01', '2027-05-01')).toEqual(['2027-05-01']);
  });

  it('"today" is the academy\'s day, not the server\'s', () => {
    const lateNightUtc = new Date('2027-03-09T23:30:00Z');
    expect(todayIn('UTC', lateNightUtc)).toBe('2027-03-09');
    expect(todayIn('Africa/Cairo', lateNightUtc)).toBe('2027-03-10');
  });
});

describe('card bodies', () => {
  it('say what was recorded, in the reader\'s language, naming only the learner', () => {
    const p = { learnerName: 'learner_l', title: 'Juz Amma', achievement: 'memorized', grade: 'A', printedName: 'learner_l' };
    expect(renderPd012CardBody('certificate_issued', p, 'en')).toContain("learner_l's certificate");
    expect(renderPd012CardBody('certificate_issued', p, 'ar')).toContain('شهادة learner_l');
    const leave = { firstDay: '2027-03-10', lastDay: '2027-03-12', days: 3, reason: 'wedding', balance: 18 };
    expect(renderPd012CardBody('leave_requested', leave, 'en')).toBe(
      '🌴 Leave request: 2027-03-10 → 2027-03-12\nDays: 3\nReason: wedding\nBalance before this request: 18',
    );
    expect(renderPd012CardBody('leave_requested', { ...leave, lastDay: '2027-03-10', balance: null }, 'en')).not.toContain('Balance');
    expect(renderPd012CardBody('something_new', {}, 'en')).toBe('Update');
  });
});
