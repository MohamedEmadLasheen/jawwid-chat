@TestOn('mac-os')
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// THE SINGLE-ENGINE INVARIANT, guarded as configuration (W8-W3).
///
/// This is not a unit test of Dart code. It is a regression guard for a defect
/// that lives entirely in iOS project configuration and would therefore never
/// appear in any Dart or widget test, never fail a build, and only show itself
/// on a device -- as a second realtime connection, a second push registration
/// and a call that answers on one engine while the screen renders from another.
///
/// `Main.storyboard` names a bare `FlutterViewController`. That initializer
/// implicitly creates its OWN `FlutterEngine`. So the moment `AppDelegate` owns
/// an explicit engine, any surviving path that loads the storyboard as the
/// main interface gives the process two of everything.
///
/// The storyboard file is deliberately left in the project -- the smallest safe
/// change was to stop pointing at it, not to delete it -- so what has to be
/// asserted is that NOTHING points at it any more.
void main() {
  final infoPlist = File('ios/Runner/Info.plist');
  final appDelegate = File('ios/Runner/AppDelegate.swift');
  final sceneDelegate = File('ios/Runner/SceneDelegate.swift');

  group('A. the storyboard cannot create a second engine', () {
    test('no Info.plist key names a main storyboard', () {
      final plist = infoPlist.readAsStringSync();

      // UILaunchStoryboardName is the launch IMAGE and instantiates no view
      // controller; it is unaffected and stays.
      expect(plist, isNot(contains('UIMainStoryboardFile')));
      expect(plist, isNot(contains('UISceneStoryboardFile')));
    });

    test('the scene attaches to the existing engine, never a bare one', () {
      final scene = sceneDelegate.readAsStringSync();

      expect(scene, contains('FlutterViewController('));
      expect(scene, contains('engine: engine'));
      // A bare `FlutterViewController()` is the form that builds its own
      // engine. It must appear nowhere.
      expect(scene, isNot(contains('FlutterViewController()')));
    });
  });

  group('B. exactly one engine is constructed, in one place', () {
    test('AppDelegate is the only file that constructs an engine', () {
      for (final file in [appDelegate, sceneDelegate]) {
        final source = file.readAsStringSync();
        final constructions = RegExp(r'FlutterEngine\(\s*$', multiLine: true)
            .allMatches(source)
            .length;
        expect(
          constructions,
          file.path == appDelegate.path ? 1 : 0,
          reason: '${file.path} constructs $constructions engines',
        );
      }
    });

    test('the construction is guarded, so a second call reuses the first', () {
      final source = appDelegate.readAsStringSync();

      // `ensureEngine()` returns early when one already exists. Without this a
      // VoIP push arriving at a running app would build a second engine.
      expect(source, contains('if let engine { return engine }'));
      // Headless execution is what lets it keep running with no view
      // controller attached -- the terminated-wake case.
      expect(source, contains('allowHeadlessExecution: true'));
    });

    test('NO FlutterEngineGroup anywhere', () {
      for (final file in [appDelegate, sceneDelegate]) {
        expect(file.readAsStringSync(), isNot(contains('FlutterEngineGroup')));
      }
    });
  });

  group('C. the entitlement PushKit needs is present', () {
    test('aps-environment is declared', () {
      // Without it the app registers for no APNs or VoIP token at all and the
      // entire push path is inert, whatever the server is configured with.
      final entitlements =
          File('ios/Runner/Runner.entitlements').readAsStringSync();

      expect(entitlements, contains('aps-environment'));
    });

    test('the VoIP background mode is declared', () {
      expect(infoPlist.readAsStringSync(), contains('<string>voip</string>'));
    });
  });
}
