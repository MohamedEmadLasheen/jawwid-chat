package com.jawwid.jawwid_chat

/**
 * When MainActivity may show over the lock screen (and turn the screen on).
 *
 * A ring opened from the lock screen (Answer, or a tap on the ring) shows the app over
 * the lock screen so the call can be taken without unlocking. That must last only as
 * long as the call: once it ends, whoever holds the phone must meet the lock screen
 * again, not the app (the optional app lock is off by default).
 *
 * So the permission belongs to a call, not to the activity:
 *  - only a trusted call intent grants it ([Tracker.ringing]);
 *  - it holds while that call rings (at most [ringWindowMs] after the intent) or is in
 *    progress (Dart's `ongoingStart`, [Tracker.connected]);
 *  - it ends with the call (Dart's `ongoingStop` or `dismiss`, [Tracker.ended]) or when
 *    the engine that ran the call goes away ([Tracker.clear]).
 *
 * A call started or answered on an unlocked phone never grants it: `ongoingStart` only
 * keeps a call that came from the lock screen. Pure, so the JVM tests cover it.
 */
object LockScreenCall {
    /**
     * The one decision. A connected call holds as long as it lasts; an unanswered ring
     * only inside its window (a ring whose end never reached us must not hold forever).
     */
    fun shouldShowWhenLocked(connected: Boolean, msSinceRing: Long, ringWindowMs: Long): Boolean =
        connected || (msSinceRing in 0 until ringWindowMs)

    class Tracker(private val clock: () -> Long, private val ringWindowMs: Long) {
        private class Entry(val since: Long, var connected: Boolean)

        private val calls = HashMap<String, Entry>()

        /** A trusted call intent for [callId] reached the activity. A repeat keeps a connected call connected. */
        fun ringing(callId: String) {
            val existing = calls[callId]
            calls[callId] = Entry(clock(), existing?.connected ?: false)
        }

        /** The call is in progress. Only a call that came from the lock screen is kept. */
        fun connected(callId: String) {
            calls[callId]?.connected = true
        }

        /** The call is over for this device (hung up, declined, ended, answered elsewhere, failed). */
        fun ended(callId: String) {
            calls.remove(callId)
        }

        /** Nothing can end the calls any more (the engine is gone): drop them all. */
        fun clear() {
            calls.clear()
        }

        fun showWhenLocked(): Boolean {
            val now = clock()
            calls.entries.removeAll { (_, e) -> !shouldShowWhenLocked(e.connected, now - e.since, ringWindowMs) }
            return calls.isNotEmpty()
        }
    }
}
