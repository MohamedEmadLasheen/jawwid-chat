import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/features/legal/application/legal_client.dart';
import 'package:jawwid_chat/shared/models/legal.dart';

/// PD-58 (ENG-11): the `legal` block of `GET /me` and the token pair, read on the client.
///
/// The one rule that matters most for the release order (API-CONTRACT §1.1c): the clients
/// ship BEFORE the API gate, so a body with NO `legal` field at all -- today's API -- must
/// read as "nothing to show" (null), never as a gate. Everything else that is not a clean
/// answer fails closed: it reads as `unavailable`, never as `accepted`.
void main() {
  const terms = {
    'documentKey': 'terms_family',
    'version': '2026-12-01',
    'urlAr': 'https://legal.example.test/ar/terms/2026-12-01',
    'urlEn': 'https://legal.example.test/en/terms/2026-12-01',
  };
  const conduct = {
    'documentKey': 'code_of_conduct',
    'version': '2026-12-01',
    'urlAr': 'https://legal.example.test/ar/conduct/2026-12-01',
    'urlEn': 'https://legal.example.test/en/conduct/2026-12-01',
  };

  group('LegalStatus.fromBody', () {
    test('no legal field at all (the API before ENG-10): null -- no gate', () {
      expect(LegalStatus.fromBody(const {'actorId': 'a1', 'kind': 'contact'}), isNull);
      expect(LegalStatus.fromBody(null), isNull);
    });

    test('accepted', () {
      final legal = LegalStatus.fromBody(const {
        'legal': {'state': 'accepted', 'required': [], 'unavailable': []},
      })!;
      expect(legal.state, LegalState.accepted);
      expect(legal.holdsApp, isFalse);
      expect(legal.required, isEmpty);
    });

    test('required: every document, in the server order, with both URLs', () {
      final legal = LegalStatus.fromBody(const {
        'legal': {
          'state': 'required',
          'required': [terms, conduct],
          'unavailable': [],
        },
      })!;
      expect(legal.state, LegalState.required);
      expect(legal.holdsApp, isTrue);
      expect(legal.required.map((d) => d.documentKey), ['terms_family', 'code_of_conduct']);
      expect(legal.required.first.version, '2026-12-01');
      expect(legal.required.first.urlFor('ar'), Uri.parse(terms['urlAr']!));
      expect(legal.required.first.urlFor('en'), Uri.parse(terms['urlEn']!));
      expect(legal.required.first.toAcceptance(), {'documentKey': 'terms_family', 'version': '2026-12-01'});
    });

    test('unavailable: never accepted, and it names what the server could not decide', () {
      final legal = LegalStatus.fromBody(const {
        'legal': {
          'state': 'unavailable',
          'required': [],
          'unavailable': ['terms_teacher'],
        },
      })!;
      expect(legal.state, LegalState.unavailable);
      expect(legal.holdsApp, isTrue);
      expect(legal.unavailable, ['terms_teacher']);
    });

    // Fail closed: anything this build cannot read is "unavailable", never "accepted".
    for (final (name, raw) in <(String, Object?)>[
      ('null', null),
      ('a string', 'accepted'),
      ('an unknown state', {'state': 'maybe', 'required': [], 'unavailable': []}),
      ('no state', {'required': [], 'unavailable': []}),
      ('required with nothing listed', {'state': 'required', 'required': [], 'unavailable': []}),
      ('required that is not a list', {'state': 'required', 'required': 'terms', 'unavailable': []}),
      (
        'a document without a version',
        {
          'state': 'required',
          'required': [
            {'documentKey': 'terms_family', 'urlAr': 'https://a.test/ar', 'urlEn': 'https://a.test/en'},
          ],
          'unavailable': [],
        }
      ),
      (
        'a document whose URL is not https',
        {
          'state': 'required',
          'required': [
            {...terms, 'urlEn': 'http://legal.example.test/en/terms'},
          ],
          'unavailable': [],
        }
      ),
      (
        'one good document and one broken one',
        {
          'state': 'required',
          'required': [
            terms,
            {'documentKey': 'code_of_conduct', 'version': 7, 'urlAr': 'https://a.test', 'urlEn': 'https://a.test'},
          ],
          'unavailable': [],
        }
      ),
    ]) {
      test('$name: unavailable', () {
        final legal = LegalStatus.fromBody({'legal': raw})!;
        expect(legal.state, LegalState.unavailable);
        expect(legal.holdsApp, isTrue);
      });
    }

    test('"accepted" that still lists documents: required (the list wins, fail closed)', () {
      final legal = LegalStatus.fromBody(const {
        'legal': {
          'state': 'accepted',
          'required': [terms],
          'unavailable': [],
        },
      })!;
      expect(legal.state, LegalState.required);
      expect(legal.required.single.documentKey, 'terms_family');
    });

    test('"accepted" that names an unavailable document: unavailable (it wins)', () {
      final legal = LegalStatus.fromBody(const {
        'legal': {
          'state': 'accepted',
          'required': [],
          'unavailable': ['code_of_conduct'],
        },
      })!;
      expect(legal.state, LegalState.unavailable);
    });
  });

  group('the identity and the token pair carry it', () {
    Map<String, Object?> actor({Object? legal, bool withLegal = true}) => {
          'actorId': 'contact-1',
          'kind': 'contact',
          'displayName': 'Umm Yusuf',
          if (withLegal) 'legal': legal,
        };

    test('GET /me without legal: the principal has none', () {
      expect(HttpAuthRepository.principalFrom(actor(withLegal: false)).legal, isNull);
    });

    test('GET /me with legal: the principal holds it', () {
      final principal = HttpAuthRepository.principalFrom(actor(legal: {
        'state': 'required',
        'required': [terms, conduct],
        'unavailable': [],
      }));
      expect(principal.legal?.state, LegalState.required);
      expect(principal.legal?.required, hasLength(2));
    });

    test('the token pair: the top-level block', () {
      final session = HttpAuthRepository.sessionFrom({
        'accessToken': 'a',
        'refreshToken': 'r',
        'expiresIn': 900,
        'legal': {'state': 'accepted', 'required': [], 'unavailable': []},
        'actor': actor(legal: {'state': 'accepted', 'required': [], 'unavailable': []}),
      });
      expect(session.legal?.state, LegalState.accepted);
    });

    test('the token pair: actor.legal when the top level has none', () {
      final session = HttpAuthRepository.sessionFrom({
        'accessToken': 'a',
        'refreshToken': 'r',
        'expiresIn': 900,
        'actor': actor(legal: {
          'state': 'required',
          'required': [conduct],
          'unavailable': [],
        }),
      });
      expect(session.legal?.state, LegalState.required);
      expect(session.legal?.required.single.documentKey, 'code_of_conduct');
    });

    test('the token pair of the API before ENG-10: no legal', () {
      final session = HttpAuthRepository.sessionFrom({
        'accessToken': 'a',
        'refreshToken': 'r',
        'expiresIn': 900,
        'actor': actor(withLegal: false),
      });
      expect(session.legal, isNull);
    });

    test('AuthUser.withLegal keeps everything else', () {
      final principal = HttpAuthRepository.principalFrom(actor(withLegal: false));
      final next = principal.withLegal(LegalStatus.acceptedStatus);
      expect(next.id, principal.id);
      expect(next.role, principal.role);
      expect(next.displayName, principal.displayName);
      expect(next.legal?.state, LegalState.accepted);
    });
  });

  group('client', () {
    test('android, ios and the teacher web portal; nothing else is claimed', () {
      expect(legalClientFor(isWeb: false, platform: TargetPlatform.android), 'android');
      expect(legalClientFor(isWeb: false, platform: TargetPlatform.iOS), 'ios');
      expect(legalClientFor(isWeb: true, platform: TargetPlatform.android), 'web_portal');
      expect(legalClientFor(isWeb: true, platform: TargetPlatform.macOS), 'web_portal');
      expect(legalClientFor(isWeb: false, platform: TargetPlatform.macOS), isNull);
      expect(legalClientFor(isWeb: false, platform: TargetPlatform.windows), isNull);
    });
  });
}
