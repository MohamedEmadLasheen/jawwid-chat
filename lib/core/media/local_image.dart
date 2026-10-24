import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// A photo this device picked, captured or is still uploading, as an image.
///
/// On a phone that is a file path. In the PD-28 web portal the pickers hand back a `blob:`
/// URL instead -- the browser's own handle on the bytes -- which `Image.file` cannot open and
/// an ordinary network image can.
ImageProvider localImageProvider(String path) =>
    kIsWeb ? NetworkImage(path) : FileImage(File(path));
