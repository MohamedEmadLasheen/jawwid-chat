import '../../l10n/app_localizations.dart';
import '../models/system_event.dart';

/// Turns a [SystemEvent] into the sentence a reader sees.
///
/// ## One mapping, in one place
///
/// A system line appears in two surfaces — inside the conversation, and as the
/// last-message preview on the chat list — and those two must never say
/// different things about the same event. So the mapping lives here rather than
/// in either widget, and both call it.
///
/// ## An unknown kind is a rendering decision, not a failure
///
/// The backend may add a kind at any time, and an older client will meet it.
/// The options are to render nothing (the group appears to have changed for no
/// reason), to render the payload (the defect this whole change removes), or to
/// say something true but general. The third is the only honest one, so an
/// unrecognised kind becomes "Jawwid updated this conversation" — accurate for
/// every event this system emits, and it cannot leak an implementation detail.
///
/// It goes through [L10n] like every other string, so Arabic and English are
/// the same mechanism rather than a second localisation path (§46).
abstract final class SystemEventText {
  /// Never returns an empty string, and never returns raw payload data.
  static String format(SystemEvent event, L10n l10n) {
    switch (event.kind) {
      case 'group.created':
        final learner = event.param('learner');
        return learner == null
            ? l10n.systemGroupCreatedUnnamed
            : l10n.systemGroupCreated(learner);

      case 'group.membership_changed':
        final added = int.tryParse(event.param('added') ?? '') ?? 0;
        final removed = int.tryParse(event.param('removed') ?? '') ?? 0;

        // The common cases read naturally; a change that did both, or whose
        // counts did not arrive, falls back to the general sentence rather
        // than stitching two clauses together in two languages.
        if (added > 0 && removed == 0) return l10n.systemGroupMembersJoined(added);
        if (removed > 0 && added == 0) return l10n.systemGroupMembersLeft(removed);
        return l10n.systemGroupMembersChanged;

      case 'group.archived':
        // The stored payload carries a `reason`, which is operational context
        // written for staff. It is deliberately NOT shown to a family.
        return l10n.systemGroupArchived;

      default:
        return l10n.systemEventUnknown;
    }
  }
}
