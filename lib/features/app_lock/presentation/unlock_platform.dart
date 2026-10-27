import 'package:flutter/material.dart';

/// Which platform's names the App lock copy uses for the ways to unlock (the
/// `platform` of `appLockToggle`, `appLockUnavailable` and `appLockOfferBody`).
///
/// Android has no Face ID and no "passcode": it says fingerprint, face unlock and
/// screen lock. Read from the theme rather than the OS, so a test can ask for either
/// and the copy always matches the platform the app is drawn as.
String unlockPlatform(BuildContext context) =>
    Theme.of(context).platform == TargetPlatform.android ? 'android' : 'other';
