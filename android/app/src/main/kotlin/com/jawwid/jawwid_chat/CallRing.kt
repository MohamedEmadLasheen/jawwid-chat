package com.jawwid.jawwid_chat

/**
 * The incoming-call ring's rules, kept free of Android types so plain JUnit tests them
 * (src/test/.../CallRingTest.kt). JawwidPush applies them.
 */
object CallRing {
    /** Android 14 (UPSIDE_DOWN_CAKE): full-screen intents need a grant the user or Play can revoke. */
    const val FULL_SCREEN_INTENT_CHECKED_FROM_SDK = 34

    enum class Mode { FULL_SCREEN, HEADS_UP }

    /**
     * LR-27: how the ring will show. Below Android 14 the full-screen intent is always
     * allowed. From Android 14 on, a denied grant means the system shows the ring as a
     * sticky heads-up notification, still with Answer and Decline. The ring still REQUESTS
     * the full-screen intent in both cases: a CallStyle notification that does not come from a
     * foreground service must request one, or notify() throws and nothing rings.
     */
    fun mode(sdkInt: Int, fullScreenIntentGranted: Boolean): Mode =
        if (sdkInt < FULL_SCREEN_INTENT_CHECKED_FROM_SDK || fullScreenIntentGranted) Mode.FULL_SCREEN else Mode.HEADS_UP
}

/**
 * LR-79: Android 14 can silently drop a CallStyle notification that notify() accepted.
 * After a ring is posted, JawwidPush checks once that it is in the active notifications.
 * If it is missing and the call is still ringing, the ring is re-posted EXACTLY ONCE.
 * A ring that was ended (answered, declined, dismissed, cleared at sign-out) or has timed
 * out is never re-posted.
 */
class RingWatch(private val ringTimeoutMs: Long) {
    enum class Verdict {
        /** Posted and showing: nothing to do. */
        SHOWING,

        /** Missing on the first check while still ringing: post it again, then check once more. */
        REPOST,

        /** Showing after the one re-post. */
        REPOSTED_SHOWING,

        /** Still missing after the one re-post: give up (logged). */
        LOST,

        /** Not ringing any more (ended, timed out, or never watched): do nothing. */
        ENDED,
    }

    private class Ring(val postedAtMs: Long, var reposted: Boolean = false)

    private val rings = mutableMapOf<String, Ring>()

    /** The ring for [callId] was just posted. A new delivery of the same call starts afresh. */
    @Synchronized
    fun posted(callId: String, nowMs: Long) {
        rings[callId] = Ring(nowMs)
    }

    /** The ring for [callId] was taken down on purpose: never re-post it. */
    @Synchronized
    fun ended(callId: String) {
        rings.remove(callId)
    }

    /** Sign-out: every ring is taken down. */
    @Synchronized
    fun clear() {
        rings.clear()
    }

    /** What to do about [callId], given whether its notification is [showing] now. */
    @Synchronized
    fun check(callId: String, showing: Boolean, nowMs: Long): Verdict {
        val ring = rings[callId] ?: return Verdict.ENDED
        if (nowMs - ring.postedAtMs >= ringTimeoutMs) {
            rings.remove(callId)
            return Verdict.ENDED
        }
        if (showing) {
            rings.remove(callId)
            return if (ring.reposted) Verdict.REPOSTED_SHOWING else Verdict.SHOWING
        }
        if (ring.reposted) {
            rings.remove(callId)
            return Verdict.LOST
        }
        ring.reposted = true
        return Verdict.REPOST
    }
}
