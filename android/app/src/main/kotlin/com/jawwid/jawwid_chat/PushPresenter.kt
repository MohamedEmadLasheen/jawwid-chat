package com.jawwid.jawwid_chat

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Draws an ordinary push (PD-32 amendment, 2026-11-03). FCM messages are data-only (see
 * `fcm.provider.ts`), so Android shows nothing unless the app draws it; this is that.
 *
 * The text is the server's rendered, generic text -- the same an iOS lock screen shows.
 * The tap opens MainActivity with the allowlisted ids and this install's nonce, and Dart
 * routes it. Never used for a call ([PushPayload.shouldDisplay] refuses one).
 */
object PushPresenter {
    const val CHANNEL_ID = "jawwid_general"

    fun show(context: Context, data: Map<String, String>) {
        if (!PushPayload.shouldDisplay(data, PushBridge.inForeground)) return
        val manager = NotificationManagerCompat.from(context)
        // Android 13+: no permission, nothing to draw. Never an error.
        if (!manager.areNotificationsEnabled()) return
        ensureChannel(context)

        val tag = PushPayload.notificationTag(data)
        val intent = Intent(context, MainActivity::class.java).apply {
            action = PushBridge.ACTION_OPEN
            // Unique per delivery: PendingIntents that differ only in extras are the SAME
            // PendingIntent, and one notification would open another's item.
            setData(Uri.parse("jawwid-push://open/" + Uri.encode(tag)))
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            PushPayload.openExtras(data).forEach { (k, v) -> putExtra(k, v) }
            putExtra(PushBridge.EXTRA_NONCE, PushBridge.nonce(context))
        }
        val tap = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(PushPayload.title(data))
            .setContentText(PushPayload.body(data))
            .setStyle(NotificationCompat.BigTextStyle().bigText(PushPayload.body(data)))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        try {
            manager.notify(tag, 0, notification)
        } catch (e: SecurityException) {
            // The permission was withdrawn between the check and the post.
        }
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.push_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
    }
}
