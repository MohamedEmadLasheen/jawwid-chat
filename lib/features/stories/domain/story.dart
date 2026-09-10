/// One entry in the stories rail.
///
/// **No feature behind this exists yet.** There is no story or status concept anywhere in
/// the product: not in the backend contract, not in `ConversationRepository`, not in the
/// design documents. This type is the shape a story would have to arrive in, defined so the
/// rail is real, testable code rather than a sketch — and so that switching the feature on
/// is a repository implementation plus one provider override, with no UI work.
///
/// Nothing in the app constructs one from fixtures. The rail renders nothing until a real
/// source supplies real rings.
class StoryRing {
  const StoryRing({
    required this.id,
    required this.authorName,
    required this.postedAt,
    this.avatarUrl,
    this.isViewed = false,
    this.isOwn = false,
  });

  final String id;

  /// A display name, never a phone number (§5).
  final String authorName;
  final String? avatarUrl;
  final DateTime postedAt;

  /// Drives the ring treatment: unviewed rings are brand-coloured, viewed ones are a muted
  /// border. Never colour alone — the rail also orders unviewed first (§53).
  final bool isViewed;

  /// The viewer's own entry, which leads the rail in every messaging app people already
  /// know. Rendered only when the product actually supports *creating* a story; an
  /// always-present "Your story" button that cannot post anything is a dead affordance.
  final bool isOwn;
}
