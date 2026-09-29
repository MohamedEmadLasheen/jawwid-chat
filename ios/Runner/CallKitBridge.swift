import AVFoundation
import CallKit
import Flutter
import Foundation
import PushKit

/**
 * The system call screen, and NOTHING ELSE (W8-W3).
 *
 * ## What this owns
 *
 * One fact: which `CXCall` UUID corresponds to which Jawwid `callId`. It needs
 * that because it has to know what to take off the screen, and for no other
 * reason.
 *
 * ## What this does NOT own
 *
 * The call. It holds no ringing/active/ended state, computes no outcome and no
 * duration, decides nothing about who may call whom, and never talks to the
 * API. Every tap is forwarded to Dart, which sends the same HTTP request the
 * in-app buttons send, and the server re-runs the full authorization chain.
 * There is one lifecycle and the server is its only authority.
 *
 * It does not even decide whether CallKit's single end action means "decline"
 * or "hang up": Dart knows the phase, the phase came from the server, and
 * remembering the difference here would be the first step towards a second
 * lifecycle.
 *
 * ## The ordering iOS imposes
 *
 * A PushKit delivery MUST report a call to CallKit before its completion
 * handler runs, or the system terminates the app -- and repeat offences stop
 * VoIP delivery altogether. So the report happens FIRST, synchronously with the
 * push, long before Dart exists on a cold wake. Everything else waits for the
 * engine; this cannot.
 *
 * ## Why there is a queue
 *
 * On a terminated launch the push always precedes Dart. Without `pending`, the
 * call would be on the screen with nothing behind it: nobody to answer it and
 * nobody to take it down. Dart says `ready` when it is listening, and the queue
 * drains then.
 */
final class CallKitBridge: NSObject {
  /// Shared with `call_presentation.dart`. One string, two places.
  static let channelName = "jawwid/call_native"

  private let provider: CXProvider
  private var channel: FlutterMethodChannel?

  /// The only state here, and it is presentation correlation, not lifecycle.
  private var uuidByCall: [String: UUID] = [:]
  private var callByUuid: [UUID: String] = [:]

  /// Messages that arrived before Dart was listening. See the class comment.
  private var pending: [(method: String, arguments: [String: String])] = []
  private var dartIsReady = false

  override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallsPerCallGroup = 1
    configuration.maximumCallGroups = 1
    // A Jawwid call is between people the server has already authorized. There
    // is no dialable address anywhere in this product, so the handle is opaque
    // and carries no contact channel -- see the phone-privacy control (G-07).
    configuration.supportedHandleTypes = [.generic]
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  // MARK: - Flutter

  /// Attach to the engine's messenger. Called once, when the engine is created.
  func attach(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: CallKitBridge.channelName,
      binaryMessenger: messenger
    )
    self.channel = channel

    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else {
        result(nil)
        return
      }
      switch call.method {
      case "ready":
        self.dartIsReady = true
        self.drain()
        result(nil)
      case "dismiss":
        guard
          let arguments = call.arguments as? [String: Any],
          let callId = arguments["callId"] as? String
        else {
          result(nil)
          return
        }
        let reason = arguments["reason"] as? String ?? ""
        self.dismiss(callId: callId, reason: reason)
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private func send(_ method: String, _ arguments: [String: String]) {
    guard dartIsReady, let channel else {
      pending.append((method, arguments))
      return
    }
    channel.invokeMethod(method, arguments: arguments)
  }

  private func drain() {
    let queued = pending
    pending.removeAll()
    for message in queued {
      channel?.invokeMethod(message.method, arguments: message.arguments)
    }
  }

  // MARK: - Incoming

  /**
   * Report an incoming call, then run `completion`.
   *
   * `completion` is PushKit's, and iOS requires it to run only after the call
   * has been reported. A payload we cannot identify is still reported and then
   * immediately ended: the alternative is either a terminated app or a call on
   * the screen that nothing can ever resolve.
   */
  func reportIncoming(
    callId: String?,
    conversationId: String?,
    completion: @escaping () -> Void
  ) {
    guard let callId, !callId.isEmpty else {
      reportAndEndUnidentified(completion: completion)
      return
    }

    // A duplicate push for a call already on screen reports nothing further.
    if uuidByCall[callId] != nil {
      completion()
      return
    }

    let uuid = UUID()
    uuidByCall[callId] = uuid
    callByUuid[uuid] = callId

    let update = CXCallUpdate()
    update.hasVideo = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsHolding = false
    update.supportsDTMF = false
    // NO CALLER NAME. The push payload carries none: adding one is B-3 and is a
    // separate authorization. `localizedCallerName` is left unset rather than
    // filled with a guess, because a guess appears on a lock screen.
    update.remoteHandle = CXHandle(type: .generic, value: callId)

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      guard let self else {
        completion()
        return
      }
      if error != nil {
        // iOS refused to present it -- Do Not Disturb, a system call in
        // progress, or a malformed report. Forget it rather than leaving a
        // mapping for a screen that does not exist.
        self.forget(callId: callId)
      } else {
        var arguments = ["callId": callId]
        if let conversationId, !conversationId.isEmpty {
          arguments["conversationId"] = conversationId
        }
        self.send("onIncoming", arguments)
      }
      completion()
    }
  }

  /**
   * A push we cannot act on, handled the only way iOS permits.
   *
   * Every VoIP delivery must report a call or the app is terminated, so this
   * reports one and ends it immediately. It is visible for an instant, which is
   * worse than nothing happening and far better than either a termination or a
   * permanent screen nobody can dismiss.
   */
  private func reportAndEndUnidentified(completion: @escaping () -> Void) {
    let uuid = UUID()
    let update = CXCallUpdate()
    update.hasVideo = false
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] _ in
      self?.provider.reportCall(with: uuid, endedAt: nil, reason: .failed)
      completion()
    }
  }

  // MARK: - Dismissal

  /// Take one call off the screen, on Dart's instruction and nobody else's.
  private func dismiss(callId: String, reason: String) {
    guard let uuid = uuidByCall[callId] else { return }
    provider.reportCall(with: uuid, endedAt: nil, reason: endReason(for: reason))
    forget(callId: callId)
  }

  /// Maps Dart's `CallDismissReason` onto CallKit's vocabulary.
  ///
  /// `answeredElsewhere` is the one that matters: another of this account's
  /// devices picked up, the call is very much alive, and CallKit has a reason
  /// that says exactly that. Reporting `remoteEnded` there would write a missed
  /// call into the system's own call history for a call that was answered.
  private func endReason(for reason: String) -> CXCallEndedReason {
    switch reason {
    case "answeredElsewhere": return .answeredElsewhere
    case "declined": return .remoteEnded
    case "failed": return .failed
    default: return .remoteEnded
    }
  }

  private func forget(callId: String) {
    if let uuid = uuidByCall.removeValue(forKey: callId) {
      callByUuid.removeValue(forKey: uuid)
    }
  }
}

// MARK: - CXProviderDelegate

extension CallKitBridge: CXProviderDelegate {
  /// The system reset -- every call it knew about is gone.
  func providerDidReset(_ provider: CXProvider) {
    // Tell Dart nothing. The server still holds whatever these calls were
    // doing, and inventing a terminal event here would be this layer deciding
    // a lifecycle question it has no standing to answer.
    uuidByCall.removeAll()
    callByUuid.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callByUuid[action.callUUID] else {
      action.fail()
      return
    }
    send("onAnswer", ["callId": callId])
    // Fulfilled immediately: CallKit is being told the UI acted, not that the
    // server accepted. The server's answer arrives over the realtime
    // connection, and if it refuses, Dart dismisses this call.
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = callByUuid[action.callUUID] else {
      action.fail()
      return
    }
    // ONE ACTION FOR BOTH decline and hang-up. Dart decides which, from the
    // phase the server gave it -- see `call_controller.dart`.
    send("onEnd", ["callId": callId])
    forget(callId: callId)
    action.fulfill()
  }

  /**
   * CallKit has activated the audio session.
   *
   * W8-W3 does not publish audio and does not touch `AVAudioSession`: the media
   * client is W4's and stays closed. This exists so the ordering is observable
   * during W8-W4 measurement, which is where the question of whether LiveKit
   * must wait for this is actually settled (D-5).
   */
  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}
