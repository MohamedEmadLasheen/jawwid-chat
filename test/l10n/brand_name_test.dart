import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// THE ARABIC BRAND NAME.
///
/// The product is جَوِّد — the imperative of جوَّد, the root the academy is named
/// for. An audit found it written جوّيد, with an inserted ي, in the Arabic
/// notification templates. The extra letter does not make a variant spelling;
/// it makes a word that does not exist.
///
/// Scope of this guard is deliberate. It reads the LIVE localisation resources
/// only — the Arabic .arb and the generated Dart beside it. It does NOT scan
/// the repository, because the applied migrations that seeded the misspelling
/// must keep the text they originally shipped (the correction is forward-only,
/// in `supabase/migrations/20261020300000_chat_brand_name_arabic.sql`). A guard
/// that failed on those would be a guard nobody could keep green. The
/// server-side half — that no notification template still carries it — is
/// asserted against a migrated database in
/// `apps/api/test/integration/groups-approval-calls.spec.ts`.
void main() {
  const canonical = 'جَوِّد';
  const misspelt = 'جوّيد';

  /// The resources a build actually ships Arabic from.
  final liveResources = <String>[
    'lib/l10n/app_ar.arb',
    'lib/l10n/app_localizations_ar.dart',
  ];

  group('the Arabic brand name', () {
    test('is never misspelt in a live localisation resource', () {
      final offenders = <String>[];

      for (final path in liveResources) {
        final file = File(path);
        expect(file.existsSync(), isTrue, reason: '$path is missing');

        final lines = file.readAsLinesSync();
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].contains(misspelt)) {
            offenders.add('$path:${i + 1}  ${lines[i].trim()}');
          }
        }
      }

      expect(
        offenders,
        isEmpty,
        reason:
            'The Arabic brand name is جَوِّد, never جوّيد:\n'
            '${offenders.join('\n')}',
      );
    });

    test(
      'is the canonical spelling everywhere Arabic names the product',
      () async {
        final ar = await L10n.delegate.load(const Locale('ar'));

        expect(ar.appName, canonical);
        expect(ar.groupMemberRoleAdmin, canonical);

        // Every Arabic string that names the product names it correctly.
        for (final sentence in [
          ar.signInTitle,
          ar.signInSubtitle,
          ar.signInFailedDisabled,
          ar.signInFailedRoleUnsupported,
          ar.sessionUnreachableBody,
          ar.signOutConfirm,
          ar.conversationsEmptyBodyParent,
          ar.groupApprovalNotice,
          ar.callFailedMicrophone,
          ar.notificationPermissionBody,
          ar.cameraPermissionDenied,
          ar.attachmentPermissionDenied,
        ]) {
          expect(sentence, contains(canonical));
          expect(sentence, isNot(contains(misspelt)));
        }
      },
    );

    test('leaves the English brand name alone', () async {
      final en = await L10n.delegate.load(const Locale('en'));
      expect(en.appName, 'Jawwid');
    });
  });
}
