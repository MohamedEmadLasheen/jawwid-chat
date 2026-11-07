import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';

void main() {
  // LR-35: the server's `file` allow-list refuses text/csv, so the picker must not offer it.
  test('the document picker does not offer CSV', () {
    expect(documentTypeGroup.extensions, isNot(contains('csv')));
    expect(documentTypeGroup.mimeTypes, isNot(contains('text/csv')));
    expect(documentTypeGroup.uniformTypeIdentifiers, isNot(contains('public.comma-separated-values-text')));
  });

  test('the document picker still offers the allowed documents', () {
    expect(
      documentTypeGroup.extensions,
      containsAll(<String>['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']),
    );
  });
}
