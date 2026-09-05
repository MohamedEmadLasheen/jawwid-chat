import '../../l10n/app_localizations.dart';
import 'app_error.dart';

/// A user-facing rendering of a failure.
class ErrorMessage {
  const ErrorMessage({required this.title, this.body, this.canRetry = true});

  final String title;
  final String? body;
  final bool canRetry;
}

/// Turns an [AppError] into localised, non-technical copy.
///
/// This is the only bridge between the error taxonomy and the UI, which is what keeps §37
/// ("do not expose internal technical stack traces") and §56 ("never log or surface sensitive
/// data") true by construction — a screen is handed an [ErrorMessage], never an exception.
abstract final class ErrorPresenter {
  static ErrorMessage present(AppError error, L10n l10n) {
    return switch (error.kind) {
      AppErrorKind.network => ErrorMessage(
          title: l10n.errorNetworkTitle,
          body: l10n.errorNetworkBody,
        ),
      AppErrorKind.timeout => ErrorMessage(
          title: l10n.errorTimeoutTitle,
          body: l10n.errorServerBody,
        ),
      AppErrorKind.accountDisabled => ErrorMessage(
          title: l10n.sessionExpiredTitle,
          body: l10n.signInFailedDisabled,
          canRetry: false,
        ),
      AppErrorKind.unauthenticated || AppErrorKind.sessionRevoked => ErrorMessage(
          title: l10n.sessionExpiredTitle,
          body: l10n.sessionExpiredBody,
          canRetry: false,
        ),
      // A policy refusal is never presented as retryable — §3 forbids working around it.
      AppErrorKind.forbidden => ErrorMessage(
          title: l10n.errorForbiddenTitle,
          body: l10n.errorForbiddenBody,
          canRetry: false,
        ),
      AppErrorKind.notFound => ErrorMessage(
          title: l10n.errorNotFoundTitle,
          body: l10n.errorNotFoundBody,
          canRetry: false,
        ),
      AppErrorKind.validation => ErrorMessage(
          title: l10n.errorServerTitle,
          body: l10n.errorServerBody,
          canRetry: false,
        ),
      AppErrorKind.rateLimited || AppErrorKind.server || AppErrorKind.unknown =>
        ErrorMessage(
          title: l10n.errorServerTitle,
          body: l10n.errorServerBody,
        ),
    };
  }
}
