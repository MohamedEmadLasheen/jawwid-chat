/**
 * PD-27: minor units to what a person reads. Pure.
 *
 * Every amount is stored in minor units of its currency (fils, cents, piastres);
 * how many digits a currency has is ISO 4217's, which Intl knows (AED 2, JPY 0,
 * KWD 3). Latin digits everywhere a document or a push prints a number: an
 * invoice is read by banks and accountants as well as by the family.
 */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** 150000 AED -> "1,500.00". */
export function formatMajor(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (amountMinor / 10 ** digits).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
