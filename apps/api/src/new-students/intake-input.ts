import { CommError, CommErrorCode } from '../platform/errors';
import { isUuid } from '../communication/conversations/conversation.service';
import { DEFAULT_PHONE_REGION, toE164 } from '../parent-profile/parent-phone-directory';
import { PAYMENT_METHODS, type ScheduleSlot } from './new-students.service';
import { normaliseEmailForKey } from './contact-key';
import { parseLocation, type LocationValue } from '../geo/location';

/**
 * PD-42: what a supervisor types to enter a family by hand, validated. Jawwid
 * Core's data is incomplete, so only three things are required (plan §6): the
 * parent's name, a phone OR an e-mail, and each child's name. Everything else
 * may be completed later on the profiles. Nothing is invented: a value that
 * cannot be read is refused, never adjusted (owner safeguard S2).
 */
const MAX_CHILDREN = 10;
const MAX_SLOTS = 14;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** An Egyptian mobile as typed at home: 010 / 011 / 012 / 015 and eight digits. */
const EGYPT_MOBILE = /^01[0125]\d{8}$/;

export interface CarriedOverInput {
  /** Lessons in the package Core shows. */
  total: number;
  /** Lessons already used in Core, exactly as Core shows (may exceed the total: F1, a manager's entry). */
  completed: number;
  /** 1..24 months, as Core shows; null when not known. */
  planMonths: number | null;
}

export interface IntakeChild {
  name: string;
  teacherId: string | null;
  course: string | null;
  age: number | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  schedule: ScheduleSlot[];
  durationMinutes: number;
  carriedOver: CarriedOverInput | null;
}

export interface IntakeParent {
  name: string;
  /** Trimmed, lower case; null when not known yet. */
  email: string | null;
  /** As typed (kept in the parent file). */
  phone: string | null;
  /** E.164, for the contact key; null when no phone. */
  phoneE164: string | null;
  /** PD-45: where the family lives -- optional at intake (owner Q2). */
  location: LocationValue | null;
}

export interface IntakeInput {
  /** The client's id for this intake: a replay writes nothing (S1). */
  intakeId: string;
  parent: IntakeParent;
  children: IntakeChild[];
  payment: { method: 'bank_transfer' | 'invoice' | null; currency: string | null };
  /** A manager entering for a supervisor (D5). */
  onBehalfOf: string | null;
  /** A manager confirms completed lessons above a package (F1). */
  confirmOver: boolean;
}

export interface AddChildrenInput {
  intakeId: string;
  children: IntakeChild[];
  confirmDuplicate: boolean;
  confirmOver: boolean;
}

export function parseIntake(raw: unknown): IntakeInput {
  const body = object(raw, 'body');
  const parentRaw = object(body.parent, 'parent');
  const name = text(parentRaw.name, 'parent.name', 120, true) as string;
  const email = optionalEmail(parentRaw.email);
  const phone = text(parentRaw.phone, 'parent.phone', 32, false);
  let phoneE164: string | null = null;
  if (phone !== null) {
    const country = typeof parentRaw.country === 'string' && /^[A-Za-z]{2}$/.test(parentRaw.country.trim())
      ? (parentRaw.country.trim().toUpperCase() as Parameters<typeof toE164>[1])
      : null;
    const keyed = e164ForKey(phone, country);
    if (keyed === 'ambiguous') throw invalid('parent.phone: add the country code (+...) or choose the number\'s country');
    if (!keyed) throw invalid('parent.phone: a phone number with its country code (or the country chosen)');
    phoneE164 = keyed;
  }
  if (!email && !phone) throw invalid('parent: a phone number or an e-mail address -- one of them is required');
  const paymentRaw = body.payment === undefined || body.payment === null ? {} : object(body.payment, 'payment');
  const method = paymentRaw.method ?? null;
  if (method !== null && (typeof method !== 'string' || !PAYMENT_METHODS.has(method))) throw invalid('payment.method: bank_transfer or invoice');
  const currencyRaw = paymentRaw.currency ?? null;
  const currency = currencyRaw === null || currencyRaw === '' ? null : typeof currencyRaw === 'string' ? currencyRaw.trim().toUpperCase() : '';
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw invalid('payment.currency: a three-letter currency code');
  return {
    intakeId: uuid(body.intakeId, 'intakeId'),
    parent: { name, email, phone, phoneE164, location: parseLocation(parentRaw.location, 'parent.location') },
    children: children(body.children),
    payment: { method: method as 'bank_transfer' | 'invoice' | null, currency },
    onBehalfOf: body.onBehalfOf === undefined || body.onBehalfOf === null ? null : uuid(body.onBehalfOf, 'onBehalfOf'),
    confirmOver: body.confirmOver === true,
  };
}

export function parseAddChildren(raw: unknown): AddChildrenInput {
  const body = object(raw, 'body');
  return {
    intakeId: uuid(body.intakeId, 'intakeId'),
    children: children(body.children),
    confirmDuplicate: body.confirmDuplicate === true,
    confirmOver: body.confirmOver === true,
  };
}

export function parseCarriedOver(raw: unknown, key = 'carriedOver'): CarriedOverInput {
  const c = object(raw, key);
  const total = whole(c.total, `${key}.total`, 1, 1000);
  const completed = whole(c.completed, `${key}.completed`, 0, 1000);
  const planMonths = c.planMonths === undefined || c.planMonths === null || c.planMonths === '' ? null : whole(c.planMonths, `${key}.planMonths`, 1, 24);
  return { total, completed, planMonths };
}

export function parseSignInEmail(raw: unknown): string {
  const body = object(raw, 'body');
  const email = optionalEmail(body.email);
  if (!email) throw invalid('email: required');
  return email;
}

/**
 * The number a parent's phone is keyed by (E.164), or 'ambiguous' when a local
 * number comes with no country -- unless it is unmistakably an Egyptian mobile
 * (010 / 011 / 012 / 015 + eight digits). A Gulf "050 123 4567" read as
 * Egyptian would key a different person. null when it is not a number at all.
 */
export function e164ForKey(phone: string, country: string | null): string | 'ambiguous' | null {
  const digits = phone.replace(/[\s().-]/g, '');
  const international = digits.startsWith('+') || digits.startsWith('00');
  if (!international && !country && !EGYPT_MOBILE.test(digits)) return 'ambiguous';
  const region = (country ?? DEFAULT_PHONE_REGION) as Parameters<typeof toE164>[1];
  return toE164(digits.startsWith('00') ? `+${digits.slice(2)}` : phone, region);
}

/**
 * A child's name as compared for duplicates: trimmed, case folded, tatweel
 * removed, and أ/إ/آ -> ا, ى -> ي, ة -> ه -- the spellings one family's name
 * is typed with. Never stored; only compared.
 */
export function foldName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/\u0640/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------

function children(raw: unknown): IntakeChild[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CHILDREN) throw invalid(`children: 1 to ${MAX_CHILDREN}`);
  const list = raw.map((c, i) => child(c, i));
  const folded = list.map((c) => `${foldName(c.name)}|${c.birthDate ?? ''}`);
  if (new Set(folded).size !== folded.length) throw invalid('children: the same child is listed twice');
  return list;
}

function child(raw: unknown, i: number): IntakeChild {
  const c = object(raw, `children[${i}]`);
  const at = (k: string) => `children[${i}].${k}`;
  const teacherId = c.teacherId === undefined || c.teacherId === null || c.teacherId === '' ? null : uuid(c.teacherId, at('teacherId'));
  const age = c.age === undefined || c.age === null || c.age === '' ? null : whole(c.age, at('age'), 3, 99);
  const birthDate = c.birthDate === undefined || c.birthDate === null || c.birthDate === '' ? null : date(c.birthDate, at('birthDate'));
  const scheduleRaw = c.schedule === undefined || c.schedule === null ? [] : c.schedule;
  if (!Array.isArray(scheduleRaw) || scheduleRaw.length > MAX_SLOTS) throw invalid(`${at('schedule')}: at most ${MAX_SLOTS} weekly lesson times`);
  const schedule = scheduleRaw.map((s, j) => {
    const slot = object(s, `${at('schedule')}[${j}]`);
    const weekday = Number(slot.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw invalid(`${at('schedule')}[${j}].weekday: 1 (Monday) to 7 (Sunday)`);
    const time = typeof slot.time === 'string' ? slot.time.trim() : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid(`${at('schedule')}[${j}].time: HH:MM`);
    return { weekday, time };
  });
  if (new Set(schedule.map((s) => `${s.weekday}@${s.time}`)).size !== schedule.length) throw invalid(`${at('schedule')}: a lesson time is listed twice`);
  if (schedule.length > 0 && !teacherId) throw invalid(`${at('schedule')}: weekly times need the child's teacher`);
  const durationMinutes = c.durationMinutes === undefined || c.durationMinutes === null || c.durationMinutes === '' ? 30 : whole(c.durationMinutes, at('durationMinutes'), 15, 240);
  return {
    name: text(c.name, at('name'), 120, true) as string,
    teacherId,
    course: text(c.course, at('course'), 120, false),
    age,
    birthDate,
    schedule,
    durationMinutes,
    carriedOver: c.carriedOver === undefined || c.carriedOver === null ? null : parseCarriedOver(c.carriedOver, at('carriedOver')),
  };
}

function optionalEmail(v: unknown): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw invalid('email: must be text');
  const s = normaliseEmailForKey(v);
  if (s.length > 254 || !EMAIL_RE.test(s)) throw invalid('email: an e-mail address');
  return s;
}

function whole(v: unknown, key: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw invalid(`${key}: a whole number from ${min} to ${max}`);
  return n;
}

function date(v: unknown, key: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s || d.getTime() > Date.now()) {
    throw invalid(`${key}: a date (YYYY-MM-DD), not in the future`);
  }
  return s;
}

function uuid(v: unknown, key: string): string {
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${key}: an id`);
  return v.toLowerCase();
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
  return new CommError(CommErrorCode.INTAKE_INVALID, reason, 400);
}
