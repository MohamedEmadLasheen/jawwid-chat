import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/teacher_feedback.dart';
import '../../../shared/utils/text_direction.dart';
import 'teacher_feedback_screen.dart' show feedbackCategoryLabel;

/// PD-32: new feedback about one child's teacher -- a kind, the words, and send.
///
/// Pops with the created item on success; the list screen reloads and thanks the parent.
/// The privacy line is said once, here, where the parent is deciding what to write.
class TeacherFeedbackFormScreen extends ConsumerStatefulWidget {
  const TeacherFeedbackFormScreen({
    super.key,
    required this.learnerId,
    required this.childName,
    this.teacherName,
  });

  final String learnerId;
  final String childName;
  final String? teacherName;

  @override
  ConsumerState<TeacherFeedbackFormScreen> createState() => _TeacherFeedbackFormScreenState();
}

class _TeacherFeedbackFormScreenState extends ConsumerState<TeacherFeedbackFormScreen> {
  final _body = TextEditingController();
  FeedbackCategory? _category;
  bool _tried = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  String _errorText(L10n l10n, Object error) {
    final appError = asAppErrorOf(error);
    return switch (appError.code) {
      FeedbackErrors.limit => l10n.feedbackLimit,
      FeedbackErrors.notFound => l10n.feedbackNotFound,
      FeedbackErrors.denied => l10n.feedbackDenied,
      _ => switch (appError.kind) {
          AppErrorKind.rateLimited => l10n.feedbackLimit,
          AppErrorKind.notFound => l10n.feedbackNotFound,
          AppErrorKind.network || AppErrorKind.timeout => ErrorPresenter.present(appError, l10n).title,
          _ => l10n.feedbackFailed,
        },
    };
  }

  Future<void> _submit() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    final category = _category;
    final body = _body.text.trim();
    if (category == null || body.isEmpty) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final item = await ref.read(feedbackRepositoryProvider).submit(
            learnerId: widget.learnerId,
            category: category,
            body: body,
          );
      if (!mounted) return;
      Navigator.of(context).pop<FeedbackItem>(item);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final noCategory = _tried && _category == null;
    final noBody = _tried && _body.text.trim().isEmpty;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.feedbackNew)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(Spacing.spacing5),
          children: [
            ContentText(widget.childName, style: theme.textTheme.titleMedium),
            if (widget.teacherName != null)
              ContentText(
                l10n.feedbackTeacherLine(widget.teacherName!),
                style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary),
              ),
            const SizedBox(height: Spacing.spacing6),
            Text(l10n.feedbackCategoryLabel, style: theme.textTheme.titleSmall),
            const SizedBox(height: Spacing.spacing3),
            Wrap(
              spacing: Spacing.spacing3,
              runSpacing: Spacing.spacing3,
              children: [
                for (final category in FeedbackCategory.values)
                  ChoiceChip(
                    key: ValueKey('feedback-category-${category.name}'),
                    label: Text(feedbackCategoryLabel(category, l10n)),
                    selected: _category == category,
                    onSelected: _busy ? null : (_) => setState(() => _category = category),
                  ),
              ],
            ),
            if (noCategory) ...[
              const SizedBox(height: Spacing.spacing2),
              Text(
                l10n.feedbackChooseCategory,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: Spacing.spacing6),
            TextField(
              key: const ValueKey('feedback-body'),
              controller: _body,
              enabled: !_busy,
              minLines: 5,
              maxLines: 10,
              maxLength: FeedbackErrors.maxLength,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) {
                if (_tried) setState(() {});
              },
              decoration: InputDecoration(
                labelText: l10n.feedbackBodyLabel,
                hintText: l10n.feedbackBodyHint,
                alignLabelWithHint: true,
                errorText: noBody ? l10n.feedbackBodyRequired : null,
              ),
            ),
            const SizedBox(height: Spacing.spacing2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline, size: 16, color: tokens.colorTextSecondary),
                const SizedBox(width: Spacing.spacing2),
                Expanded(
                  child: Text(
                    l10n.feedbackPrivacyNote,
                    key: const ValueKey('feedback-privacy'),
                    style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: Spacing.spacing5),
              Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  key: const ValueKey('feedback-error'),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                ),
              ),
            ],
            const SizedBox(height: Spacing.spacing6),
            FilledButton(
              key: const ValueKey('feedback-submit'),
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.feedbackSubmit),
            ),
          ],
        ),
      ),
    );
  }
}
