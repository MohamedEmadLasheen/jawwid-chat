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

        /**
         * LR-46 (review of #561, P2-2): the person unlocked from the call screen. Nothing needs
         * the lock screen any more, so no call keeps the app over it: locking the phone again
         * mid-call shows the lock screen, not the app (whose last frame may be the chats). A
         * call connected afterwards is not re-admitted ([connected] only keeps a known call);
         * only a new trusted call intent ([ringing]) grants it again.
         */
        fun unlocked() {
            calls.clear()
        }

        fun showWhenLocked(): Boolean {
            val now = clock()
            calls.entries.removeAll { (_, e) -> !shouldShowWhenLocked(e.connected, now - e.since, ringWindowMs) }
            return calls.isNotEmpty()
        }

        /**
         * LR-46 (review of #561, P1): is the app shown over the lock screen? Only when the phone
         * is locked AND a call holds the lock screen. A locked phone alone is not enough: with
         * no such call the app is not over the lock screen (it is behind it, or the unlock is
         * still finishing), and Dart's call-only cover must not appear. This is what the call
         * channel's `isShownOverLockScreen` answers.
         */
        fun overLockScreen(keyguardLocked: Boolean): Boolean = keyguardLocked && showWhenLocked()

        /**
         * LR-46 P3-4: how long until [showWhenLocked] can change on its own, which is when the
         * first unanswered ring's window ends. Null when nothing will: no ring, or only
         * connected calls (those end with Dart's `ongoingStop`/`dismiss`). MainActivity re-checks
         * at that moment, so a ring whose end never reached it (no lifecycle event, no channel
         * call) cannot keep the app over the lock screen past its window. Never negative: a
         * window already over answers 0, re-check now.
         */
        fun msUntilRingWindowEnds(): Long? {
            val now = clock()
            return calls.values
                .filter { !it.connected }
                .minOfOrNull { (ringWindowMs - (now - it.since)).coerceAtLeast(0L) }
        }
    }
}
