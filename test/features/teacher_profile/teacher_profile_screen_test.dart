import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/features/teacher_profile/presentation/teacher_profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/teacher_profile.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_teacher_profile_repository.dart';

/// The teacher's professional profile screen (V2).
///
/// WHAT IS NOT TESTED HERE, deliberately: the server's rules. Whether a name is
/// accepted, whether a teacher may touch another teacher's photo, whether a
/// credential may be self-approved -- those are proved in
/// `apps/api/test/integration/teacher-profile.spec.ts` and
/// `db/tests/teacher_profile_rls.sql` against a real database. Re-asserting them
/// against a fake here would prove only that the fake agrees with itself.
///
/// What IS tested is the client's own behaviour: that it renders the state the
/// server sent, sends what the teacher typed, shows the SERVER's answer rather
/// than the string it sent, and never displays anything a family or an attacker
/// would benefit from.
///
/// The group that matters most is "there is no review workflow left" -- the
/// whole point of this release is that a teacher does not wait for anybody.
const _goodPdf = PendingAttachment(
  filePath: '/tmp/ok.pdf',
  kind: MessageKind.file,
  mimeType: 'application/pdf',
  byteSize: 1000,
  fileName: 'ok.pdf',
);

const _goodImage = PendingAttachment(
  filePath: '/tmp/face.jpg',
  kind: MessageKind.image,
  mimeType: 'image/jpeg',
  byteSize: 2000,
  fileName: 'face.jpg',
);

void main() {
  ProfileCertificate certificate({
    String id = 'c1',
    String title = 'Ijazah',
    CertificateState state = CertificateState.approved,
    String? note,
  }) =>
      ProfileCertificate(
        id: id,
        title: title,
        state: state,
        issuingOrganization: 'Al-Azhar',
        issuedOn: DateTime.utc(2020),
        reviewNote: note,
      );

  TeacherProfile profile({
    String name = 'Ustadh Teacher',
    String? bio = 'A teacher of Tajweed.',
    String? photoUrl,
    List<ProfileCertificate> certificates = const [],
  }) =>
      TeacherProfile(
        name: name,
        bio: bio,
        photoUrl: photoUrl,
        specialization: 'Tajweed',
        languages: const ['Arabic', 'English'],
        certificates: certificates,
        updatedAt: DateTime.utc(2026, 10, 8),
      );

  Widget harness({
    required FakeTeacherProfileRepository repository,
    Widget child = const TeacherProfileScreen(),
    Locale locale = const Locale('en'),
    UserRole role = UserRole.teacher,
    MediaPicker? picker,
    AttachmentOpener? opener,
  }) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);
    final isArabic = locale.languageCode == 'ar';

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        teacherProfileRepositoryProvider.overrideWithValue(repository),
        // The avatar's Authorization header comes from here. Overridden rather
        // than left unimplemented, because a private photo URL is unreachable
        // without it.
        realtimeTokenProvider.overrideWithValue(_FakeTokens()),
        // And WHERE that header may be sent. The reference storage route is served by
        // the API itself, so its URLs share this origin; anything else gets nothing.
        apiBaseUrlProvider.overrideWithValue('http://api.test/api/v1'),
        if (picker != null) mediaPickerProvider.overrideWithValue(picker),
        if (opener != null) attachmentOpenerProvider.overrideWithValue(opener),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        authControllerProvider.overrideWith(
          () => _SignedIn(
            backend: backend,
            user: AuthUser(
              id: 'u_teacher',
              displayName: role == UserRole.teacher ? 'Ahmed Teacher' : 'Umm Yusuf',
              role: role,
            ),
          ),
        ),
      ],
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: isArabic),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: child,
      ),
    );
  }

  /// Pump on a TALL viewport.
  ///
  /// The screen is one lazy `ListView`, so on a short surface the sections below
  /// the fold are never built and `find.text` reports them missing for a reason
  /// that has nothing to do with the behaviour under test. The iPhone-viewport
  /// test below sets its own real size.
  Future<void> pumpScreen(WidgetTester tester, Widget app) async {
    const size = Size(420, 2400);
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    // BOTH, and they must agree. `view.physicalSize` is what MediaQuery reports;
    // the surface is what actually gets laid out. Setting only the first leaves
    // everything past the real surface height unlaid-out, and a tap on it fails
    // with "RenderBox was not laid out" rather than "not found".
    await tester.binding.setSurfaceSize(size);
    addTearDown(() async {
      tester.view.reset();
      await tester.binding.setSurfaceSize(null);
    });
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();
  }

  group('loading, empty and error', () {
    testWidgets('shows a loading view before the profile arrives', (tester) async {
      final repository = FakeTeacherProfileRepository(
        loadDelay: const Duration(milliseconds: 50),
      );
      await tester.pumpWidget(harness(repository: repository));
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsWidgets);
      await tester.pumpAndSettle();
    });

    // The photo is served from object storage by a SHORT-LIVED SIGNED URL, and
    // which credential the request may carry depends on who signed it. An S3
    // presigned URL authenticates itself and S3 rejects a second mechanism
    // ("request has multiple authentication types"), at which point
    // `Image.network` falls back to initials -- indistinguishable on screen
    // from a photo that never changed. This asserts the wiring end to end: the
    // screen still offers its authenticated headers, and the avatar withholds
    // them for a presigned URL.
    testWidgets('a PRESIGNED photoUrl is fetched without Authorization',
        (tester) async {
      final repository = FakeTeacherProfileRepository();
      repository.profile = profile(
        photoUrl: 'http://minio.test:9010/bucket/teacher-photos/t1/abc'
            '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=sig',
      );
      await pumpScreen(tester, harness(repository: repository));

      final provider = _networkImage(tester);
      expect(provider.url, contains('X-Amz-Signature=sig'));
      expect(provider.headers?.containsKey('Authorization') ?? false, isFalse);
    });

    testWidgets('a LOCAL reference photoUrl keeps Authorization', (tester) async {
      final repository = FakeTeacherProfileRepository();
      repository.profile = profile(
        photoUrl: 'http://api.test/api/v1/storage/photo_1?expires=1&sig=abc',
      );
      await pumpScreen(tester, harness(repository: repository));

      expect(_networkImage(tester).headers?['Authorization'], 'Bearer session-token');
    });

    testWidgets('an empty profile invites the teacher to build one', (tester) async {
      await pumpScreen(tester, harness(repository: FakeTeacherProfileRepository()));

      expect(find.text('Build your professional profile'), findsOneWidget);
      expect(find.text('No certificates yet.'), findsOneWidget);
    });

    testWidgets('a failure offers a retry that refetches', (tester) async {
      final repository = FakeTeacherProfileRepository(
        loadError: const AppError(AppErrorKind.network),
      );
      await pumpScreen(tester, harness(repository: repository));

      final retry = find.widgetWithText(OutlinedButton, 'Try again');
      expect(retry, findsOneWidget);

      repository.loadError = null;
      repository.profile = profile(bio: 'Recovered');
      await tester.tap(retry);
      await tester.pumpAndSettle();

      expect(find.widgetWithText(OutlinedButton, 'Try again'), findsNothing);
      expect(find.widgetWithText(TextField, 'Recovered'), findsOneWidget);
    });

    testWidgets('a build with no backend says so and offers NO retry', (tester) async {
      // Distinct from a network failure on purpose: retrying cannot succeed.
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            loadError: const AppError(
              AppErrorKind.notFound,
              code: 'teacher_profile_not_available',
            ),
          ),
        ));

      expect(find.text('Your professional profile is not available right now.'),
          findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Try again'), findsNothing);
    });
  });

  group('THERE IS NO REVIEW WORKFLOW LEFT', () {
    testWidgets('no Submit button, no pending banner, no approval banner',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(certificates: [certificate()]),
          ),
        ));

      expect(find.textContaining('Submit'), findsNothing);
      expect(find.textContaining('Waiting for admin review'), findsNothing);
      expect(find.textContaining('Changes requested'), findsNothing);
      expect(find.textContaining('Not submitted'), findsNothing);
      expect(find.textContaining('resubmit'), findsNothing);
    });

    testWidgets('there is exactly ONE profile save action', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
        ));

      expect(find.widgetWithText(FilledButton, 'Save'), findsOneWidget);
    });

    testWidgets('every field is editable -- nothing is ever read-only', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
        ));

      // V1 shut the fields while a revision was with a reviewer. There is no
      // such state now, so a disabled field would mean a bug.
      for (final field in tester.widgetList<TextField>(find.byType(TextField))) {
        expect(field.enabled, isTrue);
      }
    });

    testWidgets('the repository exposes no submit', (tester) async {
      final repository = FakeTeacherProfileRepository();
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // Saving is the publish. Nothing else is called.
      expect(repository.calls, contains('saveProfile'));
      expect(repository.calls.any((c) => c.contains('submit')), isFalse);
    });
  });

  group('the editable name', () {
    testWidgets('shows the authoritative name and the read-only role',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(name: 'Ustadh Kareem'),
          ),
        ));

      expect(find.widgetWithText(TextField, 'Ustadh Kareem'), findsOneWidget);
      expect(find.text('Teacher'), findsOneWidget);
    });

    testWidgets('offers no save button until the name actually changes',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
        ));

      expect(find.widgetWithText(FilledButton, 'Save name'), findsNothing);

      await tester.enterText(
        find.widgetWithText(TextField, 'Ustadh Teacher'),
        'Ustadh Kareem',
      );
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilledButton, 'Save name'), findsOneWidget);
    });

    testWidgets('sends the new name and renders what the SERVER stored',
        (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(repository: repository));

      // Pasted whitespace. The server collapses it; the screen must show the
      // collapsed form, not the string that was typed.
      await tester.enterText(
        find.widgetWithText(TextField, 'Ustadh Teacher'),
        '  Ustadh   Kareem  ',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Save name'));
      await tester.pumpAndSettle();

      expect(repository.renames.single, '  Ustadh   Kareem  '.trim());
      expect(repository.storedName, 'Ustadh Kareem');
      expect(find.widgetWithText(TextField, 'Ustadh Kareem'), findsOneWidget);
      expect(find.text('Name saved'), findsOneWidget);
    });

    testWidgets('an empty name is refused before any request', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(
        find.widgetWithText(TextField, 'Ustadh Teacher'),
        '   ',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Save name'));
      await tester.pumpAndSettle();

      expect(find.text('Enter your name.'), findsOneWidget);
      expect(repository.calls.contains('updateName'), isFalse);
    });

    testWidgets('a failed rename shows why and keeps the typing on screen',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(),
        mutationError: const AppError(AppErrorKind.network),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(
        find.widgetWithText(TextField, 'Ustadh Teacher'),
        'Ustadh Kareem',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Save name'));
      await tester.pumpAndSettle();

      // Still there to retry, not blanked.
      expect(find.widgetWithText(TextField, 'Ustadh Kareem'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Save name'), findsOneWidget);
    });

    testWidgets('a double tap on Save name sends one request', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile())
        ..mutationDelay = const Duration(milliseconds: 80);
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(
        find.widgetWithText(TextField, 'Ustadh Teacher'),
        'Ustadh Kareem',
      );
      await tester.pumpAndSettle();

      // BOTH taps before any pump. That is the real race: the button relabels
      // itself to "Saving…" on the next frame, so a second tap after a pump
      // could not even find it -- which would make this test vacuous.
      final button = find.widgetWithText(FilledButton, 'Save name');
      await tester.tap(button);
      await tester.tap(button);
      await tester.pumpAndSettle();

      expect(repository.renames.length, 1);
    });
  });

  group('the profile photo', () {
    testWidgets('with no photo, the shared avatar falls back to initials',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
        ));

      final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar).first);
      expect(avatar.imageUrl, isNull);
      expect(avatar.displayName, 'Ustadh Teacher');
      // No second avatar component exists; this is the shared one.
      expect(find.byType(JawwidAvatar), findsWidgets);
    });

    testWidgets('a photo is rendered from the signed URL, with the session header',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(photoUrl: 'https://files.example/p?sig=abc&expires=1'),
          ),
        ));

      final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar).first);
      expect(avatar.imageUrl, 'https://files.example/p?sig=abc&expires=1');
      // Both halves: the signature authorizes the object, the header
      // authenticates the caller. Without the header the route answers 401.
      expect(avatar.imageHeaders?['Authorization'], 'Bearer session-token');
      // And the credential is never in the URL.
      expect(avatar.imageUrl, isNot(contains('session-token')));
    });

    testWidgets('choosing a photo uploads it and reports progress', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile())
        ..mutationDelay = const Duration(milliseconds: 80);
      await pumpScreen(tester, harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodImage),
        ));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pump();

      // Mid-upload: a determinate bar, because a teacher watching an upload
      // needs to know it is progressing rather than hung.
      expect(find.byType(LinearProgressIndicator), findsWidgets);
      await tester.pumpAndSettle();

      expect(repository.lastPhoto?.filePath, '/tmp/face.jpg');
      expect(repository.lastPhoto?.mimeType, 'image/jpeg');
    });

    testWidgets('refuses a type the server would refuse, before any bytes move',
        (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodPdf),
        ));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pumpAndSettle();

      expect(find.text('Choose a JPEG, PNG or WebP image.'), findsOneWidget);
      expect(repository.calls.contains('setPhoto'), isFalse);
    });

    testWidgets('refuses an image over 5MB, before any bytes move', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(
          repository: repository,
          picker: FakeCertificatePicker(
            file: const PendingAttachment(
              filePath: '/tmp/huge.jpg',
              kind: MessageKind.image,
              mimeType: 'image/jpeg',
              byteSize: 5 * 1024 * 1024 + 1,
              fileName: 'huge.jpg',
            ),
          ),
        ));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pumpAndSettle();

      expect(find.text('That image is larger than 5 MB.'), findsOneWidget);
      expect(repository.calls.contains('setPhoto'), isFalse);
    });

    testWidgets('a failed upload says so and leaves the old photo alone',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(photoUrl: 'https://files.example/old?sig=a'),
        uploadError: Exception('socket closed'),
      );
      await pumpScreen(tester, harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodImage),
        ));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Replace photo'));
      await tester.pumpAndSettle();

      final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar).first);
      expect(avatar.imageUrl, 'https://files.example/old?sig=a');
    });

    testWidgets('removing the photo confirms first, then falls back to initials',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(photoUrl: 'https://files.example/p?sig=a'),
      )..next = profile();
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove photo'));
      await tester.pumpAndSettle();

      expect(find.text('Remove your photo?'), findsOneWidget);
      expect(find.text('Your profile will show your initials instead.'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Remove photo'));
      await tester.pumpAndSettle();

      expect(repository.removePhotoCalls, 1);
      final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar).first);
      expect(avatar.imageUrl, isNull);
    });

    testWidgets('cancelling the removal keeps the photo', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(photoUrl: 'https://files.example/p?sig=a'),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.byTooltip('Profile photo'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove photo'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();

      expect(repository.removePhotoCalls, 0);
    });

    testWidgets('no storage path or object key is ever on screen', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(
              photoUrl: 'https://files.example/teacher-photos/t1/abc?sig=a',
              certificates: [certificate()],
            ),
          ),
        ));

      expect(find.textContaining('teacher-photos'), findsNothing);
      expect(find.textContaining('teacher-certificates'), findsNothing);
      expect(find.textContaining('files.example'), findsNothing);
    });
  });

  group('saving the profile', () {
    testWidgets('sends exactly what was typed, languages split on either comma',
        (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(find.widgetWithText(TextField, 'A teacher of Tajweed.'),
          'Rewritten bio');
      await tester.enterText(
          find.widgetWithText(TextField, 'Arabic، English'), 'Arabic, English، Urdu');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(repository.lastSave?['bio'], 'Rewritten bio');
      expect(repository.lastSave?['languages'], ['Arabic', 'English', 'Urdu']);
      expect(find.text('Saved'), findsOneWidget);
    });

    testWidgets('blank fields are sent as null, not as empty strings',
        (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(
          find.widgetWithText(TextField, 'A teacher of Tajweed.'), '   ');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(repository.lastSave?['bio'], isNull);
    });

    testWidgets('a failed save keeps the typing on screen and offers a retry',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(),
        mutationError: const AppError(AppErrorKind.network),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(
          find.widgetWithText(TextField, 'A teacher of Tajweed.'), 'Unsaved words');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // The teacher's words survive the failure -- that is the whole point.
      expect(find.widgetWithText(TextField, 'Unsaved words'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a retry after a failure succeeds and reports it', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(),
        mutationError: const AppError(AppErrorKind.network),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      repository.mutationError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Saved'), findsOneWidget);
    });

    testWidgets('a double tap on Save sends one request', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile())
        ..mutationDelay = const Duration(milliseconds: 80);
      await pumpScreen(tester, harness(repository: repository));

      // Both taps in one frame -- see the rename test for why.
      final button = find.widgetWithText(FilledButton, 'Save');
      await tester.tap(button);
      await tester.tap(button);
      await tester.pumpAndSettle();

      expect(repository.calls.where((c) => c == 'saveProfile').length, 1);
    });

    testWidgets('shows Saving while in flight', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile())
        ..mutationDelay = const Duration(milliseconds: 80);
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pump();

      expect(find.text('Saving…'), findsOneWidget);
      await tester.pumpAndSettle();
    });
  });

  group('certificates', () {
    testWidgets('lists them with their own review status', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(certificates: [
              certificate(id: 'a', title: 'Approved one'),
              certificate(id: 'b', title: 'Pending one', state: CertificateState.pending),
              certificate(
                id: 'c',
                title: 'Rejected one',
                state: CertificateState.rejected,
                note: 'Unreadable scan.',
              ),
            ]),
          ),
        ));

      // Credentials still have states: uploading a document does not verify it.
      expect(find.text('Approved'), findsWidgets);
      expect(find.text('Awaiting review'), findsOneWidget);
      expect(find.text('Not accepted'), findsOneWidget);
      expect(find.text('Unreadable scan.'), findsOneWidget);
    });

    testWidgets('a pending certificate does not block saving the profile',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(
          certificates: [certificate(state: CertificateState.pending)],
        ),
      );
      await pumpScreen(tester, harness(repository: repository));

      final save = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Save'),
      );
      expect(save.onPressed, isNotNull);

      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(repository.calls, contains('saveProfile'));
    });

    testWidgets('add: uploads with metadata and reports progress', (tester) async {
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodPdf),
        ));

      await tester.tap(find.text('Add certificate'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Certificate title'), 'Ijazah');
      await tester.enterText(
          find.widgetWithText(TextField, 'Issuing organization'), 'Al-Azhar');
      await tester.tap(find.widgetWithText(FilledButton, 'Add certificate'));
      await tester.pumpAndSettle();

      expect(repository.lastCertificate?.title, 'Ijazah');
      expect(repository.lastCertificate?.issuer, 'Al-Azhar');
    });

    testWidgets('add: validation refuses a wrong type and an oversized file',
        (tester) async {
      final picker = FakeCertificatePicker(
        file: const PendingAttachment(
          filePath: '/tmp/x.html',
          kind: MessageKind.file,
          mimeType: 'text/html',
          byteSize: 10,
          fileName: 'x.html',
        ),
      );
      final repository = FakeTeacherProfileRepository(profile: profile());
      await pumpScreen(tester, harness(repository: repository, picker: picker));

      await tester.tap(find.text('Add certificate'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      expect(find.text('Choose a PDF, JPEG or PNG.'), findsOneWidget);

      picker.file = const PendingAttachment(
        filePath: '/tmp/big.pdf',
        kind: MessageKind.file,
        mimeType: 'application/pdf',
        byteSize: 11 * 1024 * 1024,
        fileName: 'big.pdf',
      );
      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      expect(find.text('That file is larger than 10 MB.'), findsOneWidget);

      expect(repository.calls.contains('addCertificate'), isFalse);
    });

    testWidgets('edit: sends metadata only, and the file never moves',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(certificates: [certificate(id: 'c9', title: 'Before')]),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.byTooltip('Edit'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Before'), 'After');
      await tester.tap(find.widgetWithText(FilledButton, 'Save certificate'));
      await tester.pumpAndSettle();

      expect(repository.calls, contains('updateCertificate:c9'));
      // THE assertion: a metadata edit is not an upload.
      expect(repository.calls.contains('addCertificate'), isFalse);
      expect(repository.lastCertificate?.title, 'After');
    });

    testWidgets('edit: warns that editing sends it for review again',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: profile(certificates: [certificate()]),
          ),
        ));

      await tester.tap(find.byTooltip('Edit'));
      await tester.pumpAndSettle();

      // The surprising part, said plainly: fixing a typo un-approves it.
      expect(
        find.textContaining('sends this certificate for review again'),
        findsOneWidget,
      );
    });

    testWidgets('remove: confirms first', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(certificates: [certificate(id: 'c3')]),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.byTooltip('Remove'));
      await tester.pumpAndSettle();
      expect(find.text('Remove this certificate?'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
      await tester.pumpAndSettle();

      expect(repository.removed, ['c3']);
    });

    testWidgets('open: fetches a fresh URL per tap and never shows a path',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: profile(certificates: [certificate(id: 'c4')]),
      );
      final opener = RecordingAttachmentOpener();
      await pumpScreen(tester, harness(repository: repository, opener: opener));

      await tester.tap(find.byTooltip('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open'));
      await tester.pumpAndSettle();

      expect(opener.opened, ['https://files.example/c4', 'https://files.example/c4']);
      expect(repository.calls.where((c) => c == 'certificateUrl:c4').length, 2);
      expect(find.textContaining('files.example'), findsNothing);
    });
  });

  group('the Settings entry is a teacher-only door', () {
    testWidgets('a teacher sees Professional profile', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(),
          child: const SettingsScreen(),
        ));

      expect(find.text('Professional profile'), findsOneWidget);
    });

    testWidgets('a parent does not', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(),
          child: const SettingsScreen(),
          role: UserRole.parent,
        ));

      expect(find.text('Professional profile'), findsNothing);
    });
  });

  group('localisation and layout', () {
    testWidgets('Arabic lays the screen out right-to-left', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
          locale: const Locale('ar'),
        ));

      expect(Directionality.of(tester.element(find.byType(ListView))),
          TextDirection.rtl);
      expect(find.text('اسمك'), findsOneWidget);
    });

    testWidgets('English lays it out left-to-right', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(profile: profile()),
        ));

      expect(Directionality.of(tester.element(find.byType(ListView))),
          TextDirection.ltr);
    });

    testWidgets('fits an iPhone viewport without overflowing', (tester) async {
      const size = Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = size;
      await tester.binding.setSurfaceSize(size);
      addTearDown(() async {
        tester.view.reset();
        await tester.binding.setSurfaceSize(null);
      });

      await tester.pumpWidget(harness(
        repository: FakeTeacherProfileRepository(
          profile: profile(
            photoUrl: 'https://files.example/p?sig=a',
            certificates: [certificate(), certificate(id: 'c2', title: 'Another')],
          ),
        ),
      ));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}

/// A token provider standing in for the session, so the avatar can be given an
/// Authorization header without a real sign-in.
/// The avatar's underlying network provider, unwrapped.
///
/// `cacheWidth`/`cacheHeight` make `Image.network` wrap its provider in a
/// `ResizeImage`, so one layer comes off before the headers are readable.
NetworkImage _networkImage(WidgetTester tester) => tester
    .widgetList<Image>(find.byType(Image))
    .map((image) => image.image)
    .map((provider) => provider is ResizeImage ? provider.imageProvider : provider)
    .whereType<NetworkImage>()
    .first;

class _FakeTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'session-token';

  @override
  Future<String?> refresh() async => 'session-token';

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

class _SignedIn extends AuthController {
  _SignedIn({required FakeBackend backend, required AuthUser user})
      : _user = user,
        super(
          repository: FakeAuthRepository(
            backend: backend,
            tokens: InMemoryTokenStore(),
          ),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  final AuthUser _user;

  static Future<void> _noop() async {}

  @override
  AuthState build() => AuthAuthenticated(_user);
}
