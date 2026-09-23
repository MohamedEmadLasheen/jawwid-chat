import 'package:url_launcher/url_launcher.dart';

/// Hands a document to the phone to open.
///
/// ## Why the phone and not this app
///
/// Jawwid Chat has no PDF viewer, no spreadsheet renderer, and should not grow
/// one: every phone already has something that opens these, chosen by the
/// person who owns the phone. Handing the file over is both less code and a
/// better result than a half-built viewer.
///
/// ## What it is handed
///
/// The **short-lived signed URL the backend minted for this reader**, never a
/// storage path and never a permanent address (§22, §25). It expires, it was
/// issued to this actor, and it is the same URL the app itself would fetch — so
/// opening it externally grants nothing the reader did not already have. When
/// it has expired the system browser gets a refusal from storage, and the fix
/// is to reopen the conversation, which mints a fresh one.
abstract interface class AttachmentOpener {
  /// Returns false when nothing on the device could open it, so the caller can
  /// say so rather than leaving a tap that did nothing.
  Future<bool> open(String url);
}

class PluginAttachmentOpener implements AttachmentOpener {
  const PluginAttachmentOpener();

  @override
  Future<bool> open(String url) async {
    final uri = Uri.tryParse(url);
    // A local path is not something to hand to the system browser. An
    // attachment still uploading has one, and its bubble does not offer Open —
    // this is the belt to that braces.
    if (uri == null || !uri.hasScheme || !uri.scheme.startsWith('http')) {
      return false;
    }

    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on Exception {
      // A device with no handler throws rather than returning false on some
      // platforms. Either way the answer to "did it open?" is no.
      return false;
    }
  }
}
