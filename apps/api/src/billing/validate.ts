import { CommError, CommErrorCode } from '../platform/errors';
import { isUuid } from '../communication/conversations/conversation.service';

/** Request-body checks shared by PD-17 billing and PD-27 payments: one wording, one rule. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
/** chat.family_instalment / chat.payment's own bound. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

export function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

export function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(`${field}: must be a uuid`);
  return (value as string).toLowerCase();
}

export function optionalUuid(field: string, value: unknown): string | null {
  return value === undefined || value === null ? null : requireUuid(field, value);
}

export function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(`${field}: is required`);
  if (value.trim().length > max) throw invalid(`${field}: must be at most ${max} characters`);
  return value.trim();
}

export function optionalText(field: string, value: unknown, max: number): string | null {
  return value === undefined || value === null || value === '' ? null : requireText(field, value, max);
}

export function requireDate(field: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw invalid(`${field}: YYYY-MM-DD`);
  }
  return value;
}

export function optionalDate(field: string, value: unknown): string | null {
  return value === undefined || value === null ? null : requireDate(field, value);
}

export function requireCurrency(value: unknown): string {
  const c = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!CURRENCY_RE.test(c)) throw invalid('currency: a three-letter ISO 4217 code, e.g. AED');
  return c;
}

export function requireAmount(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT_MINOR) {
    throw invalid(`${field}: a positive whole amount in minor units (e.g. cents)`);
  }
  return value;
}

export function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}
