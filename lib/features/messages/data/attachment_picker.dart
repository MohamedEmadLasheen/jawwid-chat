import 'package:file_picker/file_picker.dart';

import '../domain/outgoing_attachment.dart';

/// Choosing a file, as the composer sees it.
///
/// An interface so the send pipeline is testable without a platform picker —
/// there is no file dialog in a widget test, and the interesting behaviour
/// (what is accepted, what is refused, what happens when the upload fails) has
/// nothing to do with how the file was chosen.
abstract interface class AttachmentPicker {
  /// Returns null when the user backed out. Cancelling is not an error.
  Future<PickedAttachment?> pick();
}

/// The platform picker.
///
/// ONE picker for every kind. `image_picker` plus a separate document picker
/// would be two overlapping frameworks, two permission prompts and two
/// cancellation stories behind a single paperclip.
class FilePickerAttachmentPicker implements AttachmentPicker {
  const FilePickerAttachmentPicker();

  @override
  Future<PickedAttachment?> pick() async {
    // `pickFile`, not `pickFiles`: the user picks one thing per send.
    // Multi-select would need a queue, a per-file progress model and a
    // partial-failure story, none of which the composer has.
    //
    // The bytes are deliberately NOT read here. The uploader streams them from
    // disk, and loading a 100 MB video into memory first is how a modest phone
    // runs out of it.
    final file = await FilePicker.pickFile();

    // Null means the user backed out; a file with no local path means the
    // platform handed back something that is not on disk (a cloud placeholder),
    // which this uploader cannot stream.
    final path = file?.path;
    if (file == null || path == null) return null;

    final size = file.lengthSync() ?? await file.length();

    // An unsupported extension comes back as a PickedAttachment with no kind,
    // NOT as null: null means the user cancelled, and telling somebody "no file
    // selected" when they picked a .exe explains nothing. The caller names the
    // file it refused.
    final classified = AttachmentLimits.classify(file.name);

    return PickedAttachment(
      path: path,
      fileName: file.name,
      byteSize: size,
      kind: classified?.$1,
      mimeType: classified?.$2,
    );
  }
}
