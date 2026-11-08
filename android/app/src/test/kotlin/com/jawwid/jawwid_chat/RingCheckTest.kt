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

    // ---- LR-79: which calls are finished (the part most likely to ring for an ended call)

    private var clock = 10_000L
    private fun settled() = RingCheck.SettledCalls({ clock }, keepMs = 2 * timeout)

    @Test
    fun aCallAnsweredDeclinedOrDismissedIsNeverRepostedAgain() {
        val s = settled()
        val ringStarted = clock
        assertFalse(s.isSettled("c1", ringStarted))
        clock += 500
        s.markSettled("c1")
        assertTrue(s.isSettled("c1", ringStarted))
        assertFalse("another call is not affected", s.isSettled("c2", ringStarted))
    }

    @Test
    fun signOutSettlesEveryRingPostedBeforeIt_butNotALaterOne() {
        val s = settled()
        val earlier = clock
        clock += 1_000
        s.clearAll()
        assertTrue(s.isSettled("any", earlier))
        clock += 1
        assertFalse("a ring that starts after the sign-out is live", s.isSettled("any", clock))
    }

    @Test
    fun aFinishedCallIsForgottenAfterTwoRingsTime_onTheNextMark() {
        val s = settled()
        s.markSettled("old")
        clock += 2 * timeout + 1
        s.markSettled("new")
        assertFalse(s.isSettled("old", 0L))
        assertTrue(s.isSettled("new", 0L))
    }
}
