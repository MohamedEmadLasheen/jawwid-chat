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
library;

enum StoryMediaKind {
  image,
  video;

  static StoryMediaKind? tryParse(String? raw) => switch (raw) {
        'image' => StoryMediaKind.image,
        'video' => StoryMediaKind.video,
        _ => null,
      };
}

class Story {
  const Story({
    required this.id,
    required this.publishedAt,
    required this.expiresAt,
    required this.isViewed,
    this.title,
    this.body,
    this.mediaKind,
    this.mediaUrl,
  });

  final String id;
  final String? title;
  final String? body;

  /// Null when the story is words only. Also null once the media has been purged, in which
  /// case [mediaUrl] is null too — the server stops describing media it will not serve.
  final StoryMediaKind? mediaKind;

  /// A short-lived signed URL, minted by the server for this request only.
  ///
  /// Never stored, never rebuilt, never turned into a storage path. The client's whole job
  /// is to hand it to the image loader before it lapses; if it lapses mid-view the load
  /// fails and the viewer says so, which is the correct outcome rather than something to
  /// work around.
  final String? mediaUrl;

  final DateTime publishedAt;

  /// When the server stops serving this story. The server enforces it on every read; this is
  /// here so the client can avoid opening something it already knows is over, and so the
  /// viewer can stop rather than sit on a story the next request would refuse.
  ///
  /// It is NOT an authorization decision. A client that trusted only this would still be
  /// refused by the API, which is the point.
  final DateTime expiresAt;

  final bool isViewed;

  bool get hasMedia => mediaUrl != null && mediaKind != null;

  bool isExpiredAt(DateTime now) => !expiresAt.isAfter(now);

  Story copyWith({bool? isViewed}) => Story(
        id: id,
        title: title,
        body: body,
        mediaKind: mediaKind,
        mediaUrl: mediaUrl,
        publishedAt: publishedAt,
        expiresAt: expiresAt,
        isViewed: isViewed ?? this.isViewed,
      );
}
