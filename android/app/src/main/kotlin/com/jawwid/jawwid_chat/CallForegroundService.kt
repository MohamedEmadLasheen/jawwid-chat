package com.jawwid.jawwid_chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Store blocker S-06: an ongoing call survives the app going to the background.
 *
 * Without a foreground service Android stops a backgrounded app's microphone
 * (and, under memory pressure, the app): the other side hears silence the
 * moment the user switches to another app or locks the phone. Started by
 * CallController when this device's media joins a call (`ongoingStart` on
 * jawwid/call_native), stopped on every terminal path (`ongoingStop`).
 *
 * TYPES: `microphone` always; `phoneCall` too when its runtime prerequisite
 * (MANAGE_OWN_CALLS, a normal permission granted at install) is held. A start
 * the platform refuses (Android 12+ forbids starting one from the background)
 * is caught, never a crash: the call goes on in front.
 *
 * The notification is the ongoing-call one Android requires for this service:
 * who the call is with, and Hang up, which comes back to CallController as
 * `onEnd` -- the same path as the in-app button. Nothing here ends a call.
 */
class CallForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    /** Swiped away from recents mid-call: the engine and the media went with it; so does this. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val callId = intent?.getStringExtra(JawwidPush.EXTRA_CALL_ID)
        if (intent?.action == ACTION_STOP || callId == null) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(callId, title), serviceTypes())
        } catch (e: RuntimeException) {
            // ForegroundServiceStartNotAllowedException / SecurityException: the call
            // continues while the app is in front; there is nothing to keep alive.
            stopSelf()
        }
        // Not restarted by the system after a kill: a call is not something to resume blindly.
        return START_NOT_STICKY
    }

    private fun serviceTypes(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.MANAGE_OWN_CALLS) == PackageManager.PERMISSION_GRANTED) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
        }
        return types
    }

    private fun notification(callId: String, title: String): android.app.Notification {
        ensureChannel(this)
        val with = Person.Builder()
            .setName(title.ifBlank { getString(R.string.call_ongoing) })
            .build()
        val open = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val hangUp = PendingIntent.getBroadcast(
            this,
            2,
            Intent(this, CallActionReceiver::class.java)
                .setAction(JawwidPush.ACTION_HANG_UP)
                .putExtra(JawwidPush.EXTRA_CALL_ID, callId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_jawwid)
            .setContentTitle(with.name)
            .setContentText(getString(R.string.call_ongoing))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(open)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(with, hangUp))
            .build()
    }

    companion object {
        const val ACTION_STOP = "com.jawwid.jawwid_chat.STOP_ONGOING_CALL"
        const val EXTRA_TITLE = "title"
        private const val CHANNEL_ONGOING = "jawwid_ongoing_call"
        private const val NOTIFICATION_ID = 4602

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(
                // LOW: present and silent -- the call is already audible.
                NotificationChannel(CHANNEL_ONGOING, context.getString(R.string.channel_ongoing_call), NotificationManager.IMPORTANCE_LOW),
            )
        }

        /** From MainActivity's `ongoingStart`: the app is in front, so Android allows the start. */
        fun start(context: Context, callId: String, title: String) {
            val intent = Intent(context, CallForegroundService::class.java)
                .putExtra(JawwidPush.EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_TITLE, title)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: RuntimeException) {
                // Refused by the platform (background start): the call goes on in front.
            }
        }

        /** stopService, not a stop intent: allowed from the background, where a call often ends. */
        fun stop(context: Context) {
            context.stopService(Intent(context, CallForegroundService::class.java))
        }
    }
}
