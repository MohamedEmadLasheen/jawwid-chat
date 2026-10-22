import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { awayRefusal } from '../leave/away';
import { isUuid } from '../communication/conversations/conversation.service';

type Tx = Prisma.TransactionClient;

export const PAYMENT_METHODS: ReadonlySet<string> = new Set(['bank_transfer', 'invoice']);
const MAX_CHILDREN = 10;
const MAX_SLOTS = 14;
const MAX_PRICE = 1_000_000_000;

export interface ScheduleSlot {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** "HH:MM", the academy's local time. */
  time: string;
}

export interface ChildForm {
  name: string;
  age: number;
  course: string;
  teacherId: string;
  packagePrice: number;
  lessonPrice: number;
  schedule: ScheduleSlot[];
}

/** Sales' subscription form, validated. */
export interface SubscriptionForm {
  parent: { name: string; email: string | null; phone: string };
  children: ChildForm[];
  payment: { currency: string; method: 'bank_transfer' | 'invoice' };
}

/**
 * Trial journey: the subscription form Sales fills when a trial's student
 * subscribes, and the New Students page that reads it.
 *
 * The form holds a parent's phone and e-mail, so it is CONFINED (G-07): only
 * this service names chat.trial_subscription, no request role has a grant on
 * it, and nothing here returns it to a message, a card, an event, a search or
 * an export. TrialService decides WHO may record or read; this service only
 * validates, stores and lists, inside the caller's transaction.
 *
 * One form per trial (the trial's id is the key). A correction away from
 * "subscribed" withdraws it, a correction back restores it; it is never
 * deleted, so the page and the statistics never count a trial twice.
 */
@Injectable()
export class NewStudentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validate a form from the request body. Teachers must be active teachers of the organization. */
  async validate(organizationId: string, raw: unknown): Promise<SubscriptionForm> {
    const body = object(raw, 'subscription');
    const parentRaw = object(body.parent, 'subscription.parent');
    const parent = {
      name: text(parentRaw.name, 'parent.name', 120, true) as string,
      email: email(parentRaw.email),
      phone: phone(parentRaw.phone),
    };

    if (!Array.isArray(body.children) || body.children.length < 1 || body.children.length > MAX_CHILDREN) {
      throw invalid(`children: 1 to ${MAX_CHILDREN}`);
    }
    const children = body.children.map((c, i) => child(c, i));

    const teacherIds = [...new Set(children.map((c) => c.teacherId))];
    const live = await this.prisma.teacher.count({
      where: { id: { in: teacherIds }, organizationId, isActive: true, leftAt: null },
    });
    if (live !== teacherIds.length) throw invalid('children[].teacherId: an active teacher of this academy');
    for (const t of await this.prisma.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } })) {
      const away = await awayRefusal(this.prisma, t);
      if (away) throw new CommError(CommErrorCode.LESSON_STATE, away, 409);
    }

    const paymentRaw = object(body.payment, 'subscription.payment');
    const currency = typeof paymentRaw.currency === 'string' ? paymentRaw.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) throw invalid('payment.currency: a three-letter currency code');
    const method = paymentRaw.method;
    if (typeof method !== 'string' || !PAYMENT_METHODS.has(method)) throw invalid('payment.method: bank_transfer or invoice');

    return { parent, children, payment: { currency, method: method as 'bank_transfer' | 'invoice' } };
  }

  /** Store the form of a trial that has just become "subscribed" (in the caller's transaction). */
  async recordInTx(tx: Tx, input: { lessonId: string; organizationId: string; form: SubscriptionForm; by: string }) {
    const existing = await tx.trialSubscription.findUnique({ where: { lessonId: input.lessonId } });
    if (existing) {
      // A trial corrected back to "subscribed": its form comes back with the new details.
      await tx.trialSubscription.update({
        where: { lessonId: input.lessonId },
        data: { ...columns(input.form), withdrawnAt: null, updatedBy: input.by },
      });
      return;
    }
    await tx.trialSubscription.create({
      data: { lessonId: input.lessonId, organizationId: input.organizationId, ...columns(input.form), recordedBy: input.by },
    });
  }

  /** Replace a live form's details (a typo, a changed schedule). */
  async updateInTx(tx: Tx, input: { lessonId: string; form: SubscriptionForm; by: string }) {
    const existing = await tx.trialSubscription.findUnique({ where: { lessonId: input.lessonId } });
    if (!existing || existing.withdrawnAt) throw stateError('this trial has no subscription form to change');
    await tx.trialSubscription.update({ where: { lessonId: input.lessonId }, data: { ...columns(input.form), updatedBy: input.by } });
  }

  /** The trial was corrected away from "subscribed": its form leaves the page, and is kept. */
  async withdrawInTx(tx: Tx, input: { lessonId: string; by: string }) {
    await tx.trialSubscription.updateMany({
      where: { lessonId: input.lessonId, withdrawnAt: null },
      data: { withdrawnAt: new Date(), updatedBy: input.by },
    });
  }

  /** Whether a live form exists -- for a reader that must not see its content. */
  async hasLiveForm(lessonId: string): Promise<boolean> {
    return (await this.prisma.trialSubscription.count({ where: { lessonId, withdrawnAt: null } })) > 0;
  }

  /** The New Students page: every live form, newest first, with names resolved. */
  async list(organizationId: string) {
    const forms = await this.prisma.trialSubscription.findMany({
      where: { organizationId, withdrawnAt: null },
      orderBy: { recordedAt: 'desc' },
      take: 500,
    });
    return this.present(organizationId, forms);
  }

  /** One trial's live form, or null. */
  async get(organizationId: string, lessonId: string) {
    if (!isUuid(lessonId)) return null;
    const form = await this.prisma.trialSubscription.findFirst({ where: { lessonId, organizationId, withdrawnAt: null } });
    if (!form) return null;
    return (await this.present(organizationId, [form]))[0];
  }

  private async present(organizationId: string, forms: Array<Prisma.TrialSubscriptionGetPayload<object>>) {
    if (forms.length === 0) return [];
    const lessons = await this.prisma.lesson.findMany({
      where: { id: { in: forms.map((f) => f.lessonId) }, organizationId },
      select: { id: true, startsAt: true, teacher: { select: { id: true, name: true } }, prospect: { select: { displayName: true } } },
    });
    const byLesson = new Map(lessons.map((l) => [l.id, l]));
    const childTeacherIds = forms.flatMap((f) => (f.children as unknown as ChildForm[]).map((c) => c.teacherId));
    const staffIds = forms.flatMap((f) => [f.recordedBy, ...(f.updatedBy ? [f.updatedBy] : [])]);
    const [teachers, staff] = await Promise.all([
      this.prisma.teacher.findMany({ where: { id: { in: [...new Set(childTeacherIds)] }, organizationId }, select: { id: true, name: true } }),
      this.prisma.staff.findMany({ where: { id: { in: [...new Set(staffIds)] }, organizationId }, select: { id: true, name: true } }),
    ]);
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const staffName = new Map(staff.map((s) => [s.id, s.name]));

    return forms.map((f) => {
      const lesson = byLesson.get(f.lessonId);
      return {
        trialId: f.lessonId,
        prospectName: lesson?.prospect?.displayName ?? '',
        trialTeacher: lesson?.teacher ?? null,
        trialAt: lesson?.startsAt.toISOString() ?? null,
        recordedAt: f.recordedAt.toISOString(),
        recordedBy: { id: f.recordedBy, name: staffName.get(f.recordedBy) ?? '' },
        updatedAt: f.updatedAt?.toISOString() ?? null,
        parent: { name: f.parentName, email: f.confinedEmail, phone: f.confinedParentPhone },
        children: (f.children as unknown as ChildForm[]).map((c) => ({
          name: c.name,
          age: c.age,
          course: c.course,
          teacher: { id: c.teacherId, name: teacherName.get(c.teacherId) ?? '' },
          packagePrice: c.packagePrice,
          lessonPrice: c.lessonPrice,
          schedule: c.schedule,
        })),
        payment: { currency: f.currency, method: f.paymentMethod },
      };
    });
  }
}

function columns(form: SubscriptionForm) {
  return {
    parentName: form.parent.name,
    confinedEmail: form.parent.email,
    confinedParentPhone: form.parent.phone,
    children: form.children as unknown as Prisma.InputJsonValue,
    currency: form.payment.currency,
    paymentMethod: form.payment.method,
  };
}

function child(raw: unknown, i: number): ChildForm {
  const c = object(raw, `children[${i}]`);
  const at = (k: string) => `children[${i}].${k}`;
  const age = Number(c.age);
  if (!Number.isInteger(age) || age < 3 || age > 99) throw invalid(`${at('age')}: a whole number from 3 to 99`);
  if (typeof c.teacherId !== 'string' || !isUuid(c.teacherId)) throw invalid(`${at('teacherId')}: required`);
  if (!Array.isArray(c.schedule) || c.schedule.length < 1 || c.schedule.length > MAX_SLOTS) {
    throw invalid(`${at('schedule')}: 1 to ${MAX_SLOTS} weekly lesson times`);
  }
  const schedule = c.schedule.map((s, j) => {
    const slot = object(s, `${at('schedule')}[${j}]`);
    const weekday = Number(slot.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw invalid(`${at('schedule')}[${j}].weekday: 1 (Monday) to 7 (Sunday)`);
    const time = typeof slot.time === 'string' ? slot.time.trim() : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid(`${at('schedule')}[${j}].time: HH:MM`);
    return { weekday, time };
  });
  const keys = new Set(schedule.map((s) => `${s.weekday}@${s.time}`));
  if (keys.size !== schedule.length) throw invalid(`${at('schedule')}: a lesson time is listed twice`);
  schedule.sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
  return {
    name: text(c.name, at('name'), 120, true) as string,
    age,
    course: text(c.course, at('course'), 120, true) as string,
    teacherId: c.teacherId.toLowerCase(),
    packagePrice: price(c.packagePrice, at('packagePrice')),
    lessonPrice: price(c.lessonPrice, at('lessonPrice')),
    schedule,
  };
}

function price(v: unknown, key: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_PRICE || Math.round(n * 100) !== n * 100) {
    throw invalid(`${key}: an amount of 0 or more, at most two decimals`);
  }
  return n;
}

function phone(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  const digits = s.replace(/\D/g, '').length;
  if (!/^\+?[\d\s()-]{5,32}$/.test(s) || digits < 5) throw invalid('parent.phone: a phone number');
  return s;
}

function email(v: unknown): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 3 || s.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(s)) throw invalid('parent.email: an e-mail address');
  return s;
}

function text(v: unknown, key: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw invalid(`${key}: required`);
    return null;
  }
  if (typeof v !== 'string') throw invalid(`${key}: must be text`);
  const s = v.trim();
  if (s.length > max) throw invalid(`${key}: at most ${max} characters`);
  return s;
}

function object(v: unknown, key: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw invalid(`${key}: required`);
  return v as Record<string, unknown>;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function stateError(reason: string) {
  return new CommError(CommErrorCode.LESSON_STATE, reason, 409);
}
