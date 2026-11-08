package com.jawwid.jawwid_chat

import com.jawwid.jawwid_chat.RingCheck.Next
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** LR-79 (re-post a ring Android dropped) and LR-27 (full-screen intent on Android 14+). */
class RingCheckTest {
    private val timeout = 45_000L

    private fun next(active: Boolean = false, settled: Boolean = false, reposts: Int = 0, elapsed: Long = 1_000L) =
        RingCheck.next(active, settled, reposts, elapsed, timeout)

    @Test
    fun aRingOnTheScreenIsLeftAlone() {
        assertEquals(Next.ACTIVE, next(active = true))
        assertEquals(Next.ACTIVE, next(active = true, reposts = 1))
        assertEquals(Next.ACTIVE, next(active = true, reposts = RingCheck.MAX_REPOSTS))
    }

    @Test
    fun aMissingRingIsPostedAgain() {
        assertEquals(Next.REPOST, next(reposts = 0))
        assertEquals(Next.REPOST, next(reposts = 1))
    }

    @Test
    fun atMostTwoRepostsThenItGivesUp() {
        assertEquals(2, RingCheck.MAX_REPOSTS)
        assertEquals(Next.GIVE_UP, next(reposts = 2))
        assertEquals(Next.GIVE_UP, next(reposts = 3))
    }

    @Test
    fun anAnsweredDeclinedOrDismissedCallIsNeverPostedAgain() {
        // Settled wins over everything else, a missing ring included.
        assertEquals(Next.SETTLED, next(settled = true))
        assertEquals(Next.SETTLED, next(settled = true, reposts = 1))
        assertEquals(Next.SETTLED, next(settled = true, active = true))
        assertEquals(Next.SETTLED, next(settled = true, elapsed = timeout + 1))
    }

    @Test
    fun aRingPastItsTimeIsNotPostedAgain() {
        assertEquals(Next.EXPIRED, next(elapsed = timeout))
        assertEquals(Next.EXPIRED, next(elapsed = timeout + 5_000L))
        assertEquals(Next.REPOST, next(elapsed = timeout - 1))
    }

    @Test
    fun theWholeRetryFitsWellInsideTheRing() {
        // First post, two re-posts, a look after each: far less than the 45 s ring.
        assertTrue(RingCheck.CHECK_DELAY_MS * (RingCheck.MAX_REPOSTS + 1) < timeout / 4)
    }

    @Test
    fun beforeAndroid14TheFullScreenIntentIsAlwaysAllowedAndTheSystemIsNotAsked() {
        var asked = false
        assertTrue(RingCheck.fullScreenIntentAllowed(33) { asked = true; false })
        assertFalse(asked)
    }

    @Test
    fun fromAndroid14TheSystemDecides() {
        assertTrue(RingCheck.fullScreenIntentAllowed(34) { true })
        assertFalse(RingCheck.fullScreenIntentAllowed(34) { false })
        assertFalse(RingCheck.fullScreenIntentAllowed(36) { false })
    }
}
