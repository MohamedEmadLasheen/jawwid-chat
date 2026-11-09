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
 * ## Ordinary pushes: shown, and opened where they point (PD-32 amendment)
 *
 * iOS draws an ordinary (alert) push itself while the app is closed or in the
 * background. While it is open, `willPresent` decides: shown as a banner,
 * except chat traffic the app already shows in its own UI. A tap reaches
 * `didReceive` in every state -- including the one that launched a closed app,
 * which is why the delegate is set before launch finishes. The tap's ids
 * (allowlisted, id-shaped: `PushOpenPayload`) wait in `pendingOpens` until Dart
 * says it is listening on `jawwid/push_opens`, then Dart routes them. Permission
 * to show alerts is asked when a session starts (`start`), never at launch.
 * Calls are untouched: they are VoIP pushes, which never come through here.
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

  /// Whether Dart has asked for tokens (`start`). Until then the VoIP token stays
  /// in the registry (`pushToken(for:)`) instead of going to a Dart that is not
  /// listening for it yet; `startRegistering` reads and reports it.
  private var voipTokensWanted = false

  /// Tokens that arrived before Flutter was listening. The platform hands them
  /// over when it is ready, which is not when Dart asks.
  private var pendingTokens: [[String: String]] = []

  /// Shared with `push_tokens.dart`. One string, three places.
  private static let pushChannelName = "jawwid/push_tokens"

  /// Shared with `push_opens.dart`.
  private static let opensChannelName = "jawwid/push_opens"

  private var opensChannel: FlutterMethodChannel?

  /// Taps that arrived before Dart was listening -- the one that launched the app.
  private var pendingOpens: [[String: String]] = []
  private var opensListening = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Before launch finishes: the tap that launched a closed app is delivered to the
    // delegate set by then, and to no other.
    UNUserNotificationCenter.current().delegate = self
    // LR-13: PushKit's rule. A VoIP push that relaunches a killed app is delivered only
    // to a registry that exists, with its delegate set, by the time launch finishes, and
    // a push the app does not report to CallKit gets it terminated (and, repeated, stops
    // VoIP delivery). So the registry is made here, independent of Dart. Its token still
    // reaches Dart only once a session asks (`startRegistering`).
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    voipRegistry = registry
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
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    callKit.attach(messenger: engine.binaryMessenger)

    let opensChannel = FlutterMethodChannel(
      name: AppDelegate.opensChannelName,
      binaryMessenger: engine.binaryMessenger
    )
    self.opensChannel = opensChannel
    opensChannel.setMethodCallHandler { [weak self] call, result in
      // Sign-out: the previous account's notifications leave Notification Center.
      if call.method == "clearDelivered" {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        result(nil)
        return
      }
      guard call.method == "listen", let self else {
        result(FlutterMethodNotImplemented)
        return
      }
      self.opensListening = true
      let waiting = self.pendingOpens
      self.pendingOpens.removeAll()
      for open in waiting { self.deliverOpen(open) }
      result(nil)
    }

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

    // The registry has existed since launch (LR-13), so its token may already be
    // here. It was held back until a session asked; hand over the current one now.
    // Every session start reports it, as `registerForRemoteNotifications` does
    // for the standard token; Dart and the server both treat a repeat as a no-op.
    voipTokensWanted = true
    if let token = voipRegistry?.pushToken(for: .voIP) {
      report(token: token, kind: "voip")
    }
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

// MARK: - Ordinary pushes: shown while open, and tapped

extension AppDelegate {
  /// The app is open: show an ordinary push as a banner, except chat the app already shows.
  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let userInfo = notification.request.content.userInfo
    guard PushOpenPayload.isOurs(userInfo) else {
      super.userNotificationCenter(center, willPresent: notification, withCompletionHandler: completionHandler)
      return
    }
    completionHandler(PushOpenPayload.showWhileOpen(userInfo) ? [.banner, .list, .sound] : [])
  }

  /// A tap, in any state. Ours is routed by Dart; anything else goes where it went before.
  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    guard
      PushOpenPayload.isOurs(userInfo),
      response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let open = PushOpenPayload.from(userInfo)
    else {
      super.userNotificationCenter(center, didReceive: response, withCompletionHandler: completionHandler)
      return
    }
    deliverOpen(open)
    completionHandler()
  }

  /// To Dart if it is listening, else held until it is.
  fileprivate func deliverOpen(_ open: [String: String]) {
    guard opensListening, let opensChannel else {
      pendingOpens.append(open)
      return
    }
    opensChannel.invokeMethod("onOpen", arguments: open)
  }
}

/**
 * What an ordinary push's tap may carry into the app (PD-32 amendment). A push is
 * data from outside the app: only the known keys, only values shaped like ids. An id
 * is a pointer, never a permission -- the screen it opens re-reads the item through
 * the signed-in account's own route. A call is never routed here.
 */
enum PushOpenPayload {
  /// Matches the server's CALL_EVENT_TYPES (call-push-routing.ts).
  static let callEvents: Set<String> = ["call_started", "group_call_started"]
  /// Chat the open app already shows in its own UI.
  static let quietWhileOpen: Set<String> = ["message_published", "mention_created"]
  static let keys = [
    "eventType", "notificationId", "actionKind",
    "feedbackId", "conversationId", "learnerId", "lessonId", "taskId",
  ]

  private static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }

  private static func valid(_ key: String, _ value: String) -> Bool {
    key == "eventType" || key == "actionKind"
      ? matches(value, "^[a-z][a-z0-9_]{0,39}$")
      : matches(value, "^[0-9A-Za-z-]{1,64}$")
  }

  /// Sent by Jawwid's server: it has an event type of the server's shape.
  static func isOurs(_ userInfo: [AnyHashable: Any]) -> Bool {
    guard let event = userInfo["eventType"] as? String else { return false }
    return valid("eventType", event)
  }

  static func showWhileOpen(_ userInfo: [AnyHashable: Any]) -> Bool {
    guard let event = userInfo["eventType"] as? String else { return false }
    return !callEvents.contains(event) && !quietWhileOpen.contains(event)
  }

  /// The allowlisted, id-shaped subset; nil for a call or a push that is not ours.
  static func from(_ userInfo: [AnyHashable: Any]) -> [String: String]? {
    var out: [String: String] = [:]
    for key in keys {
      if let value = userInfo[key] as? String, valid(key, value) { out[key] = value }
    }
    guard let event = out["eventType"], !callEvents.contains(event) else { return nil }
    return out
  }
}

// MARK: - PushKit

extension AppDelegate: PKPushRegistryDelegate {
  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    // Before a session asks, the registry keeps the token; `startRegistering` reports it.
    guard type == .voIP, voipTokensWanted else { return }
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
