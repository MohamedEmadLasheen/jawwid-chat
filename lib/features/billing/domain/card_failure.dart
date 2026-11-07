import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_billing.dart';

/// PD-27 completion: why a card attempt failed, in words a parent can act on.
///
/// The same table as the API's `apps/api/src/billing/card-failure.ts`, which words the
/// pay page: keep the two in step. The input is Stripe's decline or error code, never
/// Stripe's message. Codes that would alarm or accuse (`lost_card`, `stolen_card`,
/// `fraudulent`, ...) read as the generic decline: the bank's reason is between the bank
/// and the cardholder.
enum CardFailureKind {
  insufficientFunds,
  expiredCard,
  incorrectCvc,
  incorrectNumber,
  authentication,
  processingError,
  declined,
}

CardFailureKind cardFailureKind(String? code) => switch (code) {
      'insufficient_funds' => CardFailureKind.insufficientFunds,
      'expired_card' => CardFailureKind.expiredCard,
      'incorrect_cvc' || 'invalid_cvc' => CardFailureKind.incorrectCvc,
      'incorrect_number' || 'invalid_number' => CardFailureKind.incorrectNumber,
      'authentication_required' || 'payment_intent_authentication_failure' => CardFailureKind.authentication,
      'processing_error' => CardFailureKind.processingError,
      _ => CardFailureKind.declined,
    };

/// "Your last card payment did not go through: (reason) Try another card, or pay by
/// bank transfer." -- lead, reason and next step, as the API's `cardFailureText`.
String cardFailureText(String? code, L10n l10n) {
  final reason = switch (cardFailureKind(code)) {
    CardFailureKind.insufficientFunds => l10n.billingCardFailureInsufficientFunds,
    CardFailureKind.expiredCard => l10n.billingCardFailureExpiredCard,
    CardFailureKind.incorrectCvc => l10n.billingCardFailureIncorrectCvc,
    CardFailureKind.incorrectNumber => l10n.billingCardFailureIncorrectNumber,
    CardFailureKind.authentication => l10n.billingCardFailureAuthentication,
    CardFailureKind.processingError => l10n.billingCardFailureProcessingError,
    CardFailureKind.declined => l10n.billingCardFailureDeclined,
  };
  return '${l10n.billingCardFailureLead} $reason ${l10n.billingCardFailureNext}';
}

/// "Visa •••• 4242 · Apple Pay". Brand and wallet names are trademarks and stay as
/// written in either language; a brand this build does not name is "Card" / "بطاقة".
/// Null when nothing is known worth showing.
String? cardLabel(PaymentCard? card, L10n l10n) {
  if (card == null) return null;
  final brand = _brands[card.brand] ?? l10n.billingMethodCard;
  final last4 = card.last4;
  final wallet = _wallets[card.wallet];
  if (last4 == null && wallet == null && !_brands.containsKey(card.brand)) return null;
  return [
    last4 == null ? brand : '$brand •••• $last4',
    ?wallet,
  ].join(' · ');
}

const _brands = {
  'visa': 'Visa',
  'mastercard': 'Mastercard',
  'amex': 'American Express',
  'discover': 'Discover',
  'diners': 'Diners Club',
  'jcb': 'JCB',
  'unionpay': 'UnionPay',
  'cartes_bancaires': 'Cartes Bancaires',
  'eftpos_au': 'eftpos',
};

const _wallets = {
  'apple_pay': 'Apple Pay',
  'google_pay': 'Google Pay',
  'samsung_pay': 'Samsung Pay',
  'link': 'Link',
};
