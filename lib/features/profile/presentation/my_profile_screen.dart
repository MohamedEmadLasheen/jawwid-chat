import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_profile.dart';
import '../../../shared/utils/text_direction.dart';
import '../../feedback/presentation/teacher_feedback_screen.dart';
import '../../materials/presentation/child_materials_entry.dart';
import '../application/parent_profile_controller.dart';

/// The parent's own editable profile, and their children's.
///
/// ## Why this is a separate screen from My Account
///
/// My Account is a read-only summary reached from Settings and shared with the teacher role.
/// This screen is the parent's own editing surface, and conflating them would mean either
/// giving a teacher controls that do not apply to them or burying the parent's edits inside
/// a screen that is mostly somebody else's information.
///
/// ## Each subject is its own card, on purpose
///
/// The parent and every child get a visually separate card, and each card edits exactly one
/// subject. That separation is the defence against the worst bug this screen could have:
/// a parent believing they are editing one child while the save lands on another. Every
/// control carries the id of the subject its card is about, and nothing on the screen edits
/// "the current child" from shared state.
///
/// There is no Submit for Review, no approval banner and no moderation here. A parent's own
/// profile is theirs: Save IS the publish.
class MyProfileScreen extends ConsumerWidget {
  const MyProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(parentProfileProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.myProfileTitle)),
      body: switch (state) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError() => _LoadFailed(
            onRetry: () => ref.invalidate(parentProfileProvider),
          ),
        AsyncData(:final value) => RefreshIndicator(
            onRefresh: () => ref.read(parentProfileProvider.notifier).refresh(),
            child: ListView(
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.pagePadding,
                vertical: Spacing.spacing5,
              ),
              children: [
                _SubjectCard(subject: _Subject.parent(value)),
                if (value.children.isNotEmpty) ...[
                  const SizedBox(height: Spacing.spacing6),
                  Text(
                    l10n.childrenTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: Spacing.spacing3),
                  for (final child in value.children)
                    Padding(
                      // KEYED BY THE CHILD, and this is load-bearing rather than tidy.
                      // Without it, Flutter may pair a card's State -- including the edit
                      // form's text controllers, which are initialised once from their
                      // subject -- with a DIFFERENT child when the list rebuilds after a
                      // save. The visible symptom is a parent editing one child and the
                      // change landing on a sibling.
                      key: ValueKey(child.id),
                      padding: const EdgeInsets.only(bottom: Spacing.spacing4),
                      child: _SubjectCard(
                        key: ValueKey('card-${child.id}'),
                        subject: _Subject.child(child),
                      ),
                    ),
                ],
              ],
            ),
          ),
      },
    );
  }
}

/// Whose profile a card is about.
///
/// One type for the parent and for a child, because the three things a card edits — a photo,
/// a name and an About — are the same three things in both cases, and the only difference is
/// WHICH controller call saves them. Modelling that difference as data rather than as two
/// near-identical widgets is what keeps the save paths from drifting apart.
class _Subject {
  const _Subject({
    required this.id,
    required this.displayName,
    required this.about,
    required this.avatarUrl,
    required this.isParent,
    this.secondaryLine,
  });

  factory _Subject.parent(ParentProfile profile) => _Subject(
        // The parent's own edits take no id: the server reads them from the token.
        id: null,
        displayName: profile.displayName,
        about: profile.about,
        avatarUrl: profile.avatarUrl,
        isParent: true,
        secondaryLine: profile.relationship,
      );

  factory _Subject.child(ChildProfile child) => _Subject(
        id: child.id,
        displayName: child.displayName,
        about: child.about,
        avatarUrl: child.avatarUrl,
        isParent: false,
        secondaryLine: child.level,
      );

  /// Null for the parent, the learner id for a child. This is the single value that decides
  /// where a save lands, and it is read from the card's own subject — never from a selection.
  final String? id;
  final String displayName;
  final String? about;
  final String? avatarUrl;
  final bool isParent;
  final String? secondaryLine;
}

class _SubjectCard extends ConsumerStatefulWidget {
  const _SubjectCard({super.key, required this.subject});

  final _Subject subject;

  @override
  ConsumerState<_SubjectCard> createState() => _SubjectCardState();
}

class _SubjectCardState extends ConsumerState<_SubjectCard> {
  bool _editing = false;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final subject = widget.subject;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _PhotoControl(
                  subject: subject,
                  busy: _busy,
                  onBusy: (busy) => setState(() => _busy = busy),
                ),
                const SizedBox(width: Spacing.spacing4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ContentText(
                        subject.displayName,
                        style: theme.textTheme.titleMedium,
                      ),
                      if (subject.secondaryLine != null)
                        ContentText(
                          subject.secondaryLine!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                if (!_editing)
                  TextButton(
                    // Named for the subject, so a screen reader says whose profile this
                    // button edits rather than just "Edit".
                    onPressed: _busy ? null : () => setState(() => _editing = true),
                    child: Text(l10n.profileEdit),
                  ),
              ],
            ),
            // PD-29: each child's Materials, from the parent's own profile.
            if (!subject.isParent && subject.id != null)
              ChildMaterialsEntry(learnerId: subject.id!, childName: subject.displayName),
            // PD-32: the parent's feedback about this child's teacher.
            if (!subject.isParent && subject.id != null)
              TeacherFeedbackEntry(learnerId: subject.id!, childName: subject.displayName),
            const SizedBox(height: Spacing.spacing4),
            if (_editing)
              _EditForm(
                // Keyed by the subject as well, so the form's controllers -- which read
                // their initial text once -- can never be carried over to another person.
                key: ValueKey('edit-${subject.id ?? 'parent'}'),
                subject: subject,
                onDone: () => setState(() => _editing = false),
              )
            else
              _AboutText(about: subject.about),
          ],
        ),
      ),
    );
  }
}

/// The About as read: the parent's own words, or an honest empty state.
class _AboutText extends StatelessWidget {
  const _AboutText({required this.about});

  final String? about;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final text = (about ?? '').trim();

    if (text.isEmpty) {
      // Says there is nothing rather than leaving a blank the reader has to interpret.
      return Text(
        l10n.profileAboutEmpty,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontStyle: FontStyle.italic,
        ),
      );
    }
    // ContentText, because an About is user prose: it may be Arabic inside an English UI or
    // the reverse, and it must read in its own direction.
    return ContentText(text, style: theme.textTheme.bodyMedium);
  }
}

/// Name + About, edited and saved together.
///
/// One Save for both fields, because that is how a person thinks about their own profile —
/// and it means one round trip and one audit moment rather than two.
class _EditForm extends ConsumerStatefulWidget {
  const _EditForm({super.key, required this.subject, required this.onDone});

  final _Subject subject;
  final VoidCallback onDone;

  @override
  ConsumerState<_EditForm> createState() => _EditFormState();
}

class _EditFormState extends ConsumerState<_EditForm> {
  late final TextEditingController _name =
      TextEditingController(text: widget.subject.displayName);
  late final TextEditingController _about =
      TextEditingController(text: widget.subject.about ?? '');
  final _form = GlobalKey<FormState>();
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _about.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextFormField(
            controller: _name,
            enabled: !_saving,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(labelText: l10n.profileNameLabel),
            // Client-side validation is a courtesy that saves a round trip. The server
            // enforces the same bounds and is the actual control.
            validator: (value) {
              final name = (value ?? '').trim();
              if (name.isEmpty) return l10n.profileNameEmptyError;
              if (name.length > _nameMax) return l10n.profileNameTooLongError;
              return null;
            },
          ),
          const SizedBox(height: Spacing.spacing4),
          TextFormField(
            controller: _about,
            enabled: !_saving,
            maxLines: 4,
            minLines: 2,
            maxLength: _aboutMax,
            decoration: InputDecoration(
              labelText: l10n.profileAboutLabel,
              hintText: l10n.profileAboutHint,
              alignLabelWithHint: true,
            ),
            validator: (value) =>
                (value ?? '').trim().length > _aboutMax ? l10n.profileAboutTooLongError : null,
          ),
          const SizedBox(height: Spacing.spacing4),
          // Both buttons are Expanded, and that is not cosmetic. This app's button themes
          // set `minimumSize: Size.fromHeight(...)`, which is `Size(double.infinity, h)` --
          // so every button here is designed as a FULL-WIDTH block and asserts if a parent
          // lets it size itself. Expanded is what hands each one a bounded width.
          Row(
            children: [
              Expanded(
                child: TextButton(
                  onPressed: _saving ? null : widget.onDone,
                  child: Text(l10n.profileCancel),
                ),
              ),
              const SizedBox(width: Spacing.spacing3),
              Expanded(
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(l10n.profileSave),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (_form.currentState?.validate() != true) return;
    final l10n = L10n.of(context);
    final notifier = ref.read(parentProfileProvider.notifier);
    final subject = widget.subject;

    setState(() => _saving = true);
    try {
      final name = _name.text.trim();
      final about = _about.text.trim();
      // `about` is sent even when empty: that is how a parent CLEARS it. Only a field the
      // caller never touched is omitted, and this form always owns both.
      final failure = subject.id == null
          ? await notifier.saveMe(name: name, about: about)
          : await notifier.saveChild(subject.id!, name: name, about: about);

      if (!mounted) return;
      if (failure != null) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l10n.profileSaveFailed)));
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.profileSaved)));
      widget.onDone();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// The photo, and the control that changes it.
///
/// The avatar IS the control: tapping the picture is how a photo gets changed, which puts
/// the action where the content is instead of floating an unrelated button beside it. The
/// badge only says so.
class _PhotoControl extends ConsumerWidget {
  const _PhotoControl({
    required this.subject,
    required this.busy,
    required this.onBusy,
  });

  final _Subject subject;
  final bool busy;
  final ValueChanged<bool> onBusy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Semantics(
      button: true,
      label: subject.isParent
          ? l10n.profilePhotoEditLabel
          : l10n.profileChildPhotoEditLabel(subject.displayName),
      child: ExcludeSemantics(
        // The badge sits OUTSIDE the circular clip on purpose: a Material that clips to a
        // circle would cut off a badge drawn inside it at exactly the corner it belongs in.
        child: Stack(
          alignment: AlignmentDirectional.bottomEnd,
          children: [
            Material(
              color: Colors.transparent,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: busy ? null : () => _openSheet(context, ref),
                child: JawwidAvatar(
                  displayName: subject.displayName,
                  imageUrl: subject.avatarUrl,
                  size: Sizes.avatarLg,
                ),
              ),
            ),
            IgnorePointer(
              child: Container(
                padding: const EdgeInsets.all(Spacing.spacing1),
                decoration: BoxDecoration(
                  color: tokens.colorSurfaceDefault,
                  shape: BoxShape.circle,
                  border: Border.all(color: tokens.colorBorderDefault),
                ),
                child: busy
                    ? const SizedBox.square(
                        dimension: 12,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        Icons.photo_camera_rounded,
                        size: 12,
                        color: tokens.colorTextSecondary,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openSheet(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final hasPhoto = (subject.avatarUrl ?? '').isNotEmpty;

    final choice = await showModalBottomSheet<_PhotoAction>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                subject.isParent
                    ? l10n.profilePhotoTitle
                    : l10n.profileChildEditTitle(subject.displayName),
              ),
              dense: true,
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: Text(hasPhoto ? l10n.profilePhotoChange : l10n.profilePhotoAdd),
              onTap: () => Navigator.of(context).pop(_PhotoAction.pick),
            ),
            if (hasPhoto)
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded),
                title: Text(l10n.profilePhotoRemove),
                onTap: () => Navigator.of(context).pop(_PhotoAction.remove),
              ),
          ],
        ),
      ),
    );
    if (choice == null || !context.mounted) return;

    final notifier = ref.read(parentProfileProvider.notifier);
    final messenger = ScaffoldMessenger.of(context);
    onBusy(true);
    try {
      final failure = switch (choice) {
        _PhotoAction.remove => subject.id == null
            ? await notifier.removeAvatar()
            : await notifier.removeChildAvatar(subject.id!),
        _PhotoAction.pick => await _pickAndSet(ref, notifier),
      };
      if (failure == null) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            choice == _PhotoAction.remove
                ? l10n.profilePhotoRemoveFailed
                : l10n.profilePhotoFailed,
          ),
        ),
      );
    } finally {
      onBusy(false);
    }
  }

  Future<Object?> _pickAndSet(WidgetRef ref, ParentProfileController notifier) async {
    final image = await ref.read(mediaPickerProvider).pickImage();
    // Backing out of the picker is not a failure and must say nothing.
    if (image == null) return null;
    return subject.id == null
        ? notifier.setAvatar(image)
        : notifier.setChildAvatar(subject.id!, image);
  }
}

enum _PhotoAction { pick, remove }

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.profileLoadFailed, textAlign: TextAlign.center),
            const SizedBox(height: Spacing.spacing4),
            FilledButton(onPressed: onRetry, child: Text(l10n.storyVideoRetry)),
          ],
        ),
      ),
    );
  }
}

/// Matches the server's bounds, and the column check constraint behind them.
const int _nameMax = 120;
const int _aboutMax = 1000;
