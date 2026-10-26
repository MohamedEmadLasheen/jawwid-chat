/**
 * PD-26 amendment (2026-10-26): two of the page's "Known limits", the parts
 * that need no database. The routes end to end are in
 * test/integration/pd026-teacher-supervision.spec.ts (CI's G-19).
 *
 *   1. A staff complaint names its source, on EVERY route that writes one --
 *      the Teacher File's and PD-11's supervision timeline alike.
 *   2. A reward with an amount is one act: nothing is written without pay
 *      terms for the month, and the bonus and its amount share one transaction.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { staffComplaintSource } from '../../../src/supervision/complaint-source';
import { TeacherPayrollService } from '../../../src/teacher-file/teacher-payroll.service';

describe('a staff complaint names its source', () => {
  it.each(['management', 'parent'])('accepts %s', (source) => {
    expect(staffComplaintSource({ source })).toBe(source);
  });

  it.each([
    [{}],
    [{ source: null }],
    [{ source: '' }],
    [{ source: 'student' }],
    // The parent's own form writes this one (PD-32); staff never do.
    [{ source: 'parent_app' }],
    [{ source: 7 }],
  ])('refuses %j with a 400 naming the field', (body) => {
    const err = (() => {
      try {
        staffComplaintSource(body as Record<string, unknown>);
      } catch (e) {
        return e;
      }
      throw new Error('expected a refusal');
    })() as CommError;
    expect(err).toBeInstanceOf(CommError);
    expect([err.code, err.status]).toEqual([CommErrorCode.VALIDATION, 400]);
    expect(err.message).toMatch(/^source: /);
  });
});

describe('a reward with an amount is one act', () => {
  const ORG = 'o-1';
  const teacher = { id: 't-1', organizationId: ORG, name: 'teacher_c' };

  function build(terms: Array<Record<string, unknown>>) {
    const writes: string[] = [];
    const tx = {
      teacherPayAdjustment: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          writes.push('amount');
          return { id: 'a-1', month: new Date('2026-10-01T00:00:00Z'), amount: '250', currency: 'EGP', ...args.data };
        }),
      },
    };
    const prisma = {
      teacherPayTerms: { findMany: jest.fn(async () => terms) },
      $queryRaw: jest.fn(async () => [{ m: '2026-10' }]),
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const files = {
      gate: jest.fn(async () => ({ actor: { actorId: 's-root', organizationId: ORG, kind: 'staff' }, access: { canViewFinance: true } })),
      requireTeacher: jest.fn(async () => teacher),
    };
    const audit = { audit: jest.fn(async () => undefined) };
    const supervision = {
      bonusInTx: jest.fn(async (t: unknown) => {
        expect(t).toBe(tx); // the bonus is written in the SAME transaction as its amount
        writes.push('bonus');
        return { entry: { id: 'b-1', kind: 'bonus' }, conversationId: 'c-1' };
      }),
      requireSupervisedTeacher: jest.fn(async () => teacher),
    };
    const service = new TeacherPayrollService(prisma as never, files as never, audit as never, supervision as never);
    return { service, prisma, supervision, tx, writes };
  }

  const terms = [{ effectiveMonth: new Date('2026-01-01T00:00:00Z'), createdAt: new Date(), salaryType: 'shift', currency: 'EGP', monthlyAmount: '9000', hourlyRate: null, reason: 'x' }];

  it('without pay terms for the month, refuses before writing anything', async () => {
    const { service, prisma, supervision } = build([]);
    await expect(service.recordReward('s-root', 't-1', { reason: 'Great month', amount: '250' })).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_FILE_CONFLICT,
      message: expect.stringMatching(/pay terms for 2026-10/),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(supervision.bonusInTx).not.toHaveBeenCalled();
  });

  it('writes the bonus, then its amount, in one transaction, and prices the bonus it just wrote', async () => {
    const { service, prisma, tx, writes } = build(terms);
    const out = await service.recordReward('s-root', 't-1', { reason: 'Great month', amount: '250' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(['bonus', 'amount']);
    expect(tx.teacherPayAdjustment.create.mock.calls[0][0].data).toMatchObject({
      kind: 'bonus', bonusEntryId: 'b-1', amount: '250', currency: 'EGP', reason: 'Great month', createdBy: 's-root',
    });
    expect(out).toMatchObject({ id: 'b-1', amount: { amount: '250.00', currency: 'EGP', month: '2026-10' } });
  });

  it('an amount that is not money is refused before anything is written', async () => {
    const { service, prisma } = build(terms);
    await expect(service.recordReward('s-root', 't-1', { reason: 'x', amount: '-5' })).rejects.toMatchObject({ code: CommErrorCode.VALIDATION });
    await expect(service.recordReward('s-root', 't-1', { reason: '', amount: '5' })).rejects.toMatchObject({ code: CommErrorCode.VALIDATION });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
