package com.jawwid.jawwid_chat

import org.junit.Assert.assertFalse
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

    @Test
    fun clearDropsEveryCall() {
        tracker.ringing("c1")
        tracker.connected("c1")
        tracker.ringing("c2")
        tracker.clear()
        assertFalse(tracker.showWhenLocked())
    }
}
