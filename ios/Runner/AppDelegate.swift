import Flutter
import PushKit
import UIKit

/**
 * Push-token plumbing for voice calls (W8-W1).
 *
 * THIS FILE REPORTS TOKENS. It does not present a call, answer one, decline one
 * or know what a call is. A received push is handled by the native call layer
 * W8-W3 will build; the call itself still arrives over the app's existing
 * realtime connection, and the server remains the only authority on a call's
 * lifecycle.
 *
 * TWO TOKENS, TWO CHANNELS. iOS issues a standard APNs token for ordinary
 * notifications and a separate PushKit token for VoIP. The server keeps them
 * apart deliberately — a PushKit delivery obliges the app to report an incoming
 * call to CallKit almost immediately, so a VoIP token may only ever carry a
 * call. Both are reported here with their kind; the server decides what each
 * receives.
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 * - No `PKPushRegistryDelegate.didReceiveIncomingPushWith` handling. Receiving a
 *   VoIP push obliges an immediate CallKit report, and CallKit is W8-W3's. The
 *   server will not deliver a VoIP push until `APNS_VOIP_ENABLED=true`, which
 *   must not be set before that exists.
 * - No CallKit, no audio session, no call UI.
 */
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var channel: FlutterMethodChannel?
  private var voipRegistry: PKPushRegistry?

  /// Tokens that arrived before Flutter was listening. The platform hands them
  /// over when it is ready, which is not when Dart asks.
  private var pending: [[String: String]] = []

  /// Shared with `push_tokens.dart`. One string, three places.
  private static let channelName = "jawwid/push_tokens"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    let channel = FlutterMethodChannel(
      name: AppDelegate.channelName,
      binaryMessenger: engineBridge.binaryMessenger
    )
    self.channel = channel

    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "start" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.startRegistering()
      result(nil)
    }

    // Anything that arrived before Dart attached.
    for token in pending { channel.invokeMethod("onToken", arguments: token) }
    pending.removeAll()
  }

  /// Ask iOS for both tokens. Safe to call repeatedly.
  private func startRegistering() {
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

    if let channel = channel {
      channel.invokeMethod("onToken", arguments: payload)
    } else {
      pending.append(payload)
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
}
