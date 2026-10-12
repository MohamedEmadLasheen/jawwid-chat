import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/teacher_profile.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/teacher_profile_controller.dart';

/// The teacher's professional profile.
///
/// Reached from Settings, and only by a teacher. This is NOT "My account" --
/// that screen is the signed-in person's account and is untouched here. This
/// one is the thing a family eventually reads.
///
/// ## The teacher owns this screen
///
/// There is no Submit, no pending-review banner and no approval. Save writes
/// the profile and the write IS the publish, so the only states this screen has
/// are the ordinary ones: idle, saving, saved, failed. A teacher does not wait
/// for another person to publish their own words.
///
/// What is NOT immediate is a CERTIFICATE's trust. Uploading a document does not
/// make it verified, so each credential shows its own review state -- and that
/// state is information, never something that blocks the teacher from saving.
///
/// ## What the screen does not decide
///
/// WHAT THE NAME IS. A rename returns the name the server stored, after its own
/// trimming, and that is what gets rendered. The screen never shows the string
/// that was typed.
///
/// WHERE THE PHOTO LIVES. It renders a short-lived signed URL the server
/// minted, through the shared [JawwidAvatar], and falls back to generated
/// initials when there is none. No path is ever constructed here.
class TeacherProfileScreen extends ConsumerStatefulWidget {
  const TeacherProfileScreen({super.key});

  @override
  ConsumerState<TeacherProfileScreen> createState() => _TeacherProfileScreenState();
}

class _TeacherProfileScreenState extends ConsumerState<TeacherProfileScreen> {
  final _bio = TextEditingController();
  final _specialization = TextEditingController();
  final _qualifications = TextEditingController();
  final _experience = TextEditingController();
  final _languages = TextEditingController();

  /// The profile the controllers were last filled from. Re-filling on every
  /// build would overwrite what the teacher is typing on each rebuild.
  TeacherProfile? _loadedFrom;

  bool _saving = false;

  @override
  void dispose() {
    for (final controller in [
      _bio,
      _specialization,
      _qualifications,
      _experience,
      _languages,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _fill(TeacherProfile? profile) {
    if (identical(profile, _loadedFrom)) return;
    _loadedFrom = profile;
    _bio.text = profile?.bio ?? '';
    _specialization.text = profile?.specialization ?? '';
    _qualifications.text = profile?.qualifications ?? '';
    _experience.text = profile?.experience ?? '';
    _languages.text = (profile?.languages ?? const []).join('، ');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final state = ref.watch(teacherProfileControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.teacherProfileTitle)),
      body: switch (state) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError(:final error) => _Error(
            error: error,
            onRetry: () => ref.read(teacherProfileControllerProvider.notifier).refresh(),
          ),
        AsyncData(:final value) => _Body(
            profile: value,
            bio: _bio,
            specialization: _specialization,
            qualifications: _qualifications,
            experience: _experience,
            languages: _languages,
            saving: _saving,
            fill: _fill,
            onSave: _save,
          ),
      },
    );
  }

  Future<void> _save() async {
    // Guarded rather than merely disabled: a second tap arriving between the
    // first one and the rebuild would otherwise send a second save.
    if (_saving) return;

    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      await ref.read(teacherProfileControllerProvider.notifier).save(
            bio: _bio.text.trim().isEmpty ? null : _bio.text.trim(),
            specialization:
                _specialization.text.trim().isEmpty ? null : _specialization.text.trim(),
            qualifications:
                _qualifications.text.trim().isEmpty ? null : _qualifications.text.trim(),
            experience: _experience.text.trim().isEmpty ? null : _experience.text.trim(),
            languages: _parseLanguages(_languages.text),
          );
      // The server's view replaced ours, so the fields are re-filled from it.
      _loadedFrom = null;
      messenger.showSnackBar(SnackBar(content: Text(l10n.teacherProfileSaved)));
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(ErrorPresenter.present(error, l10n).title),
          // A failed save is the one place a retry belongs: the teacher's words
          // are still in the fields, so retrying costs one tap and loses nothing.
          action: SnackBarAction(label: l10n.retryAction, onPressed: _save),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Split on either comma, because a teacher typing Arabic uses the Arabic one
  /// and being told "wrong comma" is not a thing software should do.
  static List<String> _parseLanguages(String raw) => [
        for (final part in raw.split(RegExp('[,،]')))
          if (part.trim().isNotEmpty) part.trim(),
      ];
}

class _Body extends ConsumerWidget {
  const _Body({
    required this.profile,
    required this.bio,
    required this.specialization,
    required this.qualifications,
    required this.experience,
    required this.languages,
    required this.saving,
    required this.fill,
    required this.onSave,
  });

  final TeacherProfile profile;
  final TextEditingController bio;
  final TextEditingController specialization;
  final TextEditingController qualifications;
  final TextEditingController experience;
  final TextEditingController languages;
  final bool saving;
  final void Function(TeacherProfile?) fill;
  final Future<void> Function() onSave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);

    fill(profile);

    return ListView(
      padding: const EdgeInsets.only(bottom: Spacing.spacing9),
      children: [
        _Header(profile: profile),

        if (profile.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
            child: JawwidEmptyView(
              icon: Icons.workspace_premium_outlined,
              title: l10n.teacherProfileEmptyTitle,
              body: l10n.teacherProfileEmptyBody,
            ),
          ),

        _Section(title: l10n.teacherProfileAboutSection),
        _Field(
          controller: bio,
          label: l10n.teacherProfileBioLabel,
          hint: l10n.teacherProfileBioHint,
          enabled: !saving,
          maxLength: ProfileLimits.maxBio,
          maxLines: 5,
        ),

        _Section(title: l10n.teacherProfileProfessionalSection),
        _Field(
          controller: specialization,
          label: l10n.teacherProfileSpecializationLabel,
          enabled: !saving,
          maxLength: ProfileLimits.maxSpecialization,
        ),
        _Field(
          controller: qualifications,
          label: l10n.teacherProfileQualificationsLabel,
          enabled: !saving,
          maxLength: ProfileLimits.maxQualifications,
          maxLines: 4,
        ),
        _Field(
          controller: experience,
          label: l10n.teacherProfileExperienceLabel,
          enabled: !saving,
          maxLength: ProfileLimits.maxExperience,
          maxLines: 4,
        ),
        _Field(
          controller: languages,
          label: l10n.teacherProfileLanguagesLabel,
          hint: l10n.teacherProfileLanguagesHint,
          enabled: !saving,
          maxLength: ProfileLimits.maxSpecialization,
        ),

        _Section(title: l10n.teacherProfileCertificatesSection),
        _Certificates(certificates: profile.certificates),

        const SizedBox(height: Spacing.spacing6),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
          // ONE action. The previous version had Save beside Submit, which is
          // the whole thing this release removed.
          child: FilledButton(
            onPressed: saving ? null : onSave,
            child: Text(saving ? l10n.teacherProfileSaving : l10n.teacherProfileSave),
          ),
        ),
      ],
    );
  }
}

/// Photo, editable name, read-only role.
///
/// The name is rendered from [TeacherProfile.name], which the server served
/// from `chat.teacher`. The profile has no name column precisely so it cannot
/// disagree with the identity every other screen shows.
class _Header extends ConsumerStatefulWidget {
  const _Header({required this.profile});

  final TeacherProfile profile;

  @override
  ConsumerState<_Header> createState() => _HeaderState();
}

class _HeaderState extends ConsumerState<_Header> {
  bool _busy = false;
  double? _progress;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing6,
      ),
      child: Column(
        children: [
          Stack(
            children: [
              // The SHARED avatar, given a signed URL. No second avatar
              // component exists, and this one already falls back to initials
              // when the URL is null or fails to load.
              JawwidAvatar(
                displayName: widget.profile.name,
                imageUrl: widget.profile.photoUrl,
                // Empty while the token resolves, which renders initials rather
                // than a broken image.
                imageHeaders: ref.watch(signedImageHeadersProvider).value,
                trustedBaseUrl: ref.watch(apiBaseUrlProvider),
                size: Sizes.avatarXl,
              ),
              PositionedDirectional(
                bottom: 0,
                end: 0,
                child: _PhotoButton(
                  busy: _busy,
                  hasPhoto: widget.profile.photoUrl != null,
                  onPick: _pickPhoto,
                  onRemove: _removePhoto,
                ),
              ),
            ],
          ),
          if (_busy) ...[
            const SizedBox(height: Spacing.spacing3),
            LinearProgressIndicator(value: _progress),
            const SizedBox(height: Spacing.spacing2),
            Text(l10n.teacherProfilePhotoUploading),
          ],
          const SizedBox(height: Spacing.spacing4),
          _NameField(name: widget.profile.name),
          const SizedBox(height: Spacing.spacing1),
          Text(
            l10n.groupMemberRoleTeacher,
            style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
          ),
        ],
      ),
    );
  }

  Future<void> _pickPhoto() async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final picked = await ref.read(mediaPickerProvider).pickImage();
    if (picked == null) return;

    final file = PendingPhotoFile(
      filePath: picked.filePath,
      mimeType: picked.mimeType,
      byteSize: picked.byteSize,
      fileName: picked.fileName,
    );

    // The same two rules the server enforces, applied before any bytes move --
    // so the teacher is told now rather than after a failed upload.
    if (!file.isAllowedType) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.teacherProfilePhotoBadType)));
      return;
    }
    if (!file.isWithinSizeLimit) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.teacherProfilePhotoTooLarge)));
      return;
    }

    setState(() {
      _busy = true;
      _progress = 0;
    });
    try {
      await ref.read(teacherProfileControllerProvider.notifier).setPhoto(
            file: file,
            onProgress: (sent, total) {
              if (!mounted || total <= 0) return;
              setState(() => _progress = sent / total);
            },
          );
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(error, l10n).title)),
      );
    } catch (error) {
      // A transport failure during the PUT is not an AppError; one vocabulary
      // of failure on screen is worth the mapping.
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(asAppErrorOf(error), l10n).title)),
      );
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _removePhoto() async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.teacherProfilePhotoRemoveTitle),
        content: Text(l10n.teacherProfilePhotoRemoveBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.teacherProfilePhotoRemove),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(teacherProfileControllerProvider.notifier).removePhoto();
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(error, l10n).title)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _PhotoButton extends StatelessWidget {
  const _PhotoButton({
    required this.busy,
    required this.hasPhoto,
    required this.onPick,
    required this.onRemove,
  });

  final bool busy;
  final bool hasPhoto;
  final VoidCallback onPick;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    if (!hasPhoto) {
      return IconButton.filled(
        onPressed: busy ? null : onPick,
        icon: const Icon(Icons.photo_camera_outlined),
        tooltip: l10n.teacherProfilePhotoChoose,
      );
    }

    // Replace and Remove are different enough to deserve separate choices, but
    // not enough to deserve two buttons on an avatar.
    return PopupMenuButton<_PhotoAction>(
      enabled: !busy,
      tooltip: l10n.teacherProfilePhotoChoose,
      icon: const CircleAvatar(child: Icon(Icons.photo_camera_outlined, size: 18)),
      onSelected: (action) => switch (action) {
        _PhotoAction.replace => onPick(),
        _PhotoAction.remove => onRemove(),
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: _PhotoAction.replace,
          child: Text(l10n.teacherProfilePhotoReplace),
        ),
        PopupMenuItem(
          value: _PhotoAction.remove,
          child: Text(l10n.teacherProfilePhotoRemove),
        ),
      ],
    );
  }
}

enum _PhotoAction { replace, remove }

/// The editable name.
///
/// Saved on its own, by its own button, because it writes a different thing from
/// the profile Save: this one writes IDENTITY, read by screens that have nothing
/// to do with this one. The field is re-seeded from [name] whenever the server's
/// answer changes, so a rejected or trimmed name snaps back to what was stored.
class _NameField extends ConsumerStatefulWidget {
  const _NameField({required this.name});

  final String name;

  @override
  ConsumerState<_NameField> createState() => _NameFieldState();
}

class _NameFieldState extends ConsumerState<_NameField> {
  late final TextEditingController _controller = TextEditingController(text: widget.name);
  String? _error;
  bool _saving = false;

  @override
  void didUpdateWidget(_NameField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only when the SERVER's name changed, and never while the teacher is
    // mid-edit of a name that matches what is stored.
    if (widget.name != oldWidget.name && !_saving) {
      _controller.text = widget.name;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final dirty = _controller.text.trim() != widget.name;

    return Column(
      children: [
        TextField(
          controller: _controller,
          enabled: !_saving,
          textAlign: TextAlign.center,
          maxLength: ProfileLimits.maxName,
          textInputAction: TextInputAction.done,
          onChanged: (_) => setState(() => _error = null),
          onSubmitted: (_) => _save(),
          decoration: InputDecoration(
            labelText: l10n.teacherProfileNameLabel,
            errorText: _error,
            counterText: '',
          ),
        ),
        if (dirty || _saving)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing2),
            child: FilledButton.tonal(
              onPressed: _saving ? null : _save,
              child: Text(
                _saving ? l10n.teacherProfileSaving : l10n.teacherProfileNameSave,
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _save() async {
    if (_saving) return;

    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final name = _controller.text.trim();

    // Refused here as well as on the server, so the teacher is told before the
    // round trip rather than after it. The server's rule is the one that counts.
    if (name.isEmpty) {
      setState(() => _error = l10n.teacherProfileNameRequired);
      return;
    }

    setState(() => _saving = true);
    try {
      await ref.read(teacherProfileControllerProvider.notifier).rename(name);
      messenger.showSnackBar(SnackBar(content: Text(l10n.teacherProfileNameSaved)));
    } on AppError catch (error) {
      setState(() => _error = ErrorPresenter.present(error, l10n).title);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _Certificates extends ConsumerWidget {
  const _Certificates({required this.certificates});

  final List<ProfileCertificate> certificates;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);

    return Column(
      children: [
        if (certificates.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing5,
              vertical: Spacing.spacing3,
            ),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(l10n.teacherProfileCertificatesEmpty),
            ),
          )
        else
          for (final certificate in certificates)
            _CertificateTile(certificate: certificate),
        Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () => _addCertificate(context, ref),
                icon: const Icon(Icons.add),
                label: Text(l10n.teacherProfileAddCertificate),
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _addCertificate(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const AddCertificateSheet(),
    );
  }
}

class _CertificateTile extends ConsumerWidget {
  const _CertificateTile({required this.certificate});

  final ProfileCertificate certificate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final theme = Theme.of(context);

    final (statusLabel, statusColor) = switch (certificate.state) {
      CertificateState.approved => (
          l10n.teacherProfileCertificateApproved,
          tokens.colorStatusSuccessFg,
        ),
      CertificateState.rejected => (
          l10n.teacherProfileCertificateRejected,
          tokens.colorStatusDangerFg,
        ),
      CertificateState.pending => (
          l10n.teacherProfileCertificatePending,
          tokens.colorTextSecondary,
        ),
    };

    final subtitle = [
      if (certificate.issuingOrganization != null) certificate.issuingOrganization!,
      if (certificate.issuedOn != null) '${certificate.issuedOn!.year}',
    ].join(' · ');

    return ListTile(
      leading: const Icon(Icons.description_outlined),
      title: ContentText(certificate.title, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (subtitle.isNotEmpty) ContentText(subtitle),
          Text(statusLabel, style: theme.textTheme.labelSmall?.copyWith(color: statusColor)),
          // A rejected credential says why, when the reviewer said.
          if (certificate.state == CertificateState.rejected &&
              certificate.reviewNote != null)
            ContentText(
              certificate.reviewNote!,
              style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
            ),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.open_in_new),
            tooltip: l10n.teacherProfileCertificateOpen,
            onPressed: () => _open(context, ref),
          ),
          IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: l10n.teacherProfileCertificateEdit,
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                // The SAME sheet as adding one. Editing and adding differ only
                // in whether a file is chosen, so a second form would be a
                // second place for the validation rules to drift.
                builder: (_) => AddCertificateSheet(editing: certificate),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: l10n.teacherProfileCertificateRemove,
            onPressed: () => _confirmRemove(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      // A fresh signed URL, per open. Nothing about the file's location is held
      // on the client between taps.
      final url = await ref
          .read(teacherProfileControllerProvider.notifier)
          .certificateUrl(certificate.id);
      await ref.read(attachmentOpenerProvider).open(url);
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(error, l10n).title)),
      );
    }
  }

  Future<void> _confirmRemove(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.teacherProfileCertificateRemoveTitle),
        // Says explicitly that the published version is untouched. Without it,
        // "remove" on a profile families can read sounds like it reaches them.
        content: Text(l10n.teacherProfileCertificateRemoveBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.teacherProfileCertificateRemove),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await ref
          .read(teacherProfileControllerProvider.notifier)
          .removeCertificate(certificate.id);
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(error, l10n).title)),
      );
    }
  }
}

/// Add one credential: pick a file, name it, upload it.
///
/// Validation here mirrors the server's and never replaces it: the file is
/// checked before the bytes move so the teacher is told early, and the server
/// checks again because this one is a courtesy.
class AddCertificateSheet extends ConsumerStatefulWidget {
  const AddCertificateSheet({super.key, this.editing});

  /// When set, the sheet edits this credential's METADATA. The file is not
  /// re-chosen and not re-uploaded: renaming a certificate must not be able to
  /// become substituting one.
  final ProfileCertificate? editing;

  @override
  ConsumerState<AddCertificateSheet> createState() => _AddCertificateSheetState();
}

class _AddCertificateSheetState extends ConsumerState<AddCertificateSheet> {
  final _title = TextEditingController();
  final _issuer = TextEditingController();
  final _year = TextEditingController();

  PendingCertificateFile? _file;
  String? _fileError;
  String? _titleError;
  bool _uploading = false;
  double? _progress;

  bool get _isEditing => widget.editing != null;

  @override
  void initState() {
    super.initState();
    final editing = widget.editing;
    if (editing != null) {
      _title.text = editing.title;
      _issuer.text = editing.issuingOrganization ?? '';
      _year.text = editing.issuedOn?.year.toString() ?? '';
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _issuer.dispose();
    _year.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Padding(
      padding: EdgeInsetsDirectional.only(
        start: Spacing.spacing5,
        end: Spacing.spacing5,
        top: Spacing.spacing5,
        bottom: MediaQuery.viewInsetsOf(context).bottom + Spacing.spacing5,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _isEditing
                ? l10n.teacherProfileCertificateEditTitle
                : l10n.teacherProfileAddCertificate,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (_isEditing) ...[
            const SizedBox(height: Spacing.spacing2),
            // Said plainly, because re-review is the surprising part: a teacher
            // fixing a typo on an approved credential has just un-approved it.
            ContentText(
              l10n.teacherProfileCertificateEditNote,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: JawwidTokens.of(context).colorTextSecondary,
                  ),
            ),
          ],
          const SizedBox(height: Spacing.spacing4),
          TextField(
            controller: _title,
            enabled: !_uploading,
            maxLength: CertificateLimits.maxTitleLength,
            decoration: InputDecoration(
              labelText: l10n.teacherProfileCertificateTitleLabel,
              errorText: _titleError,
            ),
          ),
          TextField(
            controller: _issuer,
            enabled: !_uploading,
            maxLength: CertificateLimits.maxIssuerLength,
            decoration: InputDecoration(
              labelText: l10n.teacherProfileCertificateIssuerLabel,
            ),
          ),
          TextField(
            controller: _year,
            enabled: !_uploading,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: l10n.teacherProfileCertificateYearLabel,
            ),
          ),
          const SizedBox(height: Spacing.spacing4),
          if (!_isEditing)
          // Every button in this theme is full-width (`Size.fromHeight`), so a
          // themed button cannot be a non-flex child of a Row -- Flex hands
          // those an unbounded width and the minimum size then forces infinity.
          // Both children are flexible for that reason, not for looks.
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _uploading ? null : _pick,
                  icon: const Icon(Icons.attach_file),
                  label: Text(l10n.teacherProfileCertificateFile),
                ),
              ),
              if (_file != null) ...[
                const SizedBox(width: Spacing.spacing4),
                Expanded(
                  child: ContentText(
                    l10n.teacherProfileCertificateFileChosen(
                      _file!.fileName ?? l10n.teacherProfileCertificateFile,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
          if (_fileError != null && !_isEditing)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(
                _fileError!,
                style: TextStyle(color: JawwidTokens.of(context).colorStatusDangerFg),
              ),
            ),
          if (_uploading) ...[
            const SizedBox(height: Spacing.spacing4),
            // Determinate while the bytes move, because a teacher watching a
            // 9MB PDF needs to know it is progressing rather than hung.
            LinearProgressIndicator(value: _progress),
            const SizedBox(height: Spacing.spacing2),
            Text(l10n.teacherProfileCertificateUploading),
          ],
          const SizedBox(height: Spacing.spacing5),
          FilledButton(
            onPressed: _uploading ? null : _upload,
            child: Text(
              // Not just "Save": the profile's own Save button is on the screen
              // behind this sheet, and two controls with one label is one
              // control the teacher has to guess about.
              _isEditing
                  ? l10n.teacherProfileCertificateSave
                  : l10n.teacherProfileAddCertificate,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pick() async {
    final l10n = L10n.of(context);
    final picked = await ref.read(mediaPickerProvider).pickFile();
    if (picked == null) return;

    // The same two rules the server enforces, applied before any bytes move.
    if (!CertificateLimits.allowedMimeTypes.contains(picked.mimeType)) {
      setState(() {
        _file = null;
        _fileError = l10n.teacherProfileCertificateBadType;
      });
      return;
    }
    if (picked.byteSize > CertificateLimits.maxBytes) {
      setState(() {
        _file = null;
        _fileError = l10n.teacherProfileCertificateTooLarge;
      });
      return;
    }

    setState(() {
      _fileError = null;
      _file = PendingCertificateFile(
        filePath: picked.filePath,
        mimeType: picked.mimeType,
        byteSize: picked.byteSize,
        fileName: picked.fileName,
      );
    });
  }

  Future<void> _upload() async {
    if (_uploading) return;

    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    final file = _file;
    final editing = widget.editing;
    setState(() {
      _titleError = _title.text.trim().isEmpty
          ? l10n.teacherProfileCertificateTitleRequired
          : null;
      _fileError = editing == null && file == null
          ? l10n.teacherProfileCertificateFileRequired
          : _fileError;
    });
    if (_titleError != null) return;
    if (editing == null && file == null) return;

    setState(() {
      _uploading = true;
      _progress = 0;
    });
    try {
      final year = int.tryParse(_year.text.trim());
      final issuer = _issuer.text.trim().isEmpty ? null : _issuer.text.trim();
      final issuedOn = year == null ? null : DateTime(year);
      final controller = ref.read(teacherProfileControllerProvider.notifier);

      if (editing != null) {
        // Metadata only. No bytes move, and the server re-pends the claim.
        await controller.updateCertificate(
          editing.id,
          title: _title.text.trim(),
          issuingOrganization: issuer,
          issuedOn: issuedOn,
        );
      } else {
        await controller.addCertificate(
          file: file!,
          title: _title.text.trim(),
          issuingOrganization: issuer,
          issuedOn: issuedOn,
          onProgress: (sent, total) {
            if (!mounted || total <= 0) return;
            setState(() => _progress = sent / total);
          },
        );
      }
      navigator.pop();
    } on AppError catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(ErrorPresenter.present(error, l10n).title)),
      );
    } catch (error) {
      // A transport failure during the PUT is not an AppError. Mapping it with
      // the same presenter keeps one vocabulary of failure on screen; the sheet
      // stays open with the file still chosen, so retrying costs one tap.
      messenger.showSnackBar(
        SnackBar(
          content: Text(ErrorPresenter.present(asAppErrorOf(error), l10n).title),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _progress = null;
        });
      }
    }
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing2,
      ),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: Text(
          title,
          style: theme.textTheme.labelLarge?.copyWith(color: tokens.colorTextSecondary),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.enabled,
    required this.maxLength,
    this.hint,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final bool enabled;
  final int maxLength;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing2,
      ),
      child: TextField(
        controller: controller,
        enabled: enabled,
        maxLength: maxLength,
        maxLines: maxLines,
        // Counter only where the limit is near enough to matter; a counter on
        // every field turns the form into a wall of numbers.
        buildCounter: maxLength <= 200
            ? null
            : (_, {required currentLength, required isFocused, maxLength}) => null,
        decoration: InputDecoration(labelText: label, hintText: hint),
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final appError = asAppErrorOf(error);

    // "Not wired in this build" is not a network failure and must not offer a
    // retry that cannot succeed.
    if (appError.code == teacherProfileNotAvailableCode) {
      return JawwidErrorView(title: l10n.teacherProfileUnavailable);
    }

    final message = ErrorPresenter.present(appError, l10n);
    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry ? onRetry : null,
    );
  }
}
