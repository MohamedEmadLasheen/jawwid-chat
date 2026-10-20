import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/profile/data/profile_photo_repository.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_photos_section.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

class _Repo implements ProfilePhotoRepository {
  _Repo(this.photos);
  MyPhotos photos;
  final calls = <String>[];

  @override
  bool get isAvailable => true;

  @override
  Future<MyPhotos> mine() async => photos;

  @override
  Future<String?> set(PendingAttachment photo, {String? childId}) async {
    calls.add('set:${childId ?? 'me'}:${photo.mimeType}');
    return 'https://x/new';
  }

  @override
  Future<void> remove({String? childId}) async => calls.add('remove:${childId ?? 'me'}');
}

class _Picker implements MediaPicker {
  @override
  Future<PendingAttachment?> pickImage() async =>
      const PendingAttachment(filePath: '/tmp/p.jpg', kind: MessageKind.image, mimeType: 'image/jpeg', byteSize: 1000);
  @override
  Future<PendingAttachment?> captureImage() async => null;
  @override
  Future<PendingAttachment?> pickFile() async => null;
}

void main() {
  Widget harness(ProfilePhotoRepository repo) => ProviderScope(
        overrides: [
          profilePhotoRepositoryProvider.overrideWithValue(repo),
          mediaPickerProvider.overrideWithValue(_Picker()),
          principalIdProvider.overrideWithValue('me'),
        ],
        child: MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const Scaffold(body: SingleChildScrollView(child: ProfilePhotosSection(displayName: 'Umm Kid'))),
        ),
      );

  testWidgets('a build without a photo server offers nothing', (tester) async {
    await tester.pumpWidget(harness(const NoProfilePhotoRepository()));
    await tester.pumpAndSettle();
    expect(find.text('Profile photo'), findsNothing);
  });

  testWidgets("a parent adds their own photo and changes a child's", (tester) async {
    final repo = _Repo(const MyPhotos(children: [ChildPhoto(id: 'k1', name: 'Kid One', avatarUrl: 'https://x/kid')]));
    await tester.pumpWidget(harness(repo));
    await tester.pumpAndSettle();

    expect(find.text('Profile photo'), findsOneWidget);
    expect(find.text("Children's photos"), findsOneWidget);
    expect(find.text('Kid One'), findsOneWidget);

    await tester.tap(find.text('Add photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['set:me:image/jpeg', 'set:k1:image/jpeg', 'remove:k1']);
  });
}
