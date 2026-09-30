import Flutter
import UIKit

/**
 * Attaches a view to THE engine. It never creates one (W8-W3).
 *
 * The storyboard used to do this, and did it the wrong way: `Main.storyboard`
 * names a bare `FlutterViewController`, and that initializer implicitly creates
 * its OWN `FlutterEngine`. With the engine now owned by `AppDelegate`, loading
 * that storyboard would give the process a second engine, a second isolate, a
 * second ProviderContainer and a second realtime connection -- silently, and
 * only in the build, never in a test. The storyboard keys are removed from
 * `Info.plist` for that reason and the window is built here instead.
 *
 * `FlutterViewController(engine:)` is the documented way to show an engine that
 * is already running. On a cold VoIP wake that engine has been running since
 * the push: Dart is authenticated and listening, and this only gives it
 * somewhere to draw when the person actually opens the call.
 *
 * Multiple scenes are disabled (`UIApplicationSupportsMultipleScenes` is
 * false), so Flutter registers the engine for scene lifecycle events itself
 * once this view enters the hierarchy. Nothing is registered manually here.
 */
class SceneDelegate: FlutterSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)

    guard let windowScene = scene as? UIWindowScene else { return }
    guard
      let delegate = UIApplication.shared.delegate as? AppDelegate
    else { return }

    // Already running on a push wake; created now on a normal launch. Either
    // way there is exactly one.
    let engine = delegate.ensureEngine()

    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = FlutterViewController(
      engine: engine,
      nibName: nil,
      bundle: nil
    )
    self.window = window
    window.makeKeyAndVisible()
  }
}
