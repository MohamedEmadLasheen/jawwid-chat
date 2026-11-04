package com.jawwid.jawwid_chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PD-32 amendment: what an ordinary Android push may carry, and when it is drawn. */
class PushPayloadTest {
    private val reply = mapOf(
        "eventType" to "feedback_replied",
        "notificationId" to "n-1",
        "actionKind" to "open_feedback",
        "feedbackId" to "fb-1",
        "title" to "Jawwid",
        "body" to "The administration has replied to your feedback.",
    )
    private val call = mapOf("eventType" to "call_started", "notificationId" to "n-2", "conversationId" to "c-1", "callId" to "k-1")

    @Test
    fun anOrdinaryPushIsDrawnInEveryState() {
        assertTrue(PushPayload.shouldDisplay(reply, appInForeground = false))
        assertTrue(PushPayload.shouldDisplay(reply, appInForeground = true))
        assertEquals("Jawwid", PushPayload.title(reply))
        assertEquals("The administration has replied to your feedback.", PushPayload.body(reply))
    }

    @Test
    fun aCallIsNeverDrawnNorRouted() {
        assertTrue(PushPayload.isCall(call))
        assertFalse(PushPayload.shouldDisplay(call, appInForeground = false))
        assertFalse(PushPayload.shouldDisplay(call, appInForeground = true))
        assertFalse(PushPayload.shouldDisplay(mapOf("eventType" to "group_call_started"), appInForeground = false))
        assertNull(PushPayload.fromTap(call, "s3cret", "s3cret"))
    }

    @Test
    fun chatIsQuietOnlyWhileTheAppIsOpen() {
        val message = mapOf("eventType" to "message_published", "conversationId" to "c-1")
        assertTrue(PushPayload.shouldDisplay(message, appInForeground = false))
        assertFalse(PushPayload.shouldDisplay(message, appInForeground = true))
    }

    @Test
    fun aPushThatIsNotOursIsNotDrawn() {
        assertFalse(PushPayload.shouldDisplay(emptyMap(), appInForeground = false))
        assertFalse(PushPayload.shouldDisplay(mapOf("eventType" to "Not An Event!"), appInForeground = false))
    }

    @Test
    fun aTapCarriesOnlyTheAllowlistedIdShapedKeys() {
        val open = PushPayload.openExtras(reply + mapOf("callId" to "k", "secret" to "words", "conversationId" to "../../x"))
        assertEquals(
            mapOf("eventType" to "feedback_replied", "notificationId" to "n-1", "actionKind" to "open_feedback", "feedbackId" to "fb-1"),
            open,
        )
    }

    @Test
    fun aTapIsTrustedOnlyWithThisInstallsNonce() {
        assertEquals("fb-1", PushPayload.fromTap(reply, "s3cret", "s3cret")?.get("feedbackId"))
        // Another app starting the exported activity with forged extras.
        assertNull(PushPayload.fromTap(reply, null, "s3cret"))
        assertNull(PushPayload.fromTap(reply, "guess", "s3cret"))
        assertNull(PushPayload.fromTap(reply, "", ""))
        assertNull(PushPayload.fromTap(reply, "s3cret", null))
        assertNull(PushPayload.fromTap(mapOf("feedbackId" to "fb-1"), "s3cret", "s3cret"))
    }

    @Test
    fun oneNotificationPerDeliveryAndOnePerChat() {
        assertEquals("n:n-1", PushPayload.tag(reply))
        // Chat: one per conversation, so a newer message replaces the older one.
        assertEquals("chat:c-1", PushPayload.tag(mapOf("eventType" to "message_published", "conversationId" to "c-1", "notificationId" to "n-9")))
        // Without a usable delivery id, two pushes never share a tag (and so a tap intent).
        val a = PushPayload.tag(mapOf("eventType" to "feedback_replied"))
        val b = PushPayload.tag(mapOf("eventType" to "feedback_replied"))
        assertTrue(a != b)
        assertTrue(!PushPayload.tag(mapOf("notificationId" to "../x")).contains(".."))
    }

    @Test
    fun theCallRingsAnswerAndOpenNeedTheSameNonce() {
        assertTrue(PushPayload.isTrustedTap("s3cret", "s3cret"))
        assertFalse(PushPayload.isTrustedTap(null, "s3cret"))
        assertFalse(PushPayload.isTrustedTap("guess", "s3cret"))
        assertFalse(PushPayload.isTrustedTap("", ""))
        assertFalse(PushPayload.isTrustedTap("s3cret", null))
    }
}
