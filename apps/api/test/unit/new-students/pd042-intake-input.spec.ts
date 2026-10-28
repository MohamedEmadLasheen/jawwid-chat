/**
 * PD-42 -- what a supervisor types to enter a family, validated: three
 * required fields, nothing invented or adjusted, numbers keyed in E.164,
 * e-mails in lower case, the same child twice refused; the names compared for
 * duplicates; and the database's refusals answered in words.
 */
import { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from '@platform/errors';
import { foldName, parseAddChildren, parseCarriedOver, parseIntake, parseSignInEmail } from '../../../src/new-students/intake-input';
import { dbRefusal } from '../../../src/new-students/intake.service';
import { salesFamilyScopeFromEnv } from '../../../src/platform/sales-scope';

const ID = '7f2b8c1e-4d3a-4b5c-9e6f-0a1b2c3d4e5f';
const TEACHER = '1e2d3c4b-5a69-4788-9a0b-c1d2e3f4a5b6';

function invalid(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CommError);
    expect((e as CommError).code).toBe(CommErrorCode.INTAKE_INVALID);
    return (e as CommError).message;
  }
  throw new Error('expected INTAKE_INVALID');
}

describe('PD-42 -- parseIntake', () => {
  const minimal = { intakeId: ID, parent: { name: ' Parent ', phone: '010 0123 4567' }, children: [{ name: 'Child' }] };

  it('needs only the parent\'s name, a phone or an e-mail, and each child\'s name', () => {
    const r = parseIntake(minimal);
    expect(r).toMatchObject({
      intakeId: ID,
      parent: { name: 'Parent', email: null, phone: '010 0123 4567', phoneE164: '+201001234567' },
      children: [{ name: 'Child', teacherId: null, course: null, age: null, birthDate: null, schedule: [], durationMinutes: 30, carriedOver: null }],
      payment: { method: null, currency: null },
      onBehalfOf: null,
      confirmOver: false,
    });
    expect(parseIntake({ ...minimal, parent: { name: 'P', email: ' Parent@Example.TEST ' } }).parent).toMatchObject({ email: 'parent@example.test', phone: null, phoneE164: null });
  });

  it('refuses each missing required field', () => {
    expect(invalid(() => parseIntake({ ...minimal, parent: { name: 'P' } }))).toMatch(/phone number or an e-mail/);
    expect(invalid(() => parseIntake({ ...minimal, parent: { phone: '01001234567' } }))).toMatch(/parent\.name/);
    expect(invalid(() => parseIntake({ ...minimal, children: [] }))).toMatch(/children/);
    expect(invalid(() => parseIntake({ ...minimal, children: [{ name: ' ' }] }))).toMatch(/children\[0\]\.name/);
    expect(invalid(() => parseIntake({ ...minimal, intakeId: 'x' }))).toMatch(/intakeId/);
  });

  it('keys a number in E.164 from the country given, or Egypt by default; refuses one it cannot read', () => {
    expect(parseIntake({ ...minimal, parent: { name: 'P', phone: '+971 50 123 4567' } }).parent.phoneE164).toBe('+971501234567');
    expect(parseIntake({ ...minimal, parent: { name: 'P', phone: '050 123 4567', country: 'ae' } }).parent.phoneE164).toBe('+971501234567');
    expect(invalid(() => parseIntake({ ...minimal, parent: { name: 'P', phone: '12' } }))).toMatch(/parent\.phone/);
  });

  it('refuses rather than adjusts: the same child twice, weekly times without a teacher, a future birth date, an unknown payment method', () => {
    expect(invalid(() => parseIntake({ ...minimal, children: [{ name: 'أحمد' }, { name: 'احمد' }] }))).toMatch(/listed twice/);
    expect(invalid(() => parseIntake({ ...minimal, children: [{ name: 'C', schedule: [{ weekday: 1, time: '17:00' }] }] }))).toMatch(/need the child's teacher/);
    expect(invalid(() => parseIntake({ ...minimal, children: [{ name: 'C', birthDate: '2999-01-01' }] }))).toMatch(/birthDate/);
    expect(invalid(() => parseIntake({ ...minimal, children: [{ name: 'C', birthDate: '2020-02-30' }] }))).toMatch(/birthDate/);
    expect(invalid(() => parseIntake({ ...minimal, payment: { method: 'cash' } }))).toMatch(/payment\.method/);
    const ok = parseIntake({ ...minimal, children: [{ name: 'C', teacherId: TEACHER, schedule: [{ weekday: 1, time: '17:00' }], durationMinutes: 45 }] });
    expect(ok.children[0]).toMatchObject({ teacherId: TEACHER, durationMinutes: 45, schedule: [{ weekday: 1, time: '17:00' }] });
  });

  it('a carried-over package is taken exactly as entered: completed may exceed the total (F1), plan length 1..24 (F3)', () => {
    expect(parseCarriedOver({ total: 20, completed: 12 })).toEqual({ total: 20, completed: 12, planMonths: null });
    expect(parseCarriedOver({ total: '20', completed: '21', planMonths: '2' })).toEqual({ total: 20, completed: 21, planMonths: 2 });
    expect(invalid(() => parseCarriedOver({ total: 0, completed: 0 }))).toMatch(/total/);
    expect(invalid(() => parseCarriedOver({ total: 20, completed: -1 }))).toMatch(/completed/);
    expect(invalid(() => parseCarriedOver({ total: 20.5, completed: 1 }))).toMatch(/total/);
    expect(invalid(() => parseCarriedOver({ total: 20, completed: 1, planMonths: 25 }))).toMatch(/planMonths/);
  });

  it('Add child and the sign-in e-mail', () => {
    expect(parseAddChildren({ intakeId: ID, children: [{ name: 'C' }], confirmDuplicate: true })).toMatchObject({ confirmDuplicate: true });
    expect(parseSignInEmail({ email: ' A@B.TEST ' })).toBe('a@b.test');
    expect(invalid(() => parseSignInEmail({}))).toMatch(/email/);
  });
});

describe('PD-42 -- foldName', () => {
  it('folds the spellings one family\'s name is typed with', () => {
    expect(foldName('  أحمد  ')).toBe(foldName('احمد'));
    expect(foldName('إيمان')).toBe(foldName('ايمان'));
    expect(foldName('ســـلوى')).toBe(foldName('سلوى'));
    expect(foldName('هدى')).toBe(foldName('هدي'));
    expect(foldName('فاطمة')).toBe(foldName('فاطمه'));
    expect(foldName('مُحَمَّد')).toBe(foldName('محمد'));
    expect(foldName('Omar  Ali')).toBe('omar ali');
    expect(foldName('عمر')).not.toBe(foldName('عامر'));
  });
});

describe('PD-42 -- the database\'s refusals, in words', () => {
  const pg = (code: string, message: string) =>
    new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'x', meta: { code, message: `ERROR: ${message}` } });

  it('maps each guard to its answer, and leaves anything else alone', () => {
    expect(dbRefusal(pg('23514', 'this parent is already in Chat'))).toMatchObject({ code: CommErrorCode.PARENT_EXISTS });
    expect(dbRefusal(pg('42501', 'a carried-over package is entered by the supervisor who entered the child'))).toMatchObject({
      code: CommErrorCode.INTAKE_DENIED, message: 'a carried-over package is entered by the supervisor who entered the child',
    });
    expect(dbRefusal(pg('23514', 'a carried-over package is only for a child with no other package'))).toMatchObject({ code: CommErrorCode.INTAKE_INVALID, status: 400 });
    expect(dbRefusal(pg('23505', 'duplicate key'))).toMatchObject({ code: CommErrorCode.INTAKE_STATE, status: 409 });
    const other = new Error('boom');
    expect(dbRefusal(other)).toBe(other);
  });
});

describe('PD-42 -- SALES_FAMILY_SCOPE', () => {
  const saved = process.env.SALES_FAMILY_SCOPE;
  afterEach(() => {
    if (saved === undefined) delete process.env.SALES_FAMILY_SCOPE;
    else process.env.SALES_FAMILY_SCOPE = saved;
  });

  it('unset writes nothing; "own" (any case) narrows; anything else is "all"', () => {
    delete process.env.SALES_FAMILY_SCOPE;
    expect(salesFamilyScopeFromEnv()).toBeNull();
    process.env.SALES_FAMILY_SCOPE = '  OWN ';
    expect(salesFamilyScopeFromEnv()).toBe('own');
    process.env.SALES_FAMILY_SCOPE = 'all';
    expect(salesFamilyScopeFromEnv()).toBe('all');
    process.env.SALES_FAMILY_SCOPE = 'true';
    expect(salesFamilyScopeFromEnv()).toBe('all');
  });
});
