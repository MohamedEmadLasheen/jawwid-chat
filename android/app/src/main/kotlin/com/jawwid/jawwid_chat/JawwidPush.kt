package com.jawwid.jawwid_chat

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray
import org.json.JSONObject

/**
 * Store blocker S-05: what Android shows for a push while the app is closed,
 * and the bridge that hands a call action back to Flutter.
 *
 * Every FCM message is DATA-ONLY (the server's fcm.provider.ts): this code
 * draws it. Two kinds:
 *
 *  - a call (`eventType` call_started / group_call_started, with a `callId`):
 *    a CallStyle incoming-call notification with Answer and Decline, on a
 *    high-importance channel, with a full-screen intent where Android allows
 *    it (Android 14+ grants USE_FULL_SCREEN_INTENT only to calling and alarm
 *    apps, and the user may revoke it -- checked, never assumed);
 *  - anything else: an ordinary notification with the server-rendered title
 *    and body, unless the app is in front (the chat is already live there).
 *
 * NOTHING HERE MOVES A CALL. Answer opens the app and reports `onIncoming` +
 * `onAnswer` on `jawwid/call_native`; CallController then sends the same
 * `POST /calls/:id/accept` the in-app button sends, and the server decides.
 * Decline reports `onDecline` the same way. That is the contract iOS's
 * CallKitBridge already speaks (lib/core/call_native/call_presentation.dart).
 */
object JawwidPush {
    const val CHANNEL_CALLS = "jawwid_calls"
    const val CHANNEL_MESSAGES = "jawwid_messages"

    const val ACTION_ANSWER = "com.jawwid.jawwid_chat.ANSWER_CALL"
    const val ACTION_DECLINE = "com.jawwid.jawwid_chat.DECLINE_CALL"
    const val ACTION_OPEN_CALL = "com.jawwid.jawwid_chat.OPEN_CALL"
    const val ACTION_HANG_UP = "com.jawwid.jawwid_chat.HANG_UP"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CONVERSATION_ID = "conversationId"

    /** Shared with call_presentation.dart. */
    const val CALL_CHANNEL_NAME = "jawwid/call_native"

    private const val TAG = "JawwidPush"

    private val CALL_EVENTS = setOf("call_started", "group_call_started")

    /**
     * How long the ring stays up if nothing answers or ends it: the server's
     * `call.ring_timeout_seconds` (45 s, its default) -- after that the call is
     * missed there, and a ring still on this screen would be a dead one. The
     * FCM TTL of a call push (fcm.provider.ts) is the same 45 s.
     */
    private const val RING_TIMEOUT_MS = 45_000L

    /** A decline older than the ring is moot: the call is over on the server. */
    private const val PENDING_DECLINE_MAX_AGE_MS = RING_TIMEOUT_MS
    private const val PREFS = "jawwid_push"
    private const val KEY_PENDING_DECLINES = "pending_declines"

    /** Set by MainActivity while it is resumed: a message notification is not drawn over the live chat. */
    @Volatile
    var inForeground = false

    /** The live Flutter side, once Dart said `ready` on the call channel. */
    @Volatile
    private var callChannel: MethodChannel? = null

    /** Call actions taken before Flutter was ready (a cold start from Answer). */
    private val pending = mutableListOf<Pair<String, Map<String, String?>>>()

    fun isCall(data: Map<String, String>): Boolean =
        data["eventType"] in CALL_EVENTS && !data["callId"].isNullOrEmpty()

    /** Draw one push. Called by JawwidMessagingService (and the debug receiver). */
    fun show(context: Context, data: Map<String, String>) {
        ensureChannels(context)
        if (isCall(data)) {
            showIncomingCall(context, data["callId"]!!, data["conversationId"], data["title"], data["body"])
        } else if (!inForeground) {
            showMessage(context, data)
        }
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_CALLS, context.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_calls_description)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = context.getString(R.string.channel_messages_description)
            },
        )
    }

    private fun showIncomingCall(context: Context, callId: String, conversationId: String?, title: String?, body: String?) {
        val caller = Person.Builder()
            .setName(title?.takeIf { it.isNotBlank() } ?: context.getString(R.string.call_incoming))
            .setImportant(true)
            .build()
        val answer = activityIntent(context, ACTION_ANSWER, callId, conversationId, requestCode(callId, 1))
        val open = activityIntent(context, ACTION_OPEN_CALL, callId, conversationId, requestCode(callId, 2))
        val decline = PendingIntent.getBroadcast(
            context,
            requestCode(callId, 3),
            Intent(context, CallActionReceiver::class.java)
                .setAction(ACTION_DECLINE)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_jawwid)
            .setContentTitle(caller.name)
            .setContentText(body?.takeIf { it.isNotBlank() } ?: context.getString(R.string.call_incoming))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .setContentIntent(open)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            // ALWAYS. A CallStyle notification must have a full-screen intent (or come
            // from a foreground service): without one, Android 12+ throws
            // IllegalArgumentException from notify() and nothing rings at all. Where
            // the app may not use full-screen intents (Android 14+, the user or Play
            // revoked it), the system itself downgrades the request to a heads-up
            // notification -- still with Answer and Decline.
            .setFullScreenIntent(open, true)
            // Lock screen (#408 review): the caller's name is not shown to whoever
            // holds the phone; the public version says only "Incoming call".
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context, CHANNEL_CALLS, R.string.call_incoming))

        notify(context, notificationId(callId), builder)
    }

    private fun showMessage(context: Context, data: Map<String, String>) {
        val title = data["title"]?.takeIf { it.isNotBlank() } ?: context.getString(R.string.app_name)
        val body = data["body"]?.takeIf { it.isNotBlank() } ?: context.getString(R.string.message_new)
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_jawwid)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(open)
            // Android shows a notification's full text on the lock screen by default,
            // unlike iOS: a message preview stays behind the unlock.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context, CHANNEL_MESSAGES, R.string.message_new))
        // One per conversation: a second message replaces the first rather than stacking.
        notify(context, (data["conversationId"] ?: data["notificationId"] ?: "jawwid").hashCode(), builder)
    }

    /** What the lock screen shows instead: the app's name and a generic line, nothing more. */
    private fun publicVersion(context: Context, channel: String, text: Int) =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_jawwid)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(text))
            .build()

    private fun notify(context: Context, id: Int, builder: NotificationCompat.Builder) {
        val manager = NotificationManagerCompat.from(context)
        // POST_NOTIFICATIONS refused (Android 13+): nothing can be shown, and nothing is thrown.
        if (!manager.areNotificationsEnabled()) return
        try {
            manager.notify(id, builder.build())
        } catch (e: SecurityException) {
            // The permission was revoked between the check and the post.
        } catch (e: IllegalArgumentException) {
            // A malformed notification must never take the messaging service down.
        }
    }

    fun cancelCall(context: Context, callId: String) {
        NotificationManagerCompat.from(context).cancel(notificationId(callId))
    }

    private fun activityIntent(context: Context, action: String, callId: String, conversationId: String?, code: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            code,
            Intent(context, MainActivity::class.java)
                .setAction(action)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun notificationId(callId: String) = ("call:$callId").hashCode()

    private fun requestCode(callId: String, slot: Int) = (callId.hashCode() * 31) + slot

    // ------------------------------------------------------------ to Flutter

    /** A call intent reached MainActivity (Answer, or a tap on the ring). */
    fun onCallIntent(context: Context, intent: Intent?) {
        val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: return
        val conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID)
        val args = mapOf("callId" to callId, "conversationId" to conversationId)
        // One line, no ids beyond the call's own (it authorizes nothing): what the
        // CI emulator test (android-ring) reads to prove Answer reached the bridge.
        android.util.Log.i(TAG, "call intent ${intent.action?.substringAfterLast('.')} handed to the call bridge")
        when (intent.action) {
            ACTION_ANSWER -> {
                cancelCall(context, callId)
                deliver("onIncoming", args)
                deliver("onAnswer", args)
            }
            ACTION_OPEN_CALL -> deliver("onIncoming", args)
        }
    }

    /**
     * Decline from the notification: off the screen now, to the server through
     * Flutter. With an engine running (the app in the background) it is sent at
     * once. With the app killed it is PERSISTED (#408 review: memory dies with
     * the receiver's process) and sent the moment Dart is ready -- unless the
     * ring is over by then, when the server has already recorded the call.
     */
    fun onDecline(context: Context, callId: String, conversationId: String?) {
        cancelCall(context, callId)
        val args = mapOf("callId" to callId, "conversationId" to conversationId)
        if (callChannel != null) {
            deliver("onIncoming", args)
            deliver("onDecline", args)
        } else {
            persistDecline(context, callId, conversationId)
        }
    }

    @Synchronized
    private fun persistDecline(context: Context, callId: String, conversationId: String?) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = JSONArray(prefs.getString(KEY_PENDING_DECLINES, "[]"))
        list.put(JSONObject().put("callId", callId).put("conversationId", conversationId ?: JSONObject.NULL).put("at", System.currentTimeMillis()))
        prefs.edit().putString(KEY_PENDING_DECLINES, list.toString()).apply()
    }

    /** The persisted declines still inside the ring, oldest first; the store is emptied. */
    @Synchronized
    private fun takePendingDeclines(context: Context): List<Map<String, String?>> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PENDING_DECLINES, null) ?: return emptyList()
        prefs.edit().remove(KEY_PENDING_DECLINES).apply()
        val now = System.currentTimeMillis()
        val out = mutableListOf<Map<String, String?>>()
        val list = JSONArray(raw)
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            if (now - o.optLong("at", 0) > PENDING_DECLINE_MAX_AGE_MS) continue
            out.add(mapOf("callId" to o.getString("callId"), "conversationId" to if (o.isNull("conversationId")) null else o.getString("conversationId")))
        }
        return out
    }

    /** S-06: Hang up on the ongoing-call notification: to the server through Flutter, like the in-app button. */
    fun onHangUp(callId: String) {
        deliver("onEnd", mapOf("callId" to callId, "conversationId" to null))
    }

    /** Dart said `ready`: flush what waited for it, persisted declines included. */
    @Synchronized
    fun attach(context: Context, channel: MethodChannel) {
        callChannel = channel
        val queued = pending.toList()
        pending.clear()
        for ((method, args) in queued) channel.invokeMethod(method, args)
        for (args in takePendingDeclines(context)) {
            channel.invokeMethod("onIncoming", args)
            channel.invokeMethod("onDecline", args)
        }
    }

    @Synchronized
    fun detach(channel: MethodChannel) {
        if (callChannel === channel) callChannel = null
    }

    @Synchronized
    private fun deliver(method: String, args: Map<String, String?>) {
        val channel = callChannel
        if (channel == null) pending.add(method to args) else channel.invokeMethod(method, args)
    }
}
