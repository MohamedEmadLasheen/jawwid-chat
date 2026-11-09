package com.jawwid.jawwid_chat

import org.junit.Assert.assertEquals
import org.junit.Test

/** LR-27 (full-screen intent denied on Android 14+) and LR-79 (a dropped CallStyle ring re-posted once). */
class CallRingTest {
    // ------------------------------------------------------------ LR-27

    @Test
    fun belowAndroid14TheRingIsAlwaysFullScreen() {
        assertEquals(CallRing.Mode.FULL_SCREEN, CallRing.mode(sdkInt = 33, fullScreenIntentGranted = false))
        assertEquals(CallRing.Mode.FULL_SCREEN, CallRing.mode(sdkInt = 26, fullScreenIntentGranted = false))
    }

    @Test
    fun onAndroid14AndLaterTheGrantDecides() {
        assertEquals(CallRing.Mode.FULL_SCREEN, CallRing.mode(sdkInt = 34, fullScreenIntentGranted = true))
        assertEquals(CallRing.Mode.HEADS_UP, CallRing.mode(sdkInt = 34, fullScreenIntentGranted = false))
        assertEquals(CallRing.Mode.HEADS_UP, CallRing.mode(sdkInt = 35, fullScreenIntentGranted = false))
    }

    // ------------------------------------------------------------ LR-79

    private val watch = RingWatch(ringTimeoutMs = 45_000L)

    @Test
    fun aRingThatIsShowingIsLeftAlone() {
        watch.posted("k-1", nowMs = 0)
        assertEquals(RingWatch.Verdict.SHOWING, watch.check("k-1", showing = true, nowMs = 2_000))
        // Verified once: nothing more is watched.
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 4_000))
    }

    @Test
    fun aDroppedRingIsRepostedExactlyOnce() {
        watch.posted("k-1", nowMs = 0)
        assertEquals(RingWatch.Verdict.REPOST, watch.check("k-1", showing = false, nowMs = 2_000))
        assertEquals(RingWatch.Verdict.LOST, watch.check("k-1", showing = false, nowMs = 4_000))
        // Never a third post.
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 6_000))
    }

    @Test
    fun aRepostThatShowsIsReportedAsSuch() {
        watch.posted("k-1", nowMs = 0)
        assertEquals(RingWatch.Verdict.REPOST, watch.check("k-1", showing = false, nowMs = 2_000))
        assertEquals(RingWatch.Verdict.REPOSTED_SHOWING, watch.check("k-1", showing = true, nowMs = 4_000))
    }

    @Test
    fun aRingEndedBeforeTheCheckIsNeverReposted() {
        // Answered, declined, dismissed by Dart, or the caller hung up.
        watch.posted("k-1", nowMs = 0)
        watch.ended("k-1")
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 2_000))
    }

    @Test
    fun aRingEndedAfterTheRepostIsNotCheckedAgain() {
        watch.posted("k-1", nowMs = 0)
        assertEquals(RingWatch.Verdict.REPOST, watch.check("k-1", showing = false, nowMs = 2_000))
        watch.ended("k-1")
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 4_000))
    }

    @Test
    fun signOutEndsEveryRing() {
        watch.posted("k-1", nowMs = 0)
        watch.posted("k-2", nowMs = 0)
        watch.clear()
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 2_000))
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-2", showing = false, nowMs = 2_000))
    }

    @Test
    fun aRingPastItsTimeoutIsNeverReposted() {
        watch.posted("k-1", nowMs = 0)
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 45_000))
    }

    @Test
    fun anUnknownCallIsNeverReposted() {
        assertEquals(RingWatch.Verdict.ENDED, watch.check("never-posted", showing = false, nowMs = 0))
    }

    @Test
    fun ringsAreWatchedIndependently() {
        watch.posted("k-1", nowMs = 0)
        watch.posted("k-2", nowMs = 0)
        watch.ended("k-1")
        assertEquals(RingWatch.Verdict.ENDED, watch.check("k-1", showing = false, nowMs = 2_000))
        assertEquals(RingWatch.Verdict.REPOST, watch.check("k-2", showing = false, nowMs = 2_000))
    }
}
