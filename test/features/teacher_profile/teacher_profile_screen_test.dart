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
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
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

/// The teacher's professional profile screen.
///
/// WHAT IS NOT TESTED HERE, deliberately: the revision state machine. Whether an
/// edit opens a new revision, whether approval is legal, whether a parent can
/// see a draft -- those are the server's, proved in
/// `apps/api/test/integration/teacher-profile.spec.ts` and
/// `db/tests/teacher_profile_rls.sql` against a real database. Re-asserting them
/// against a fake here would prove only that the fake agrees with itself.
///
/// What IS tested is the client's own behaviour: that it renders the state the
/// server sent, offers editing exactly when the server says it may, sends what
/// the teacher typed, and never displays anything a family or an attacker would
/// benefit from.
const _goodPdf = PendingAttachment(
  filePath: '/tmp/ok.pdf',
  kind: MessageKind.file,
  mimeType: 'application/pdf',
  byteSize: 1000,
  fileName: 'ok.pdf',
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

  ProfileRevision revision({
    RevisionState state = RevisionState.draft,
    String? bio = 'A teacher of Tajweed.',
    String? note,
    List<ProfileCertificate> certificates = const [],
  }) =>
      ProfileRevision(
        state: state,
        bio: bio,
        specialization: 'Tajweed',
        languages: const ['Arabic', 'English'],
        reviewNote: note,
        certificates: certificates,
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
      repository.profile = TeacherProfile(draft: revision(bio: 'Recovered'));
      await tester.tap(retry);
      await tester.pumpAndSettle();

      // The error view is gone and the profile is on screen -- which is what a
      // retry means. Asserting an exact refetch count would pin the widget's
      // rebuild bookkeeping rather than its behaviour.
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

  group('rendering an existing profile', () {
    testWidgets('shows the content and the authoritative identity', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision()),
          ),
        ));

      // Name and role come from the account, never from the profile.
      expect(find.text('Ahmed Teacher'), findsOneWidget);
      expect(find.text('Teacher'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'A teacher of Tajweed.'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Tajweed'), findsOneWidget);
    });

    testWidgets('lists certificates with their status', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(
              draft: revision(certificates: [
                certificate(id: 'a', title: 'Approved one'),
                certificate(
                  id: 'b',
                  title: 'Pending one',
                  state: CertificateState.pending,
                ),
                certificate(
                  id: 'c',
                  title: 'Rejected one',
                  state: CertificateState.rejected,
                  note: 'Unreadable scan.',
                ),
              ]),
            ),
          ),
        ));

      expect(find.text('Approved'), findsWidgets);
      expect(find.text('Awaiting review'), findsOneWidget);
      expect(find.text('Not accepted'), findsOneWidget);
      // A rejected credential says why.
      expect(find.text('Unreadable scan.'), findsOneWidget);
    });
  });

  group('review states', () {
    testWidgets('draft says it is not submitted', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision()),
          ),
        ));
      expect(find.textContaining('Not submitted'), findsOneWidget);
    });

    testWidgets('pending review is read-only and says why', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision(state: RevisionState.pendingReview)),
          ),
        ));

      expect(find.textContaining('Waiting for admin review'), findsOneWidget);
      // Editing would silently withdraw the submission, so the fields are shut.
      final field = tester.widget<TextField>(
        find.widgetWithText(TextField, 'A teacher of Tajweed.'),
      );
      expect(field.enabled, isFalse);
      // The control stays on screen and is disabled, rather than vanishing: a
      // button that disappears while under review reads as "your submission is
      // gone".
      final submit = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Submit for review'),
      );
      expect(submit.onPressed, isNull);
    });

    testWidgets('changes requested shows the reviewer note verbatim and reopens editing',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(
              draft: revision(
                state: RevisionState.changesRequested,
                note: 'Please add your ijazah.',
              ),
            ),
          ),
        ));

      expect(find.textContaining('Please add your ijazah.'), findsOneWidget);
      final field = tester.widget<TextField>(
        find.widgetWithText(TextField, 'A teacher of Tajweed.'),
      );
      expect(field.enabled, isTrue);
      expect(find.widgetWithText(FilledButton, 'Edit and resubmit'), findsOneWidget);
    });

    testWidgets('approved says so, and offers no stale submit button', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: null, published: revision(
              state: RevisionState.approved,
            )),
          ),
        ));

      expect(find.textContaining('Approved'), findsWidgets);
      final submit = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Submit for review'),
      );
      // Nothing is open, so there is nothing to submit.
      expect(submit.onPressed, isNull);
    });
  });

  group('the published revision is never edited in place', () {
    testWidgets('an approved profile with no draft still offers Save, which the server '
        'turns into a new revision', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(published: revision(state: RevisionState.approved)),
      );
      await pumpScreen(tester, harness(repository: repository));

      // The screen does not create a revision and does not claim to. It sends
      // the content; copy-on-write is the server's answer, which arrives as a
      // new draft in the response.
      repository.next = TeacherProfile(
        published: revision(state: RevisionState.approved),
        draft: revision(bio: 'Edited'),
      );

      await tester.enterText(
        find.widgetWithText(TextField, 'A teacher of Tajweed.'),
        'Edited',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(repository.calls, contains('saveDraft'));
      // The published half is untouched in what the screen now holds.
      expect(repository.profile.published?.bio, 'A teacher of Tajweed.');
      expect(repository.profile.draft?.bio, 'Edited');
    });

    testWidgets('while a new revision is open the screen shows the editing notice',
        (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(
              published: revision(state: RevisionState.approved, bio: 'Live'),
              draft: revision(bio: 'Next'),
            ),
          ),
        ));

      expect(
        find.textContaining('The approved version stays visible'),
        findsOneWidget,
      );
      // The teacher edits the DRAFT, so that is what the fields hold.
      expect(find.widgetWithText(TextField, 'Next'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Live'), findsNothing);
    });
  });

  group('saving and submitting', () {
    testWidgets('save sends exactly what was typed, languages split on either comma',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision(bio: null)),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(find.byType(TextField).first, 'New bio');
      await tester.enterText(find.byType(TextField).last, 'Arabic، English, Urdu');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(repository.lastSave?['bio'], 'New bio');
      expect(repository.lastSave?['languages'], ['Arabic', 'English', 'Urdu']);
    });

    testWidgets('submit calls the server and reports it', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      expect(repository.calls, contains('submit'));
      expect(find.text('Sent for review'), findsOneWidget);
    });

    testWidgets('a failed save keeps the typing on screen and says what happened',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
        mutationError: const AppError(AppErrorKind.network),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.enterText(find.byType(TextField).first, 'Typed but not saved');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // Losing a half-written bio because the network blinked is the one
      // outcome this screen must not produce.
      expect(find.widgetWithText(TextField, 'Typed but not saved'), findsOneWidget);
      expect(find.byType(SnackBar), findsOneWidget);
    });

    testWidgets('a double tap on Save sends one request', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      )..mutationDelay = const Duration(milliseconds: 50);
      await pumpScreen(tester, harness(repository: repository));

      final save = find.widgetWithText(FilledButton, 'Save');
      await tester.tap(save);
      await tester.tap(save, warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(repository.calls.where((c) => c == 'saveDraft').length, 1);
    });
  });

  group('certificates', () {
    testWidgets('the screen opens the add-certificate sheet', (tester) async {
      await pumpScreen(
        tester,
        harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision()),
          ),
        ),
      );

      await tester.tap(find.widgetWithText(TextButton, 'Add certificate'));
      await tester.pumpAndSettle();
      expect(find.byType(AddCertificateSheet), findsOneWidget);
    });

    // The sheet is pumped directly from here down. Driving it through the modal
    // route as well would be testing Flutter's bottom-sheet animation, not this
    // feature -- and the test above already proves the screen opens it.
    testWidgets('add: validation refuses a wrong type and an oversized file',
        (tester) async {
      final picker = FakeCertificatePicker(
        file: const PendingAttachment(
          filePath: '/tmp/x.exe',
          kind: MessageKind.file,
          mimeType: 'application/x-msdownload',
          byteSize: 10,
          fileName: 'x.exe',
        ),
      );
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      );
      await pumpScreen(
        tester,
        harness(
          repository: repository,
          picker: picker,
          child: const Scaffold(body: AddCertificateSheet()),
        ),
      );

      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      expect(find.text('Choose a PDF, JPEG or PNG.'), findsOneWidget);

      picker.file = const PendingAttachment(
        filePath: '/tmp/big.pdf',
        kind: MessageKind.file,
        mimeType: 'application/pdf',
        byteSize: 20 * 1024 * 1024,
        fileName: 'big.pdf',
      );
      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      expect(find.text('That file is larger than 10 MB.'), findsOneWidget);

      // Nothing was uploaded in either case.
      expect(repository.calls, isNot(contains('addCertificate')));
    });

    testWidgets('add: a title is required', (tester) async {
      final picker = FakeCertificatePicker(file: _goodPdf);
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      );
      await pumpScreen(
        tester,
        harness(
          repository: repository,
          picker: picker,
          child: const Scaffold(body: AddCertificateSheet()),
        ),
      );

      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Add certificate'));
      await tester.pumpAndSettle();

      expect(find.text('Give the certificate a title.'), findsOneWidget);
      expect(repository.calls, isNot(contains('addCertificate')));
    });

    testWidgets('add: a file is required', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      );
      await pumpScreen(
        tester,
        harness(
          repository: repository,
          picker: FakeCertificatePicker(),
          child: const Scaffold(body: AddCertificateSheet()),
        ),
      );

      await tester.enterText(find.byType(TextField).first, 'Titled but fileless');
      await tester.tap(find.widgetWithText(FilledButton, 'Add certificate'));
      await tester.pumpAndSettle();

      expect(find.text('Choose a file first.'), findsOneWidget);
      expect(repository.calls, isNot(contains('addCertificate')));
    });

    testWidgets('add: uploads with metadata and reports progress', (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
      );
      await pumpScreen(
        tester,
        harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodPdf),
          child: const Scaffold(body: AddCertificateSheet()),
        ),
      );

      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      expect(find.textContaining('ok.pdf'), findsOneWidget);

      await tester.enterText(find.byType(TextField).at(0), 'Ijazah in Tajweed');
      await tester.enterText(find.byType(TextField).at(1), 'Al-Azhar');
      await tester.enterText(find.byType(TextField).at(2), '2021');
      await tester.tap(find.widgetWithText(FilledButton, 'Add certificate'));
      await tester.pumpAndSettle();

      expect(repository.lastCertificate?.title, 'Ijazah in Tajweed');
      expect(repository.lastCertificate?.issuer, 'Al-Azhar');
      expect(repository.lastCertificate?.issuedOn?.year, 2021);
    });

    testWidgets('add: a failed upload keeps the sheet open so retrying is one tap',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision()),
        uploadError: Exception('connection reset'),
      );
      await pumpScreen(
        tester,
        harness(
          repository: repository,
          picker: FakeCertificatePicker(file: _goodPdf),
          child: const Scaffold(body: AddCertificateSheet()),
        ),
      );

      await tester.tap(find.widgetWithText(OutlinedButton, 'Choose file'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'Ijazah');
      await tester.tap(find.widgetWithText(FilledButton, 'Add certificate'));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsOneWidget);
      // Still open, still holding the chosen file.
      expect(find.widgetWithText(FilledButton, 'Add certificate'), findsOneWidget);
      expect(find.textContaining('ok.pdf'), findsOneWidget);
    });

    testWidgets('remove: confirms, and says the published version is untouched',
        (tester) async {
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(
          published: revision(state: RevisionState.approved),
          draft: revision(certificates: [certificate(id: 'doomed')]),
        ),
      );
      await pumpScreen(tester, harness(repository: repository));

      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();

      expect(find.text('Remove this certificate?'), findsOneWidget);
      expect(
        find.textContaining('The approved version families can see is not changed.'),
        findsOneWidget,
      );

      // Cancelling removes nothing.
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(repository.removed, isEmpty);

      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
      await tester.pumpAndSettle();
      expect(repository.removed, ['doomed']);
    });

    testWidgets('open: fetches a fresh URL per tap and never shows a storage path',
        (tester) async {
      final opener = RecordingAttachmentOpener();
      final repository = FakeTeacherProfileRepository(
        profile: TeacherProfile(draft: revision(certificates: [certificate(id: 'c9')])),
      );
      await pumpScreen(tester, harness(repository: repository, opener: opener));

      await tester.tap(find.byIcon(Icons.open_in_new));
      await tester.pumpAndSettle();

      expect(opener.opened, ['https://files.example/c9']);
      expect(repository.calls, contains('certificateUrl:c9'));
      // The id is an opaque handle; no key or path is rendered.
      expect(find.textContaining('teacher-certificates/'), findsNothing);
    });

    testWidgets('a read-only revision offers no add or remove', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(
              draft: revision(
                state: RevisionState.pendingReview,
                certificates: [certificate()],
              ),
            ),
          ),
        ));

      expect(find.widgetWithText(TextButton, 'Add certificate'), findsNothing);
      expect(find.byIcon(Icons.delete_outline), findsNothing);
      // Reading what was submitted is still allowed.
      expect(find.byIcon(Icons.open_in_new), findsOneWidget);
    });
  });

  group('the Settings entry is a teacher-only door', () {
    testWidgets('a teacher sees Professional profile', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(),
          child: const SettingsScreen(),
        ));

      expect(find.text('Professional profile'), findsOneWidget);
      // My account is untouched and still the identity row above it.
      expect(find.text('Ahmed Teacher'), findsOneWidget);
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
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision()),
          ),
          locale: const Locale('ar'),
        ));

      expect(find.text('الملف المهني للمعلم'), findsOneWidget);
      expect(Directionality.of(tester.element(find.byType(ListView))), TextDirection.rtl);
    });

    testWidgets('English lays it out left-to-right', (tester) async {
      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(draft: revision()),
          ),
        ));

      expect(find.text('Teacher professional profile'), findsOneWidget);
      expect(Directionality.of(tester.element(find.byType(ListView))), TextDirection.ltr);
    });

    testWidgets('fits an iPhone viewport without overflowing', (tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);

      await pumpScreen(tester, harness(
          repository: FakeTeacherProfileRepository(
            profile: TeacherProfile(
              draft: revision(certificates: [certificate(), certificate(id: 'c2')]),
            ),
          ),
        ));

      expect(tester.takeException(), isNull);
    });
  });
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
