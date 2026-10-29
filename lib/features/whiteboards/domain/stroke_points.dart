import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui';

/// One sampled pen point on the page (1920 × 1080 logical units), with the
/// pressure the device reported (0..1; 0.5 when it reports none).
class StrokePoint {
  const StrokePoint(this.x, this.y, [this.pressure = 0.5]);

  final double x;
  final double y;
  final double pressure;

  Offset get offset => Offset(x, y);
}

/// PD-39: a stroke's points, packed so a page stays well under the server's
/// 512 KB (docs/product/pd039-whiteboard-design.md §4.5).
///
/// Coordinates are quantised to 0.1 unit. The first point is absolute (two
/// int32), every next one a delta (two int16, split into extra points if a
/// jump is longer than an int16 allows), and each point carries its pressure
/// as one byte. The bytes are base64: about 7 characters a point instead of
/// ~30 for JSON numbers.
class StrokePointCodec {
  const StrokePointCodec._();

  static const double _unit = 10; // 0.1 logical unit per step

  static String encode(List<StrokePoint> points) {
    if (points.isEmpty) return '';
    final out = BytesBuilder(copy: false);
    final head = ByteData(9)
      ..setInt32(0, (points.first.x * _unit).round(), Endian.little)
      ..setInt32(4, (points.first.y * _unit).round(), Endian.little)
      ..setUint8(8, _pressureByte(points.first.pressure));
    out.add(head.buffer.asUint8List());
    var px = (points.first.x * _unit).round();
    var py = (points.first.y * _unit).round();
    for (final p in points.skip(1)) {
      final x = (p.x * _unit).round();
      final y = (p.y * _unit).round();
      final dx = x - px;
      final dy = y - py;
      // A jump longer than an int16 becomes several steps on the same line.
      final steps = ((dx.abs() > dy.abs() ? dx.abs() : dy.abs()) / 32767).ceil().clamp(1, 1 << 16);
      for (var s = 1; s <= steps; s++) {
        final sx = (dx * s / steps).round() - (dx * (s - 1) / steps).round();
        final sy = (dy * s / steps).round() - (dy * (s - 1) / steps).round();
        final d = ByteData(5)
          ..setInt16(0, sx, Endian.little)
          ..setInt16(2, sy, Endian.little)
          ..setUint8(4, _pressureByte(p.pressure));
        out.add(d.buffer.asUint8List());
      }
      px = x;
      py = y;
    }
    return base64Encode(out.takeBytes());
  }

  /// The points of [encoded]; an empty or damaged value gives no points rather
  /// than throwing, so one bad stroke never stops a page from opening.
  static List<StrokePoint> decode(String encoded) {
    if (encoded.isEmpty) return const [];
    final Uint8List bytes;
    try {
      bytes = base64Decode(encoded);
    } on FormatException {
      return const [];
    }
    if (bytes.length < 9 || (bytes.length - 9) % 5 != 0) return const [];
    final data = ByteData.sublistView(bytes);
    var x = data.getInt32(0, Endian.little);
    var y = data.getInt32(4, Endian.little);
    final points = <StrokePoint>[StrokePoint(x / _unit, y / _unit, data.getUint8(8) / 255)];
    for (var i = 9; i < bytes.length; i += 5) {
      x += data.getInt16(i, Endian.little);
      y += data.getInt16(i + 2, Endian.little);
      points.add(StrokePoint(x / _unit, y / _unit, data.getUint8(i + 4) / 255));
    }
    return points;
  }

  static int _pressureByte(double p) => (p.clamp(0.0, 1.0) * 255).round();
}
