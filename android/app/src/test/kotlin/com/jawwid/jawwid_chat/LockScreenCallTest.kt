package com.jawwid.jawwid_chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The app shows over the lock screen only while a call from the lock screen rings or is in progress. */
class LockScreenCallTest {
    private val window = 90_000L
    private var now = 1_000_000L
    private val tracker = LockScreenCall.Tracker({ now }, window)

    @Test
    fun theDecision() {
        assertTrue(LockScreenCall.shouldShowWhenLocked(connected = false, msSinceRing = 0, ringWindowMs = window))
        assertTrue(LockScreenCall.shouldShowWhenLocked(connected = false, msSinceRing = window - 1, ringWindowMs = window))
        assertFalse(LockScreenCall.shouldShowWhenLocked(connected = false, msSinceRing = window, ringWindowMs = window))
        assertFalse(LockScreenCall.shouldShowWhenLocked(connected = false, msSinceRing = -1, ringWindowMs = window))
        assertTrue(LockScreenCall.shouldShowWhenLocked(connected = true, msSinceRing = 10 * window, ringWindowMs = window))
    }

    @Test
    fun noCallNeverShowsOverTheLockScreen() {
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun aRingFromTheLockScreenShowsTheApp() {
        tracker.ringing("c1")
        assertTrue(tracker.showWhenLocked())
    }

    @Test
    fun answeredFromTheLockScreenThenEndedResets() {
        tracker.ringing("c1")
        tracker.connected("c1")
        now += 30 * 60_000L // a long call stays over the lock screen
        assertTrue(tracker.showWhenLocked())
        tracker.ended("c1") // ongoingStop / dismiss
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun aDeclinedOrMissedRingResets() {
        tracker.ringing("c1")
        tracker.ended("c1")
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun aRingWhoseEndNeverArrivedStopsAtTheWindow() {
        tracker.ringing("c1")
        now += window - 1
        assertTrue(tracker.showWhenLocked())
        now += 1
        assertFalse(tracker.showWhenLocked())
        // and connecting later cannot bring it back
        tracker.connected("c1")
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun aCallStartedOnAnUnlockedPhoneNeverShowsOverTheLockScreen() {
        tracker.connected("outgoing")
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun anotherCallEndingDoesNotResetTheLiveOne() {
        tracker.ringing("c1")
        tracker.connected("c1")
        tracker.ended("c2")
        assertTrue(tracker.showWhenLocked())
    }

    @Test
    fun aRepeatedIntentKeepsAConnectedCallConnected() {
        tracker.ringing("c1")
        tracker.connected("c1")
        tracker.ringing("c1")
        now += 2 * window
        assertTrue(tracker.showWhenLocked())
    }

    // LR-46 P3-4: the re-check timer at the ring window's end.

    @Test
    fun noRingNeedsNoTimer() {
        assertNull(tracker.msUntilRingWindowEnds())
    }

    @Test
    fun aRingIsReCheckedWhenItsWindowEnds() {
        tracker.ringing("c1")
        assertEquals(window, tracker.msUntilRingWindowEnds())
        now += 30_000L
        assertEquals(window - 30_000L, tracker.msUntilRingWindowEnds())
        // The timer fires at the end: the window is over, and the app leaves the lock screen.
        now += window - 30_000L
        assertEquals(0L, tracker.msUntilRingWindowEnds())
        assertFalse(tracker.showWhenLocked())
        assertNull(tracker.msUntilRingWindowEnds())
    }

    @Test
    fun aConnectedCallNeedsNoTimer() {
        tracker.ringing("c1")
        tracker.connected("c1")
        assertNull(tracker.msUntilRingWindowEnds())
    }

    @Test
    fun theEarliestRingSetsTheTimer() {
        tracker.ringing("c1")
        now += 10_000L
        tracker.ringing("c2")
        assertEquals(window - 10_000L, tracker.msUntilRingWindowEnds())
        tracker.ended("c1")
        assertEquals(window, tracker.msUntilRingWindowEnds())
    }

    @Test
    fun aWindowAlreadyOverIsReCheckedAtOnce() {
        tracker.ringing("c1")
        now += 2 * window
        assertEquals(0L, tracker.msUntilRingWindowEnds())
    }

    @Test
    fun clearDropsEveryCall() {
        tracker.ringing("c1")
        tracker.connected("c1")
        tracker.ringing("c2")
        tracker.clear()
        assertFalse(tracker.showWhenLocked())
    }

    // LR-46 review of #561, P1: "shown over the lock screen" is a locked phone AND a call
    // holding the lock screen. A locked phone alone (no call, or the unlock still finishing)
    // is not: the app is not over the lock screen then, and Dart must not cover it.

    @Test
    fun aLockedPhoneWithNoCallIsNotShownOverTheLockScreen() {
        assertFalse(tracker.overLockScreen(keyguardLocked = true))
        assertFalse(tracker.overLockScreen(keyguardLocked = false))
    }

    @Test
    fun aRingOnALockedPhoneIsShownOverTheLockScreen() {
        tracker.ringing("c1")
        assertTrue(tracker.overLockScreen(keyguardLocked = true))
        // Unlocked, the app is simply in front: nothing to guard.
        assertFalse(tracker.overLockScreen(keyguardLocked = false))
    }

    @Test
    fun aRingWhoseWindowIsOverNoLongerHoldsTheLockScreen() {
        tracker.ringing("c1")
        now += window
        assertFalse(tracker.overLockScreen(keyguardLocked = true))
    }

    // P2-2: once the person unlocks from the call, no call keeps the app over the lock
    // screen, so locking again shows the lock screen, not the app.

    @Test
    fun anUnlockEndsTheLockScreenPermissionForEveryCall() {
        tracker.ringing("c1")
        tracker.connected("c1")
        tracker.ringing("c2")
        tracker.unlocked()
        assertFalse(tracker.showWhenLocked())
        assertFalse(tracker.overLockScreen(keyguardLocked = true))
        assertNull(tracker.msUntilRingWindowEnds())
    }

    @Test
    fun aCallConnectedAfterTheUnlockDoesNotTakeTheLockScreenBack() {
        tracker.ringing("c1")
        tracker.unlocked()
        tracker.connected("c1")
        assertFalse(tracker.showWhenLocked())
    }

    @Test
    fun aNewRingFromTheLockScreenAfterAnUnlockHoldsItAgain() {
        tracker.ringing("c1")
        tracker.unlocked()
        tracker.ringing("c2")
        assertTrue(tracker.overLockScreen(keyguardLocked = true))
    }
}
