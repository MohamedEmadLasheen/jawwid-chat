import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_moderation_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/moderation/data/moderation_repository.dart';

import 'test_server.dart';

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-57 §5.4 over the real HTTP transport: the paths, the exact bodies, the status-code
/// meaning of 201 vs 200, and the error codes. The server is scripted, so this proves the
/// client's half of the contract and nothing about the backend.
void main() {
  late TestServer server;
  late HttpModerationRepository repository;

  setUp(() async {
    server = await TestServer.start();
    repository = HttpModerationRepository(
      client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _StaticToken()),
    );
  });

  tearDown(() async => server.stop());

  group('POST /reports', () {
    test('a message report sends exactly targetKind, messageId, reason and the trimmed note', () async {
      server.on('POST', '/reports', [
        const Reply(201, {'id': 'r1', 'status': 'open', 'dueAt': '2026-11-06T10:00:00.000Z'}),
      ]);

      final receipt = await repository.submit(
        const ReportDraft(target: MessageReportTarget('m1'), reason: ReportReason.other, note: '  Rude.  '),
      );

      final request = server.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/reports');
      expect(request.json, {'targetKind': 'message', 'messageId': 'm1', 'reason': 'other', 'note': 'Rude.'});
      expect(receipt.id, 'r1');
      expect(receipt.status, 'open');
      expect(receipt.dueAt?.toUtc(), DateTime.utc(2026, 11, 6, 10));
      expect(receipt.alreadyOpen, isFalse);
    });

    test('a person report sends the subject {kind, id} and no messageId, and omits a blank note', () async {
      server.on('POST', '/reports', [const Reply(201, {'id': 'r2', 'status': 'open', 'dueAt': null})]);

      await repository.submit(
        const ReportDraft(
          target: PersonReportTarget(kind: 'teacher', id: 'a9'),
          reason: ReportReason.childSafety,
          note: '   ',
        ),
      );

      expect(server.requests.single.json, {
        'targetKind': 'person',
        'subject': {'kind': 'teacher', 'id': 'a9'},
        'reason': 'child_safety',
      });
    });

    test('200 means the same report is already open', () async {
      server.on('POST', '/reports', [const Reply(200, {'id': 'r1', 'status': 'in_review', 'dueAt': '2026-11-06T10:00:00.000Z'})]);

      final receipt = await repository.submit(
        const ReportDraft(target: MessageReportTarget('m1'), reason: ReportReason.spam),
      );

      expect(receipt.alreadyOpen, isTrue);
      expect(receipt.id, 'r1');
    });

    test('the contract error codes reach the caller with their kind', () async {
      Future<AppError> refused(int status, String code) async {
        server.on('POST', '/reports', [Reply.commError(status, code)]);
        try {
          await repository.submit(const ReportDraft(target: MessageReportTarget('m1'), reason: ReportReason.spam));
        } on AppError catch (e) {
          return e;
        }
        fail('expected a refusal');
      }

      final notVisible = await refused(404, ModerationErrors.targetNotVisible);
      expect((notVisible.kind, notVisible.code), (AppErrorKind.notFound, ModerationErrors.targetNotVisible));
      final self = await refused(400, ModerationErrors.self);
      expect(self.code, ModerationErrors.self);
      final noteRequired = await refused(400, ModerationErrors.noteRequired);
      expect(noteRequired.code, ModerationErrors.noteRequired);
      final limited = await refused(429, ModerationErrors.rateLimited);
      expect(limited.kind, AppErrorKind.rateLimited);
      final terms = await refused(403, ModerationErrors.termsNotAccepted);
      expect(terms.code, ModerationErrors.termsNotAccepted);
    });
  });

  group('GET /me/reports', () {
    test('asks the published path and reads status and answer, newest first', () async {
      server.on('GET', '/me/reports', [
        const Reply.ok([
          {
            'id': 'r1',
            'targetKind': 'message',
            'reason': 'spam',
            'status': 'actioned',
            'createdAt': '2026-11-01T08:00:00.000Z',
            'answer': {'text': 'We removed it.', 'at': '2026-11-02T08:00:00.000Z'},
          },
          {'id': 'r2', 'targetKind': 'person', 'reason': 'blocked', 'status': 'in_review', 'createdAt': '2026-11-03T08:00:00.000Z'},
          {'targetKind': 'message', 'reason': 'spam', 'status': 'open', 'createdAt': '2026-11-03T08:00:00.000Z'},
        ]),
      ]);

      final reports = await repository.mine();

      expect(server.requests.single.method, 'GET');
      expect(server.requests.single.path, '/me/reports');
      expect(reports.map((r) => r.id), ['r2', 'r1'], reason: 'a row without an id is dropped; newest first');
      expect(reports[0].reason, isNull, reason: 'server-only reasons are not invented');
      expect(reports[0].status, ReportStatus.inReview);
      expect(reports[0].answer, isNull);
      expect(reports[1].reason, ReportReason.spam);
      expect(reports[1].answer?.text, 'We removed it.');
      expect(reports[1].answer?.at?.toUtc(), DateTime.utc(2026, 11, 2, 8));
    });
  });
}
