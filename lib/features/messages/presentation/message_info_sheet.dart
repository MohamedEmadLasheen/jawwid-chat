import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/text_direction.dart';
import '../data/receipt_repository.dart';

/// PD-37: "Message info" for the viewer's own message -- who read it, who has
/// it, who does not yet. Seated members only, exactly as the server answers;
/// times on the account's own clock (PD-22).
class MessageInfoSheet extends StatelessWidget {
  const MessageInfoSheet({super.key, required this.load});

  final Future<MessageInfo> load;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return SafeArea(
      child: FutureBuilder<MessageInfo>(
        future: load,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Padding(
              padding: const EdgeInsets.all(Spacing.spacing5),
              child: Text(l10n.messageInfoFailed),
            );
          }
          final info = snapshot.data;
          if (info == null) {
            return const Padding(
              padding: EdgeInsets.all(Spacing.spacing5),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return SingleChildScrollView(
            padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l10n.messageInfoAction, style: Theme.of(context).textTheme.titleMedium),
                _Section(title: l10n.messageInfoReadBy, people: info.readBy),
                _Section(title: l10n.messageInfoDeliveredTo, people: info.deliveredTo),
                _Section(title: l10n.messageInfoPending, people: info.pending),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.people});

  final String title;
  final List<MessageInfoEntry> people;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final local = MaterialLocalizations.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: Spacing.spacing5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(title, style: Theme.of(context).textTheme.labelLarge)),
          if (people.isEmpty)
            Padding(
              padding: const EdgeInsetsDirectional.only(top: Spacing.spacing2),
              child: Text(l10n.messageInfoNobody, style: Theme.of(context).textTheme.bodySmall),
            ),
          for (final p in people)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: JawwidAvatar(displayName: p.displayName, imageUrl: p.avatarUrl),
              title: ContentText(p.displayName, maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: p.at == null
                  ? null
                  : Text(() {
                      final at = AppClock.view(p.at!);
                      return '${local.formatShortDate(at)} ${local.formatTimeOfDay(TimeOfDay.fromDateTime(at))}';
                    }()),
            ),
        ],
      ),
    );
  }
}

/// PD-37: "Noura is typing…", just above the composer. Announced to screen
/// readers politely, as it changes.
class TypingRow extends StatelessWidget {
  const TypingRow({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, 0),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: ContentText(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.primary,
              fontStyle: FontStyle.italic,
            ),
          ),
        ),
      ),
    );
  }
}
