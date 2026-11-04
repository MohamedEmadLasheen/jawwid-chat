package com.jawwid.jawwid_chat

/**
 * What an ordinary push may carry into the app, and when it is drawn (PD-32 amendment,
 * 2026-11-03). Pure Kotlin -- no Android types -- so it is unit-tested on the JVM.
 *
 * A push is data from outside the app. Only the known keys travel from the push to the
 * notification's tap intent and on to Dart, and only values shaped like ids: an id is a
 * pointer, never a permission -- every screen it opens re-reads the item through the
 * signed-in account's own authorized route.
 *
 * Calls are not touched. A call event is never drawn or routed here; it keeps its own
 * path (the realtime connection), exactly as before this file existed.
 */
object PushPayload {
    /** Matches the server's CALL_EVENT_TYPES (call-push-routing.ts). */
    val CALL_EVENTS = setOf("call_started", "group_call_started")

    /**
     * Chat traffic the open app already shows in its own UI: not drawn while the app is in
     * the foreground (it still is in the background, and iOS does the same).
     */
    val QUIET_WHILE_OPEN = setOf("message_published", "mention_created")

    /** The keys a tap may carry: the event, the delivery, and the ids its screen needs. */
    val OPEN_KEYS = listOf(
        "eventType", "notificationId", "actionKind",
        "feedbackId", "conversationId", "learnerId", "lessonId", "taskId",
    )

    private val ID = Regex("^[0-9A-Za-z-]{1,64}$")
    private val KIND = Regex("^[a-z][a-z0-9_]{0,39}$")

    fun isCall(data: Map<String, String>): Boolean = data["eventType"] in CALL_EVENTS

    /** Whether to draw this push now. Never a call; never without an event type of ours. */
    fun shouldDisplay(data: Map<String, String>, appInForeground: Boolean): Boolean {
        val event = data["eventType"] ?: return false
        if (!KIND.matches(event) || event in CALL_EVENTS) return false
        if (appInForeground && event in QUIET_WHILE_OPEN) return false
        return true
    }

    /** The allowlisted, id-shaped subset of [data] a tap carries. */
    fun openExtras(data: Map<String, String>): Map<String, String> =
        OPEN_KEYS.mapNotNull { key ->
            val v = data[key] ?: return@mapNotNull null
            val ok = if (key == "eventType" || key == "actionKind") KIND.matches(v) else ID.matches(v)
            if (ok) key to v else null
        }.toMap()

    /** The banner's text: the server's rendered (generic) text, or the app's name. */
    fun title(data: Map<String, String>): String = data["title"]?.takeIf { it.isNotBlank() }?.take(200) ?: "Jawwid"

    fun body(data: Map<String, String>): String = data["body"]?.take(1000) ?: ""

    /**
     * The notification's tag: one per conversation for chat (a newer message replaces the
     * older), one per delivery otherwise (a retried push replaces itself).
     */
    fun tag(data: Map<String, String>): String {
        val event = data["eventType"]
        val conversation = data["conversationId"]?.takeIf { ID.matches(it) }
        if (event in QUIET_WHILE_OPEN && conversation != null) return "chat:$conversation"
        return data["notificationId"]?.takeIf { ID.matches(it) }?.let { "n:$it" } ?: "n:${java.util.UUID.randomUUID()}"
    }

    /**
     * What a tap intent hands Dart: its extras, but ONLY when it carries this install's
     * secret [expectedNonce] -- the activity is exported (it is the launcher), so any app
     * could start it with extras; only our own notifications know the nonce, which lives
     * in this app's private storage. Null otherwise.
     */
    fun fromTap(extras: Map<String, String>, nonce: String?, expectedNonce: String?): Map<String, String>? {
        if (!isTrustedTap(nonce, expectedNonce)) return null
        val open = openExtras(extras)
        if (open["eventType"] == null || isCall(open)) return null
        return open
    }

    /**
     * Whether an intent came from a notification this app drew: it carries this install's
     * nonce. Used for notification taps ([fromTap]) and for the call ring's Answer and Open
     * (MainActivity.handleCallIntent), because the activity they start is exported.
     */
    fun isTrustedTap(nonce: String?, expectedNonce: String?): Boolean {
        if (nonce.isNullOrEmpty() || expectedNonce.isNullOrEmpty()) return false
        // Constant-time: a secret is never compared character by character.
        return java.security.MessageDigest.isEqual(nonce.toByteArray(), expectedNonce.toByteArray())
    }
}
