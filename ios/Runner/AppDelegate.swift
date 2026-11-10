import Flutter
import PushKit
import UserNotifications
import UIKit

/**
 * Push tokens, the VoIP wake-up, and THE ONE FLUTTER ENGINE (W8-W1, W8-W3).
 *
 * ## One engine, owned here
 *
 * W8-W1 used the implicit engine, which the scene creates when it connects.
 * That cannot serve a terminated VoIP wake: a push arrives with no UI scene, so
 * no engine is created, so there is no Dart to answer the call the system has
 * already put on screen.
 *
 * So the engine is explicit, created here, retained for the process lifetime,
 * and run ONCE with `main()`. `-runWithEntrypoint:` creates the isolate on its
 * first call and is documented to do nothing on any later one, which is what
 * makes "one engine, one isolate" a property of the API rather than a
 * convention this file is trying to keep.
 *
 * The "headless" state is not a second mode and not a second entrypoint. It is
 * this same engine running with no `FlutterViewController` attached. `SceneDelegate`
 * attaches one when a scene connects; before that, Dart is already running,
 * already authenticated and already listening for the call.
 *
 * `allowHeadlessExecution` is what permits that. Without it the engine would
 * shut down the moment it had no view controller, which on a cold wake is
 * immediately.
 *
 * ## Two tokens, two channels
 *
 * iOS issues a standard APNs token for ordinary notifications and a separate
 * PushKit token for VoIP. The server keeps them apart deliberately -- a PushKit
 * delivery obliges an immediate CallKit report, so a VoIP token may only ever
 * carry a call. Both are reported here with their kind; the server decides what
 * each receives.
 *
 * ## What is still NOT here
 *
 * Any decision about a call. This file wakes the app and hands over; the call
 * lifecycle is the server's and reaches the client over the realtime
 * connection. See `CallKitBridge.swift`.
 */
@main
@objc class AppDelegate: FlutterAppDelegate {
  /// THE engine. One per process, for the life of the process.
  private(set) var engine: FlutterEngine?

  /// The system call screen. Presentation only.
  let callKit = CallKitBridge()

  private var pushChannel: FlutterMethodChannel?
  private var voipRegistry: PKPushRegistry?

  /// Tokens that arrived before Flutter was listening. The platform hands them
  /// over when it is ready, which is not when Dart asks.
  private var pendingTokens: [[String: String]] = []

  /// Shared with `push_tokens.dart`. One string, three places.
  private static let pushChannelName = "jawwid/push_tokens"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    ensureEngine()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /**
   * Create and run the engine, at most once.
   *
   * Called from a normal launch and from a VoIP push. Whichever happens first
   * creates it; the other finds it already there. There is no path that builds
   * a second one, and `SceneDelegate` never creates one at all.
   */
  @discardableResult
  func ensureEngine() -> FlutterEngine {
    if let engine { return engine }

    let engine = FlutterEngine(
      name: "jawwid",
      project: nil,
      allowHeadlessExecution: true,
      restorationEnabled: false
    )
    // `main()`, the single Dart entrypoint. It calls `runApp` as it always has:
    // a widget tree with no view controller attached simply is not rendered,
    // and renders as soon as one is.
    engine.run()
    GeneratedPluginRegistrant.register(with: engine)

    let pushChannel = FlutterMethodChannel(
      name: AppDelegate.pushChannelName,
      binaryMessenger: engine.binaryMessenger
    )
    self.pushChannel = pushChannel
    pushChannel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "start":
        self?.startRegistering()
        result(nil)
      case "register":
        // LR-11: tokens without the prompt. Answers whether `start` could still
        // show iOS's notification prompt (only while it has never been answered).
        self?.registerForPush()
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          let promptPossible = settings.authorizationStatus == .notDetermined
          DispatchQueue.main.async { result(promptPossible) }
        }
      case "permissionStatus":
        // LR-11b: the status the Settings row shows. iOS asks once only, so any
        // refusal is `blocked` (only Settings can change it); there is no `denied`.
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          let status: String
          switch settings.authorizationStatus {
          case .authorized, .provisional, .ephemeral: status = "granted"
          case .notDetermined: status = "notDetermined"
          case .denied: status = "blocked"
          @unknown default: status = "unknown"
          }
          DispatchQueue.main.async { result(status) }
        }
      case "openNotificationSettings":
        // LR-11b "Open settings": this app's notification settings on iOS 16+,
        // this app's Settings page before that.
        let urlString: String
        if #available(iOS 16.0, *) {
          urlString = UIApplication.openNotificationSettingsURLString
        } else {
          urlString = UIApplication.openSettingsURLString
        }
        guard let url = URL(string: urlString) else {
          result(false)
          return
        }
        UIApplication.shared.open(url, options: [:]) { opened in result(opened) }
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    callKit.attach(messenger: engine.binaryMessenger)

    self.engine = engine

    // Anything that arrived before Dart attached.
    for token in pendingTokens { pushChannel.invokeMethod("onToken", arguments: token) }
    pendingTokens.removeAll()

    return engine
  }

  /// Ask iOS for both tokens. Safe to call repeatedly.
  ///
  /// A standard APNs token alone shows the person nothing: without notification
  /// authorization iOS presents no banner, sound or badge. So this asks for it
  /// here, when a session begins (after sign-in, the moment a notification first
  /// matters, never at launch). iOS shows the prompt once; later calls answer from
  /// the person's choice without asking. A refusal changes nothing else: the token
  /// is still registered, and calls still ring through PushKit and CallKit, which
  /// need no such authorization.
  private func startRegistering() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    registerForPush()
  }

  /// Both tokens, and NO authorization prompt (LR-11 `register`): the app explains
  /// notifications first and asks through `start` only after Continue. Neither token
  /// needs the authorization, and PushKit calls ring without it.
  private func registerForPush() {
    DispatchQueue.main.async {
      UIApplication.shared.registerForRemoteNotifications()
    }

    guard voipRegistry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    voipRegistry = registry
  }

  /// Hand a token to Flutter, or hold it until Flutter is there.
  private func report(token: Data, kind: String) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    let payload = ["token": hex, "platform": "ios", "kind": kind]

    if let pushChannel {
      pushChannel.invokeMethod("onToken", arguments: payload)
    } else {
      pendingTokens.append(payload)
    }
  }

  // MARK: - Standard APNs

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    report(token: deviceToken, kind: "standard")
    super.application(
      application,
      didRegisterForRemoteNotificationsWithDeviceToken: deviceToken
    )
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    // Not fatal, and not reported to Dart as a token: the app works without
    // push, it simply will not notify while closed. The error is not logged --
    // it can carry identifiers, and this file logs nothing.
    super.application(
      application,
      didFailToRegisterForRemoteNotificationsWithError: error
    )
  }
}

// MARK: - PushKit

extension AppDelegate: PKPushRegistryDelegate {
  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard type == .voIP else { return }
    report(token: pushCredentials.token, kind: "voip")
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    // The server retires a token when a provider rejects it permanently; there
    // is nothing to report here, and inventing a "token gone" message would be
    // a second source of truth about a device's registration.
  }

  /**
   * A VoIP push. THE ORDER HERE IS NOT NEGOTIABLE.
   *
   * CallKit is told first and the engine is started second, because iOS
   * requires a call to be reported before `completion` runs and will terminate
   * the app otherwise. Engine startup is slow, variable and, on a cold wake,
   * involves reading the keychain and opening a socket. None of that may sit
   * between the push and the report.
   *
   * Nothing here decides anything about the call. The payload's `callId` is
   * correlation, not permission: answering it sends a request the server
   * re-authorizes in full, and a push for a call that has already ended is
   * refused there.
   */
  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }

    let data = payload.dictionaryPayload
    let callId = data["callId"] as? String
    let conversationId = data["conversationId"] as? String

    callKit.reportIncoming(callId: callId, conversationId: conversationId) { [weak self] in
      // Only now, and only if it is not already running.
      self?.ensureEngine()
      completion()
    }
  }
}
