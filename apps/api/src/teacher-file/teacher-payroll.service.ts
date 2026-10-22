import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { isUuid } from '../communication/conversations/conversation.service';
import { TeacherFileService, mapTimelineRefusal } from './teacher-file.service';
import { openPayout, parsePayoutKeys, sealPayout, type PayoutKeyring } from './payout-seal';

/**
 * PD-18 (closed 2026-10-21): teacher payroll lives in Chat. The super admin
 * only -- PD-10's finance tier -- so every route here passes
 * `canViewFinance` before the teacher is even looked up.
 *
 *   pay terms        salary type, currency, amount; one version per effective
 *                    month, append-only
 *   payout account   method + sealed details (payout-seal.ts); reading the
 *                    details is a separate, audited, reasoned act
 *   adjustments      the amount of a bonus (PD-11's bonus entry) or deduction
 *                    (PD-12's deduction decision), or a standalone one;
 *                    append-only, a correction replaces a row
 *   summary          computed on every read: base + bonuses - deductions
 *
 * Amounts travel as strings ("1500.00") and are computed in integer piastres
 * (hundredths), never in floating point. The audit trail is read more widely
 * than payroll is, so audit rows name what changed, never an amount or an
 * account detail.
 */

export const SalaryType = { SHIFT: 'shift', HOURLY: 'hourly' } as const;
export const PayoutMethod = { E_WALLET: 'e_wallet', INSTAPAY: 'instapay', BANK_TRANSFER: 'bank_transfer' } as const;
type PayoutMethod = (typeof PayoutMethod)[keyof typeof PayoutMethod];
const METHODS: ReadonlySet<string> = new Set(Object.values(PayoutMethod));

/** Lessons the teacher is paid for on an hourly salary: they were there (PD-18 default). */
export const PAID_OUTCOMES = ['held', 'student_no_show'] as const;
/** Months the summary shows, ending at the month asked for. */
const SUMMARY_MONTHS = 6;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;

type Terms = Prisma.TeacherPayTermsGetPayload<object>;
type Adjustment = Prisma.TeacherPayAdjustmentGetPayload<object>;

@Injectable()
export class TeacherPayrollService {
  private readonly keyring: PayoutKeyring | null = parsePayoutKeys(process.env.TEACHER_PAYOUT_KEYS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: TeacherFileService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  async finance(actorId: string, teacherId: string, month?: unknown) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const until = month === undefined || month === '' ? await this.currentMonth() : requireMonth('month', month);

    const [terms, adjustments, account, bonusEntries, deductions] = await Promise.all([
      this.prisma.teacherPayTerms.findMany({
        where: { teacherId: teacher.id },
        orderBy: [{ effectiveMonth: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.teacherPayAdjustment.findMany({ where: { teacherId: teacher.id }, orderBy: [{ createdAt: 'desc' }] }),
      this.prisma.teacherPayoutAccount.findUnique({ where: { teacherId: teacher.id } }),
      this.prisma.teacherSupervisionEntry.findMany({ where: { teacherId: teacher.id, kind: 'bonus' }, select: { id: true } }),
      this.prisma.teacherViolation.findMany({
        where: { teacherId: teacher.id, decision: { in: ['deduction_1', 'deduction_2'] } },
        select: { id: true },
      }),
    ]);

    const months = monthsEndingAt(until, SUMMARY_MONTHS);
    const paidMinutes = await this.paidMinutes(teacher.id, months[months.length - 1], until);
    const live = liveAdjustments(adjustments);
    const staff = await this.names([...terms.map((t) => t.createdBy), ...adjustments.map((a) => a.createdBy), ...(account ? [account.updatedBy] : [])]);
    const person = (id: string) => ({ id, name: staff.get(id) ?? '' });
    const pricedBonus = new Set(live.map((a) => a.bonusEntryId).filter(Boolean));
    const pricedViolation = new Set(live.map((a) => a.violationId).filter(Boolean));

    return {
      month: until,
      keyConfigured: this.keyring !== null,
      terms: terms.map((t) => ({ ...termsDto(t), createdBy: person(t.createdBy), createdAt: t.createdAt })),
      currentTerms: termsAt(terms, until) ? termsDto(termsAt(terms, until) as Terms) : null,
      payoutAccount: account
        ? { method: account.method, last4: account.last4, updatedAt: account.updatedAt, updatedBy: person(account.updatedBy) }
        : null,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        kind: a.kind,
        month: ym(a.month),
        amount: money(a.amount),
        currency: a.currency,
        reason: a.reason,
        bonusEntryId: a.bonusEntryId,
        violationId: a.violationId,
        replaces: a.replaces,
        live: live.includes(a),
        createdBy: person(a.createdBy),
        createdAt: a.createdAt,
      })),
      unpriced: {
        bonusEntryIds: bonusEntries.map((e) => e.id).filter((id) => !pricedBonus.has(id)),
        violationIds: deductions.map((v) => v.id).filter((id) => !pricedViolation.has(id)),
      },
      summary: months.map((m) => summarize(m, termsAt(terms, m), live, paidMinutes.get(m) ?? 0)),
    };
  }

  // ------------------------------------------------------------------
  // Writing
  // ------------------------------------------------------------------

  async setTerms(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const teacher = await this.files.requireTeacher(actor, teacherId);

    const effectiveMonth = requireMonth('effectiveMonth', body.effectiveMonth);
    const salaryType = body.salaryType;
    if (salaryType !== SalaryType.SHIFT && salaryType !== SalaryType.HOURLY) throw invalid('salaryType', 'must be shift or hourly');
    const currency = requireCurrency(body.currency);
    const amountField = salaryType === SalaryType.SHIFT ? 'monthlyAmount' : 'hourlyRate';
    const otherField = salaryType === SalaryType.SHIFT ? 'hourlyRate' : 'monthlyAmount';
    if (body[otherField] !== undefined && body[otherField] !== null) throw invalid(otherField, `is not used by a ${salaryType} salary`);
    const amount = requireMoney(amountField, body[amountField], false);
    const reason = requireText('reason', body.reason, 500);

    const row = await this.write(async (tx) => {
      const created = await tx.teacherPayTerms.create({
        data: {
          organizationId: teacher.organizationId,
          teacherId: teacher.id,
          effectiveMonth: monthDate(effectiveMonth),
          salaryType,
          currency,
          monthlyAmount: salaryType === SalaryType.SHIFT ? amount : null,
          hourlyRate: salaryType === SalaryType.HOURLY ? amount : null,
          reason,
          createdBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.pay_terms_set',
        entity: 'teacher',
        entityId: teacher.id,
        after: { termsId: created.id, effectiveMonth, salaryType, currency },
        reason,
      });
      return created;
    });
    return { id: row.id, ...termsDto(row) };
  }

  async setPayoutAccount(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const ring = this.requireKeyring();

    if (typeof body.method !== 'string' || !METHODS.has(body.method)) {
      throw invalid('method', `must be one of ${[...METHODS].join(', ')}`);
    }
    const method = body.method as PayoutMethod;
    const { details, last4 } = payoutDetails(method, body.details);
    const reason = requireText('reason', body.reason, 500);
    const { sealed, keyId } = sealPayout(ring, { organizationId: teacher.organizationId, teacherId: teacher.id, method }, details);

    await this.write(async (tx) => {
      const before = await tx.teacherPayoutAccount.findUnique({ where: { teacherId: teacher.id }, select: { method: true } });
      const data = { method, detailsSealed: new Uint8Array(sealed), keyId, last4, updatedBy: actor.actorId };
      await tx.teacherPayoutAccount.upsert({
        where: { teacherId: teacher.id },
        create: { teacherId: teacher.id, organizationId: teacher.organizationId, ...data },
        update: data,
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.payout_account_set',
        entity: 'teacher',
        entityId: teacher.id,
        before: before ? { method: before.method } : undefined,
        after: { method },
        reason,
      });
    });
    return { method, last4 };
  }

  /** The account details in clear, for the person about to pay. Every reveal is audited with its reason. */
  async revealPayoutAccount(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const ring = this.requireKeyring();
    const reason = requireText('reason', body.reason, 500);

    const account = await this.prisma.teacherPayoutAccount.findUnique({ where: { teacherId: teacher.id } });
    if (!account) throw new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'no payout account recorded');
    let details: unknown;
    try {
      details = openPayout(ring, { organizationId: account.organizationId, teacherId: account.teacherId, method: account.method }, Buffer.from(account.detailsSealed), account.keyId);
    } catch {
      // A retired key, or a value that was altered or moved: never a guess.
      throw new CommError(CommErrorCode.TEACHER_PAYROLL_UNAVAILABLE, 'the payout account cannot be opened with the configured keys', 503);
    }
    await this.write((tx) =>
      this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.payout_account_revealed',
        entity: 'teacher',
        entityId: teacher.id,
        after: { method: account.method },
        reason,
      }),
    );
    return { method: account.method, details };
  }

  async addAdjustment(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const teacher = await this.files.requireTeacher(actor, teacherId);

    const reason = requireText('reason', body.reason, 500);
    let kind: string;
    let bonusEntryId: string | null = null;
    let violationId: string | null = null;
    let replaces: string | null = null;
    let month: string | null = body.month === undefined || body.month === null ? null : requireMonth('month', body.month);

    if (body.replaces !== undefined && body.replaces !== null) {
      // A correction keeps what it corrects: kind, source and (unless given) month.
      replaces = requireUuid('replaces', body.replaces);
      const target = await this.prisma.teacherPayAdjustment.findFirst({ where: { id: replaces, teacherId: teacher.id } });
      if (!target) throw conflict('that amount does not exist for this teacher');
      kind = target.kind;
      bonusEntryId = target.bonusEntryId;
      violationId = target.violationId;
      month ??= ym(target.month);
    } else {
      if (body.kind !== 'bonus' && body.kind !== 'deduction') throw invalid('kind', 'must be bonus or deduction');
      kind = body.kind;
      if (body.bonusEntryId !== undefined && body.bonusEntryId !== null) {
        if (kind !== 'bonus') throw invalid('bonusEntryId', 'prices a bonus');
        bonusEntryId = requireUuid('bonusEntryId', body.bonusEntryId);
        const entry = await this.prisma.teacherSupervisionEntry.findFirst({ where: { id: bonusEntryId, teacherId: teacher.id, kind: 'bonus' } });
        if (!entry) throw conflict('that bonus is not recorded for this teacher');
        month ??= await this.academyMonth(entry.createdAt);
      }
      if (body.violationId !== undefined && body.violationId !== null) {
        if (kind !== 'deduction') throw invalid('violationId', 'prices a deduction');
        violationId = requireUuid('violationId', body.violationId);
        const v = await this.prisma.teacherViolation.findFirst({
          where: { id: violationId, teacherId: teacher.id, decision: { in: ['deduction_1', 'deduction_2'] } },
        });
        if (!v) throw conflict('that deduction is not decided for this teacher');
        month ??= ym(v.month);
      }
      if (!month) throw invalid('month', 'is required for an amount that prices nothing recorded');
    }
    const amount = requireMoney('amount', body.amount, replaces !== null);

    // The amount is in the currency of the terms that month: one month, one currency.
    const terms = termsAt(
      await this.prisma.teacherPayTerms.findMany({ where: { teacherId: teacher.id }, orderBy: [{ effectiveMonth: 'desc' }, { createdAt: 'desc' }] }),
      month,
    );
    if (!terms) throw conflict(`record this teacher's pay terms for ${month} first`);

    const row = await this.write(async (tx) => {
      const created = await tx.teacherPayAdjustment.create({
        data: {
          organizationId: teacher.organizationId,
          teacherId: teacher.id,
          kind,
          month: monthDate(month as string),
          amount,
          currency: terms.currency,
          reason,
          bonusEntryId,
          violationId,
          replaces,
          createdBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.pay_adjustment_added',
        entity: 'teacher',
        entityId: teacher.id,
        after: { adjustmentId: created.id, kind, month, replaces },
        reason: `pay adjustment: ${kind}`,
      });
      return created;
    });
    return { id: row.id, kind: row.kind, month: ym(row.month), amount: money(row.amount), currency: row.currency };
  }

  // ------------------------------------------------------------------
  // PD-26: default deduction amounts, and the Rewards list
  // ------------------------------------------------------------------

  /**
   * The amount a first or second deduction is priced at the moment it is
   * decided (chat.price_decided_deduction), per currency; the newest row wins.
   * `currencies` are the ones teachers are paid in, so every one can be set.
   */
  async deductionDefaults(actorId: string) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    const org = actor.organizationId as string;
    const rows = await this.prisma.teacherPayDefault.findMany({
      where: { organizationId: org },
      orderBy: [{ createdAt: 'desc' }],
    });
    const current = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!current.has(`${r.kind}|${r.currency}`)) current.set(`${r.kind}|${r.currency}`, r);
    const staff = await this.names([...current.values()].map((r) => r.createdBy));
    const inUse = await this.prisma.teacherPayTerms.findMany({ where: { organizationId: org }, distinct: ['currency'], select: { currency: true } });
    return {
      currencies: [...new Set([...inUse.map((t) => t.currency), ...[...current.values()].map((r) => r.currency)])].sort(),
      defaults: [...current.values()]
        .filter((r) => cents(r.amount) > 0)
        .map((r) => ({
          kind: r.kind as 'deduction_1' | 'deduction_2',
          currency: r.currency,
          amount: money(r.amount),
          setAt: r.createdAt,
          setBy: { id: r.createdBy, name: staff.get(r.createdBy) ?? '' },
        })),
    };
  }

  /** Set (or, with 0, stop) the default for one step in one currency. Applies to deductions decided from now on. */
  async setDeductionDefault(actorId: string, body: Record<string, unknown>) {
    const { actor } = await this.files.gate(actorId, (a) => a.canViewFinance);
    if (body.kind !== 'deduction_1' && body.kind !== 'deduction_2') throw invalid('kind', 'must be deduction_1 or deduction_2');
    const kind = body.kind;
    const currency = requireCurrency(body.currency);
    const amount = requireMoney('amount', body.amount, true);
    await this.write(async (tx) => {
      await tx.teacherPayDefault.create({
        data: { organizationId: actor.organizationId as string, kind, currency, amount, createdBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.deduction_default_set',
        entity: 'organization',
        entityId: actor.organizationId as string,
        after: { kind, currency },
        reason: `default ${kind} amount`,
      });
    });
    return this.deductionDefaults(actorId);
  }

  /**
   * Every recorded reward (PD-11's bonus entry) of the organization, newest
   * first: reason, date, who recorded it -- for whoever reads Teacher Files.
   * The AMOUNT is payroll's: it is filled in only for the super admin (PD-10's
   * finance tier); for everyone else `amount` is absent, never null.
   */
  async rewards(actorId: string, month?: unknown) {
    const { actor, access } = await this.files.gate(actorId, (a) => a.canView);
    const org = actor.organizationId as string;
    const m = month === undefined || month === '' ? null : requireMonth('month', month);
    const [from, to] = m ? await this.monthBounds(m) : [null, null];
    const entries = await this.prisma.teacherSupervisionEntry.findMany({
      where: { organizationId: org, kind: 'bonus', ...(from && to ? { createdAt: { gte: from, lt: to } } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.teacherId))] } },
      select: { id: true, name: true },
    });
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const staff = await this.names(entries.map((e) => e.createdBy));
    const priced = access.canViewFinance
      ? new Map(
          liveAdjustments(
            await this.prisma.teacherPayAdjustment.findMany({
              where: { bonusEntryId: { in: entries.map((e) => e.id) } },
              orderBy: [{ createdAt: 'desc' }],
            }),
          ).map((a) => [a.bonusEntryId as string, a]),
        )
      : null;
    return {
      canViewAmounts: access.canViewFinance,
      rewards: entries.map((e) => {
        const a = priced?.get(e.id);
        return {
          id: e.id,
          teacher: { id: e.teacherId, name: teacherName.get(e.teacherId) ?? '' },
          reason: e.body,
          recordedAt: e.createdAt,
          recordedBy: { id: e.createdBy, name: staff.get(e.createdBy) ?? '' },
          ...(priced ? { amount: a ? { amount: money(a.amount), currency: a.currency, month: ym(a.month) } : null } : {}),
        };
      }),
    };
  }

  /** The instants a payroll month (academy calendar) starts and ends at. */
  private async monthBounds(m: string): Promise<[Date, Date]> {
    const [r] = await this.prisma.$queryRaw<Array<{ f: Date; t: Date }>>`
      SELECT (${`${m}-01`}::date::timestamp AT TIME ZONE tz) AS f,
             ((${`${m}-01`}::date + interval '1 month')::timestamp AT TIME ZONE tz) AS t
        FROM (SELECT coalesce((SELECT c.value #>> '{}' FROM chat.config c WHERE c.key = 'schedule.timezone'), 'Africa/Cairo') AS tz) z`;
    return [r.f, r.t];
  }

  // ------------------------------------------------------------------

  private requireKeyring(): PayoutKeyring {
    if (!this.keyring) {
      throw new CommError(CommErrorCode.TEACHER_PAYROLL_UNAVAILABLE, 'payout accounts need TEACHER_PAYOUT_KEYS on the server', 503);
    }
    return this.keyring;
  }

  private async currentMonth(): Promise<string> {
    const [r] = await this.prisma.$queryRaw<Array<{ m: string }>>`SELECT to_char(chat.academy_month(now()), 'YYYY-MM') AS m`;
    return r.m;
  }

  private async academyMonth(at: Date): Promise<string> {
    const [r] = await this.prisma.$queryRaw<Array<{ m: string }>>`SELECT to_char(chat.academy_month(${at}::timestamptz), 'YYYY-MM') AS m`;
    return r.m;
  }

  /** Minutes of the lessons the teacher was paid for, by payroll month (the academy calendar). */
  private async paidMinutes(teacherId: string, from: string, until: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ m: string; minutes: number }>>`
      SELECT to_char(chat.academy_month(l.starts_at), 'YYYY-MM') AS m,
             coalesce(sum(extract(epoch from (l.ends_at - l.starts_at)) / 60), 0)::int AS minutes
        FROM chat.lesson l
       WHERE l.teacher_id = ${teacherId}::uuid
         AND l.outcome = ANY(${[...PAID_OUTCOMES]}::text[])
         AND l.starts_at >= (${monthDate(from)}::date - interval '1 day')
         AND l.starts_at < (${monthDate(until)}::date + interval '1 month 1 day')
       GROUP BY 1`;
    return new Map(rows.filter((r) => r.m >= from && r.m <= until).map((r) => [r.m, r.minutes]));
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.staff.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if ((e as { code?: string })?.code === 'P2002' || /teacher_pay_adjustment_one_per|teacher_pay_adjustment_replaced_once/.test(text)) {
        throw conflict('already priced: correct the existing amount instead');
      }
      throw mapTimelineRefusal(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for the unit spec)
// ---------------------------------------------------------------------------

/** The terms in force in `month`: the latest effective month not after it, the newest version of that. */
export function termsAt(terms: Terms[], month: string): Terms | null {
  return [...terms]
    .filter((t) => ym(t.effectiveMonth) <= month)
    .sort((a, b) => ym(b.effectiveMonth).localeCompare(ym(a.effectiveMonth)) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/** Rows nobody has replaced. A live row of amount 0 is a cancellation and adds nothing. */
export function liveAdjustments(rows: Adjustment[]): Adjustment[] {
  const replaced = new Set(rows.map((r) => r.replaces).filter(Boolean));
  return rows.filter((r) => !replaced.has(r.id));
}

export function summarize(month: string, terms: Terms | null, live: Adjustment[], paidMinutes: number) {
  const inMonth = live.filter((a) => ym(a.month) === month);
  const sum = (kind: string) => inMonth.filter((a) => a.kind === kind).reduce((n, a) => n + cents(a.amount), 0);
  const bonuses = sum('bonus');
  const deductions = sum('deduction');
  if (!terms) {
    return { month, currency: null, salaryType: null, paidMinutes, base: null, bonuses: fromCents(bonuses), deductions: fromCents(deductions), net: null };
  }
  const base =
    terms.salaryType === SalaryType.SHIFT
      ? cents(terms.monthlyAmount as Prisma.Decimal)
      : Math.round((cents(terms.hourlyRate as Prisma.Decimal) * paidMinutes) / 60);
  return {
    month,
    currency: terms.currency,
    salaryType: terms.salaryType,
    paidMinutes,
    base: fromCents(base),
    bonuses: fromCents(bonuses),
    deductions: fromCents(deductions),
    net: fromCents(base + bonuses - deductions),
  };
}

/**
 * Validates one method's details and names the four characters the file may
 * show. Unknown fields are refused: nothing is sealed that no one can see.
 */
export function payoutDetails(method: PayoutMethod, raw: unknown): { details: Record<string, string>; last4: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('details', 'is required');
  const input = raw as Record<string, unknown>;
  const spec: Record<PayoutMethod, Record<string, { re: RegExp; required: boolean; why: string }>> = {
    e_wallet: {
      provider: { re: /^.{2,60}$/u, required: true, why: 'is the wallet provider, 2-60 characters' },
      walletNumber: { re: /^\+?[0-9]{6,20}$/, required: true, why: 'is 6-20 digits' },
    },
    instapay: {
      address: { re: /^(?=.*[0-9A-Za-z])[^\s]{3,100}$/u, required: true, why: 'is the InstaPay address, 3-100 characters, no spaces' },
    },
    bank_transfer: {
      bankName: { re: /^.{2,100}$/u, required: true, why: 'is 2-100 characters' },
      accountHolder: { re: /^.{2,120}$/u, required: true, why: 'is 2-120 characters' },
      accountNumber: { re: /^[0-9A-Za-z]{4,34}$/, required: true, why: 'is 4-34 letters or digits' },
      iban: { re: /^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$/, required: false, why: 'is an IBAN (letters and digits, no spaces)' },
      swift: { re: /^[A-Z0-9]{8}([A-Z0-9]{3})?$/, required: false, why: 'is 8 or 11 letters or digits' },
    },
  };
  const fields = spec[method];
  for (const key of Object.keys(input)) {
    if (!(key in fields)) throw invalid(`details.${key}`, `is not a ${method} field`);
  }
  const details: Record<string, string> = {};
  for (const [key, rule] of Object.entries(fields)) {
    const v = input[key];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (rule.required) throw invalid(`details.${key}`, 'is required');
      continue;
    }
    if (typeof v !== 'string') throw invalid(`details.${key}`, 'must be a string');
    const value = key === 'iban' || key === 'swift' ? v.replace(/\s+/g, '').toUpperCase() : v.trim();
    if (!rule.re.test(value)) throw invalid(`details.${key}`, rule.why);
    details[key] = value;
  }
  const identifier = method === 'e_wallet' ? details.walletNumber : method === 'instapay' ? details.address : (details.iban ?? details.accountNumber);
  const last4 = identifier.replace(/[^0-9A-Za-z]/g, '').slice(-4);
  return { details, last4 };
}

export function monthsEndingAt(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function termsDto(t: Terms) {
  return {
    effectiveMonth: ym(t.effectiveMonth),
    salaryType: t.salaryType,
    currency: t.currency,
    monthlyAmount: t.monthlyAmount === null ? null : money(t.monthlyAmount),
    hourlyRate: t.hourlyRate === null ? null : money(t.hourlyRate),
    reason: t.reason,
  };
}

const ym = (d: Date) => d.toISOString().slice(0, 7);
const monthDate = (m: string) => new Date(`${m}-01T00:00:00.000Z`);
const money = (d: Prisma.Decimal) => fromCents(cents(d));
const cents = (d: Prisma.Decimal | string) => Math.round(Number(String(d)) * 100);
const fromCents = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
const conflict = (why: string) => new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, why, 409);

function requireMonth(field: string, value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw invalid(field, 'must be YYYY-MM');
  return value;
}

function requireCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY.test(value.trim().toUpperCase())) throw invalid('currency', 'must be a 3-letter ISO 4217 code, e.g. EGP');
  return value.trim().toUpperCase();
}

/** A positive amount with at most two decimals, as a number or a string. Zero only when cancelling. */
function requireMoney(field: string, value: unknown, zeroAllowed: boolean): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!MONEY.test(text)) throw invalid(field, 'must be an amount with at most two decimals');
  if (cents(text) === 0 && !zeroAllowed) throw invalid(field, 'must be more than 0');
  return text;
}

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(field, 'must be a uuid');
  return value.toLowerCase();
}

function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field, 'is required');
  if (value.trim().length > max) throw invalid(field, `must be at most ${max} characters`);
  return value.trim();
}
