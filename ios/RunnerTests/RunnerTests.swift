import Flutter
import UIKit
import XCTest

@testable import Runner

/// PD-32 amendment: what an ordinary iOS push may carry into the app, and when it shows.
class RunnerTests: XCTestCase {
  private let reply: [AnyHashable: Any] = [
    "aps": ["alert": ["title": "Jawwid", "body": "The administration has replied to your feedback."]],
    "eventType": "feedback_replied",
    "notificationId": "n-1",
    "actionKind": "open_feedback",
    "feedbackId": "fb-1",
  ]

  func testATapCarriesOnlyTheAllowlistedIdShapedKeys() {
    var forged = reply
    forged["conversationId"] = "../../settings"
    forged["secret"] = "words"
    XCTAssertEqual(
      PushOpenPayload.from(forged),
      ["eventType": "feedback_replied", "notificationId": "n-1", "actionKind": "open_feedback", "feedbackId": "fb-1"]
    )
  }

  func testACallIsNeverRoutedNorShownHere() {
    let call: [AnyHashable: Any] = ["eventType": "call_started", "callId": "k-1", "conversationId": "c-1"]
    XCTAssertNil(PushOpenPayload.from(call))
    XCTAssertFalse(PushOpenPayload.showWhileOpen(call))
  }

  func testAnOrdinaryPushShowsWhileOpenButChatStaysQuiet() {
    XCTAssertTrue(PushOpenPayload.showWhileOpen(reply))
    XCTAssertFalse(PushOpenPayload.showWhileOpen(["eventType": "message_published"]))
  }

  func testAPushThatIsNotOursIsLeftToWhoeverHandledItBefore() {
    XCTAssertFalse(PushOpenPayload.isOurs(["aps": ["alert": "hi"]]))
    XCTAssertFalse(PushOpenPayload.isOurs(["eventType": "Not Ours!"]))
    XCTAssertTrue(PushOpenPayload.isOurs(reply))
    XCTAssertNil(PushOpenPayload.from(["feedbackId": "fb-1"]))
  }
}
