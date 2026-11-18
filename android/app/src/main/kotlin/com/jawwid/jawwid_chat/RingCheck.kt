package com.jawwid.jawwid_chat

/**
 * LR-79 and LR-27: the decisions behind the incoming-call ring, kept free of
 * Android so the JVM tests (src/test) can pin them down. JawwidPush does the
 * Android half (posting, reading the active notifications, the timer).
 *
 * ## LR-79: a ring Android silently dropped
 *
 * On Android 14 the system can drop a CallStyle notification without telling
 * the app: notify() returns normally, the app logs "posted", and system_server
 * logs "Cannot fix notification" with a SecurityException (seen on the CI
 * emulator, LR-78). The first ring of a call would be lost. So, a short while
 * after posting, JawwidPush looks for the ring among the app's active
 * notifications and, if it is missing, posts it again: at most [MAX_REPOSTS]
 * times, and never once the call was answered, declined or dismissed.
 */
object RingCheck {
    /** Re-posts after the first post; the task's bound ("at most 2 retries"). */
    const val MAX_REPOSTS = 2

    /**
     * How long after a post the ring is looked for. The system enqueues a
     * notification asynchronously, so an immediate look can miss a ring that is
     * about to appear; one second is short next to a 45-second ring.
     */
    const val CHECK_DELAY_MS = 1_000L

    enum class Next {
        /** The ring is on the screen: nothing to do. */
        ACTIVE,

        /** The call was answered, declined or dismissed meanwhile: never re-post. */
        SETTLED,

        /** The ring's own time is over: the server has already missed the call. */
        EXPIRED,

        /** Missing: post it again, then look again. */
        REPOST,

        /** Still missing after [MAX_REPOSTS] re-posts: stop and say so in the log. */
        GIVE_UP,
    }

    /**
     * What to do when the ring is looked for.
     *
     * @param active the ring is among the app's active notifications.
     * @param settled the call was answered, declined or dismissed since it was posted.
     * @param repostsDone how many times it was already posted again.
     * @param elapsedMs time since the first post.
     * @param ringTimeoutMs how long a ring may last at all.
     */
    fun next(active: Boolean, settled: Boolean, repostsDone: Int, elapsedMs: Long, ringTimeoutMs: Long): Next = when {
        settled -> Next.SETTLED
        active -> Next.ACTIVE
        elapsedMs >= ringTimeoutMs -> Next.EXPIRED
        repostsDone >= MAX_REPOSTS -> Next.GIVE_UP
        else -> Next.REPOST
    }

    /**
     * LR-27: whether the ring may take over the screen. Android before 14 (API 34)
     * grants a declared USE_FULL_SCREEN_INTENT outright; from 14 the user or Play
     * may revoke it, and only the system knows ([canUseFullScreenIntent] is asked
     * only there). Denied, the ring is still posted, as a heads-up notification.
     */
    fun fullScreenIntentAllowed(sdkInt: Int, canUseFullScreenIntent: () -> Boolean): Boolean =
        sdkInt < ANDROID_14 || canUseFullScreenIntent()

    /** Build.VERSION_CODES.UPSIDE_DOWN_CAKE, without Android on the test classpath. */
    const val ANDROID_14 = 34

    /**
     * LR-79: which calls are finished, so a ring check never re-posts one. Answer,
     * Decline and Dart's `dismiss` mark a call ([markSettled], from cancelCall);
     * sign-out marks every ring up to now ([clearAll]). A call is remembered for
     * [keepMs] (two rings' time). The clock is passed in so the JVM tests can drive it.
     */
    class SettledCalls(private val now: () -> Long, private val keepMs: Long) {
        private val calls = java.util.concurrent.ConcurrentHashMap<String, Long>()

        @Volatile
        private var allClearedAt = Long.MIN_VALUE

        fun markSettled(callId: String) {
            val t = now()
            calls.entries.removeIf { t - it.value > keepMs }
            calls[callId] = t
        }

        fun clearAll() {
            allClearedAt = now()
        }

        /** Finished since a ring that started at [ringStartedAt] (same clock) was posted. */
        fun isSettled(callId: String, ringStartedAt: Long): Boolean =
            calls.containsKey(callId) || allClearedAt >= ringStartedAt
    }
}
