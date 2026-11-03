package com.jawwid.jawwid_chat

import android.content.Context
import io.flutter.plugin.common.MethodChannel
import java.util.UUID

/**
 * The process-wide meeting point between pushes (the messaging service, which runs with or
 * without an activity) and Dart (the activity's channels). PD-32 amendment, 2026-11-03.
 *
 * Holds what arrived before Dart was listening -- a token the service got first, the tap
 * that launched a closed app -- and hands it over once Dart says it is ready. Main thread
 * only, like the channels themselves.
 */
object PushBridge {
    var tokenChannel: MethodChannel? = null
    var openChannel: MethodChannel? = null

    /** Dart called `start` on `jawwid/push_tokens`. */
    var tokenListening = false

    /** Dart called `listen` on `jawwid/push_opens`. */
    private var listening = false
    private val pendingOpens = mutableListOf<Map<String, String>>()
    private var pendingToken: String? = null

    /** Set by the activity: drawn notifications for chat stay quiet while the app is open. */
    @Volatile
    var inForeground = false

    fun reportToken(token: String) {
        val channel = tokenChannel
        if (channel == null || !tokenListening) {
            pendingToken = token
            return
        }
        channel.invokeMethod("onToken", mapOf("token" to token, "platform" to "android", "kind" to "standard"))
    }

    /**
     * The activity's channel exists -- but Dart may not have set its handler yet, so a held
     * token waits for [flushToken], called when Dart asks to `start`.
     */
    fun tokenChannelReady(channel: MethodChannel) {
        tokenChannel = channel
    }

    fun flushToken() {
        pendingToken?.let { pendingToken = null; reportToken(it) }
    }

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

    /** A new engine (the activity was recreated): Dart must say it is listening again. */
    fun detach() {
        listening = false
        tokenListening = false
        openChannel = null
        tokenChannel = null
    }

    /**
     * This install's secret for its own notification taps, in app-private storage. The
     * activity is exported (it is the launcher), so another app could start it with extras;
     * it cannot read this.
     */
    fun nonce(context: Context): String {
        val prefs = context.getSharedPreferences("jawwid_push", Context.MODE_PRIVATE)
        prefs.getString("open_nonce", null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString("open_nonce", fresh).apply()
        return fresh
    }

    const val EXTRA_NONCE = "jawwid.push.nonce"
    const val ACTION_OPEN = "com.jawwid.jawwid_chat.PUSH_OPEN"
}
