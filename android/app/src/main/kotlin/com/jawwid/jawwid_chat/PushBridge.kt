package com.jawwid.jawwid_chat

import android.content.Context
import io.flutter.plugin.common.MethodChannel
import java.util.UUID

/**
 * Taps on ordinary notifications, on their way to Dart (`jawwid/push_opens`).
 *
 * A tap can arrive before Dart listens: the tap that launched the app does. It is held
 * here until `listen`, then handed over in order. Tokens are not here: they are
 * [PushTokenStore] and MainActivity's (`jawwid/push_tokens`, store blocker S-05).
 */
object PushBridge {
    const val EXTRA_NONCE = "jawwid.push.nonce"
    const val ACTION_OPEN = "com.jawwid.jawwid_chat.PUSH_OPEN"

    var openChannel: MethodChannel? = null
    private var listening = false
    private val pendingOpens = mutableListOf<Map<String, String>>()

    fun open(payload: Map<String, String>) {
        val channel = openChannel
        if (channel == null || !listening) {
            pendingOpens.add(payload)
            return
        }
        channel.invokeMethod("onOpen", payload)
    }

    fun listen() {
        listening = true
        val waiting = pendingOpens.toList()
        pendingOpens.clear()
        waiting.forEach(::open)
    }

    fun detach() {
        listening = false
        openChannel = null
    }

    /**
     * This install's secret for tap intents. The launcher activity is exported, so any app
     * can start it with made-up extras; only a PendingIntent this app built carries this.
     */
    fun nonce(context: Context): String {
        val prefs = context.getSharedPreferences("jawwid_push", Context.MODE_PRIVATE)
        prefs.getString("open_nonce", null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString("open_nonce", fresh).apply()
        return fresh
    }
}
