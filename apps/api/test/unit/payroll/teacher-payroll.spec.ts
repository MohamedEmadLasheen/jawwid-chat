/**
 * PD-18 payroll, the parts that need no database: sealing payout details, the
 * terms in force in a month, corrections, and the month's arithmetic. The
 * routes, the database rules and who may call them are in
 * test/integration/teacher-payroll.spec.ts.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { openPayout, parsePayoutKeys, sealPayout } from '../../../src/teacher-file/payout-seal';
import { liveAdjustments, monthsEndingAt, payoutDetails, summarize, termsAt } from '../../../src/teacher-file/teacher-payroll.service';

const key = () => randomBytes(32).toString('base64');
const ctx = { organizationId: 'org-1', teacherId: 't-1', method: 'bank_transfer' };

describe('sealing payout details', () => {
  it('round-trips, and the sealed bytes do not contain the account number', () => {
    const ring = parsePayoutKeys(`k1:${key()}`)!;
    const { sealed, keyId } = sealPayout(ring, ctx, { accountNumber: '1234567890123' });
    expect(keyId).toBe('k1');
    expect(sealed.toString('latin1')).not.toContain('1234567890123');
    expect(openPayout(ring, ctx, sealed, keyId)).toEqual({ accountNumber: '1234567890123' });
  });

  it('does not open on another row, another method, an altered byte or an unknown key', () => {
    const ring = parsePayoutKeys(`k1:${key()}`)!;
    const { sealed } = sealPayout(ring, ctx, { accountNumber: '1234' });
    expect(() => openPayout(ring, { ...ctx, teacherId: 't-2' }, sealed, 'k1')).toThrow();
    expect(() => openPayout(ring, { ...ctx, method: 'e_wallet' }, sealed, 'k1')).toThrow();
    const altered = Buffer.from(sealed);
    altered[altered.length - 1] ^= 1;
    expect(() => openPayout(ring, ctx, altered, 'k1')).toThrow();
    expect(() => openPayout(ring, ctx, sealed, 'k0')).toThrow(/not configured/);
  });

  it('rotates: the first key seals, the older keys still open', () => {
    const k1 = key();
    const old = parsePayoutKeys(`k1:${k1}`)!;
    const { sealed } = sealPayout(old, ctx, { accountNumber: '9999' });
    const rotated = parsePayoutKeys(`k2:${key()},k1:${k1}`)!;
    expect(rotated.activeId).toBe('k2');
    expect(openPayout(rotated, ctx, sealed, 'k1')).toEqual({ accountNumber: '9999' });
    expect(sealPayout(rotated, ctx, {}).keyId).toBe('k2');
  });

  it('is off when unset and loud when malformed', () => {
    expect(parsePayoutKeys(undefined)).toBeNull();
    expect(parsePayoutKeys('  ')).toBeNull();
    expect(() => parsePayoutKeys('k1:dG9vLXNob3J0')).toThrow(/32 bytes/);
    expect(() => parsePayoutKeys(key())).toThrow(/keyid:base64key/);
    const k = key();
    expect(() => parsePayoutKeys(`k1:${k},k1:${k}`)).toThrow(/twice/);
  });
});

describe('payout details', () => {
  it('keeps only the fields of the method and shows the last four characters', () => {
    expect(payoutDetails('e_wallet', { provider: 'Vodafone Cash', walletNumber: '01001234567' })).toEqual({
      details: { provider: 'Vodafone Cash', walletNumber: '01001234567' },
      last4: '4567',
    });
    expect(payoutDetails('instapay', { address: 'teacher.one@instapay' }).last4).toBe('apay');
    const bank = payoutDetails('bank_transfer', {
      bankName: 'Bank One',
      accountHolder: 'Teacher One',
      accountNumber: '100200300',
      iban: 'eg38 0019 0005 0000 0000 2631 8000 2',
    });
    expect(bank.details.iban).toBe('EG380019000500000000263180002');
    expect(bank.last4).toBe('0002');
  });

  it('refuses unknown fields, missing fields and wrong shapes, naming the field', () => {
    expect(() => payoutDetails('e_wallet', { provider: 'X Pay', walletNumber: '0100', pin: '1' })).toThrow(/details.pin/);
    expect(() => payoutDetails('e_wallet', { provider: 'X Pay' })).toThrow(/details.walletNumber: is required/);
    expect(() => payoutDetails('e_wallet', { provider: 'X Pay', walletNumber: 'abc' })).toThrow(/details.walletNumber/);
    expect(() => payoutDetails('bank_transfer', { bankName: 'B', accountHolder: 'Teacher', accountNumber: '1234' })).toThrow(/details.bankName/);
    expect(() => payoutDetails('instapay', null)).toThrow(/details: is required/);
  });
});

const d = (v: string) => new Prisma.Decimal(v);
const terms = (effective: string, createdAt: string, over: Record<string, unknown> = {}) =>
  ({
    id: `${effective}-${createdAt}`,
    organizationId: 'org-1',
    teacherId: 't-1',
    effectiveMonth: new Date(`${effective}-01T00:00:00Z`),
    salaryType: 'shift',
    currency: 'EGP',
    monthlyAmount: d('6000'),
    hourlyRate: null,
    reason: 'set',
    createdBy: 's-1',
    createdAt: new Date(createdAt),
    ...over,
  }) as Parameters<typeof termsAt>[0][number];
const adj = (id: string, kind: string, month: string, amount: string, replaces: string | null = null) =>
  ({
    id,
    organizationId: 'org-1',
    teacherId: 't-1',
    kind,
    month: new Date(`${month}-01T00:00:00Z`),
    amount: d(amount),
    currency: 'EGP',
    reason: 'r',
    bonusEntryId: null,
    violationId: null,
    replaces,
    createdBy: 's-1',
    createdAt: new Date('2026-10-01T00:00:00Z'),
  }) as Parameters<typeof liveAdjustments>[0][number];

describe('the month', () => {
  it('uses the latest terms effective by that month, and the newest version of them', () => {
    const rows = [
      terms('2026-08', '2026-08-01T00:00:00Z'),
      terms('2026-10', '2026-10-01T00:00:00Z', { monthlyAmount: d('7000') }),
      terms('2026-10', '2026-10-02T00:00:00Z', { monthlyAmount: d('7500') }),
    ];
    expect(termsAt(rows, '2026-07')).toBeNull();
    expect(String(termsAt(rows, '2026-09')?.monthlyAmount)).toBe('6000');
    expect(String(termsAt(rows, '2026-11')?.monthlyAmount)).toBe('7500');
  });

  it('a correction replaces the amount it corrects, and zero cancels it', () => {
    const rows = [adj('a', 'bonus', '2026-10', '500'), adj('b', 'bonus', '2026-10', '300', 'a'), adj('c', 'deduction', '2026-10', '200'), adj('e', 'deduction', '2026-10', '0', 'c')];
    expect(liveAdjustments(rows).map((r) => r.id)).toEqual(['b', 'e']);
  });

  it('shift: fixed amount + bonuses - deductions, to the piastre', () => {
    const live = [adj('a', 'bonus', '2026-10', '250.10'), adj('b', 'deduction', '2026-10', '100.05'), adj('x', 'bonus', '2026-09', '999')];
    expect(summarize('2026-10', terms('2026-01', '2026-01-01T00:00:00Z', { monthlyAmount: d('6000.00') }), live, 0)).toMatchObject({
      currency: 'EGP',
      base: '6000.00',
      bonuses: '250.10',
      deductions: '100.05',
      net: '6150.05',
    });
  });

  it('hourly: the rate times the hours of the lessons the teacher was paid for', () => {
    const hourly = terms('2026-01', '2026-01-01T00:00:00Z', { salaryType: 'hourly', monthlyAmount: null, hourlyRate: d('150.00') });
    expect(summarize('2026-10', hourly, [], 90)).toMatchObject({ base: '225.00', net: '225.00', paidMinutes: 90 });
    // A deduction larger than the month leaves a negative net, shown as it is.
    expect(summarize('2026-10', hourly, [adj('a', 'deduction', '2026-10', '300')], 60).net).toBe('-150.00');
  });

  it('without terms there is no base and no net, never a zero', () => {
    expect(summarize('2026-10', null, [adj('a', 'bonus', '2026-10', '50')], 0)).toMatchObject({ base: null, net: null, bonuses: '50.00' });
  });

  it('lists months backwards across a year', () => {
    expect(monthsEndingAt('2026-02', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
});
