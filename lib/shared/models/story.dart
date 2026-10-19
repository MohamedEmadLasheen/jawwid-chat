/// A story, exactly as `GET /stories/feed` returns one.
///
/// This mirrors the backend's `StoryFeedItem` (`apps/api/src/communication/stories/
/// story.service.ts`) and deliberately adds nothing to it. In particular it carries no
/// author: the feed omits `createdBy` on purpose, because a reader has no business learning
/// which member of staff wrote an academy publication. Every story a reader sees comes from
/// the academy, which is why the rail labels the publisher from localisation rather than from
/// a field that does not exist.
///
/// It also carries no audience, no recipient count and no viewer list. Those are the
/// publisher's surfaces in Admin Web; the read client is not entitled to them and so is never
/// sent them.
///
/// ## Since 2026-10-17 (owner decisions)
///
/// * No title and no caption. [body] is the words of a TEXT story and nothing else; a photo,
///   video or voice story has none, and the server sends none.
/// * Four kinds: text, photo, video, voice ([StoryKind]).
/// * A story does not expire: [expiresAt] is null for every story published since. A story
///   published before still carries one and still ends on it.
/// * At most one button ([StoryCta]): WhatsApp, a link, or "message the publisher".
library;

enum StoryMediaKind {
  image,
  video,
  audio;

  static StoryMediaKind? tryParse(String? raw) => switch (raw) {
        'image' => StoryMediaKind.image,
        'video' => StoryMediaKind.video,
        'audio' => StoryMediaKind.audio,
        _ => null,
      };
}

/// What the viewer renders.
enum StoryKind {
  text,
  image,
  video,
  voice;

  static StoryKind fromWire(String? raw, StoryMediaKind? media) => switch (raw) {
        'text' => StoryKind.text,
        'image' => StoryKind.image,
        'video' => StoryKind.video,
        'voice' => StoryKind.voice,
        // An older server sends no `kind`; the media says what it is.
        _ => switch (media) {
            StoryMediaKind.image => StoryKind.image,
            StoryMediaKind.video => StoryKind.video,
            StoryMediaKind.audio => StoryKind.voice,
            null => StoryKind.text,
          },
      };
}

enum StoryCtaKind {
  whatsapp,
  messagePublisher,
  link;

  static StoryCtaKind? tryParse(String? raw) => switch (raw) {
        'whatsapp' => StoryCtaKind.whatsapp,
        'message_publisher' => StoryCtaKind.messagePublisher,
        'link' => StoryCtaKind.link,
        _ => null,
      };
}

/// A story's one button.
///
/// [url] is built by the server -- the link itself, or a wa.me address for WhatsApp -- and is
/// never assembled here. For [StoryCtaKind.messagePublisher] it is null: that tap is answered
/// by the server with a conversation to open.
class StoryCta {
  const StoryCta({required this.kind, this.label, this.url});

  final StoryCtaKind kind;

  /// The publisher's wording, or null for the app's default for [kind].
  final String? label;
  final String? url;
}

/// What tapping the button resolved to.
class StoryCtaTap {
  const StoryCtaTap({required this.kind, this.url, this.conversationId});

  final StoryCtaKind kind;
  final String? url;
  final String? conversationId;
}

class Story {
  const Story({
    required this.id,
    required this.publishedAt,
    required this.isViewed,
    this.kind = StoryKind.text,
    this.expiresAt,
    this.body,
    this.background,
    this.mediaKind,
    this.mediaUrl,
    this.mediaDuration,
    this.cta,
  });

  final String id;
  final StoryKind kind;

  /// The words of a TEXT story. Null for every other kind.
  final String? body;

  /// A text or voice story's background, by name (`teal`, `gold`, ...). Null means the
  /// default.
  final String? background;

  /// Null when the story is words only. Also null once the media has been purged, in which
  /// case [mediaUrl] is null too — the server stops describing media it will not serve.
  final StoryMediaKind? mediaKind;

  /// A short-lived signed URL, minted by the server for this request only.
  ///
  /// Never stored, never rebuilt, never turned into a storage path. The client's whole job
  /// is to hand it to the player or image loader before it lapses; if it lapses mid-view the
  /// load fails and the viewer says so, which is the correct outcome rather than something to
  /// work around.
  final String? mediaUrl;

  /// The length the publisher's upload reported, for a voice or video story. A hint for the
  /// UI before the player knows; the player's own duration wins once it does.
  final Duration? mediaDuration;

  final StoryCta? cta;

  final DateTime publishedAt;

  /// When the server stops serving this story, or null: stories published since 2026-10-17
  /// do not expire. The server enforces a non-null one on every read; this is here so the
  /// client can avoid opening something it already knows is over.
  ///
  /// It is NOT an authorization decision. A client that trusted only this would still be
  /// refused by the API, which is the point.
  final DateTime? expiresAt;

  final bool isViewed;

  bool get hasMedia => mediaUrl != null && mediaKind != null;

  bool isExpiredAt(DateTime now) => expiresAt != null && !expiresAt!.isAfter(now);

  Story copyWith({bool? isViewed}) => Story(
        id: id,
        kind: kind,
        body: body,
        background: background,
        mediaKind: mediaKind,
        mediaUrl: mediaUrl,
        mediaDuration: mediaDuration,
        cta: cta,
        publishedAt: publishedAt,
        expiresAt: expiresAt,
        isViewed: isViewed ?? this.isViewed,
      );
}
