/**
 * PD-27 completion: why a card attempt failed, in words a parent can act on.
 *
 * The input is Stripe's decline_code or error code, as chat.payment_checkout
 * keeps it -- never Stripe's own message (English API prose, and it can name
 * parameters). Codes that would alarm or accuse (lost_card, stolen_card,
 * fraudulent, ...) read as the generic decline: the bank's reason is between
 * the bank and the cardholder. The app has the same table in its l10n files.
 */
export type CardFailureKind = 'insufficient_funds' | 'expired_card' | 'incorrect_cvc' | 'incorrect_number' | 'authentication' | 'processing_error' | 'declined';

export function cardFailureKind(code: string | null | undefined): CardFailureKind {
  switch (code) {
    case 'insufficient_funds':
      return 'insufficient_funds';
    case 'expired_card':
      return 'expired_card';
    case 'incorrect_cvc':
    case 'invalid_cvc':
      return 'incorrect_cvc';
    case 'incorrect_number':
    case 'invalid_number':
      return 'incorrect_number';
    case 'authentication_required':
    case 'payment_intent_authentication_failure':
      return 'authentication';
    case 'processing_error':
      return 'processing_error';
    default:
      return 'declined';
  }
}

const TEXT: Record<'ar' | 'en', { lead: string; next: string; kinds: Record<CardFailureKind, string> }> = {
  ar: {
    lead: 'لم تنجح آخر محاولة للدفع بالبطاقة:',
    next: 'جرّبوا بطاقة أخرى أو ادفعوا بالتحويل البنكي.',
    kinds: {
      insufficient_funds: 'رفض البنك الدفع لعدم كفاية الرصيد.',
      expired_card: 'البطاقة منتهية الصلاحية.',
      incorrect_cvc: 'رمز التحقق (CVC) غير صحيح.',
      incorrect_number: 'رقم البطاقة غير صحيح.',
      authentication: 'لم يكتمل تحقق البنك (3D Secure).',
      processing_error: 'حدث خطأ أثناء معالجة البطاقة.',
      declined: 'رفض البنك الدفع بالبطاقة.',
    },
  },
  en: {
    lead: 'Your last card payment did not go through:',
    next: 'Try another card, or pay by bank transfer.',
    kinds: {
      insufficient_funds: 'your bank declined it for insufficient funds.',
      expired_card: 'the card has expired.',
      incorrect_cvc: 'the security code (CVC) was incorrect.',
      incorrect_number: 'the card number was incorrect.',
      authentication: "your bank's verification (3D Secure) was not completed.",
      processing_error: 'there was an error processing the card.',
      declined: 'your bank declined the card.',
    },
  },
};

export function cardFailureText(code: string | null | undefined, lang: 'ar' | 'en'): string {
  const t = TEXT[lang];
  return `${t.lead} ${t.kinds[cardFailureKind(code)]} ${t.next}`;
}
