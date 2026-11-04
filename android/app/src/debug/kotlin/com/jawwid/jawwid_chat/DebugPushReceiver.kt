package com.jawwid.jawwid_chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * DEBUG BUILDS ONLY (src/debug): draws a push exactly as JawwidMessagingService
 * would, without Firebase, so the closed-app ring and message notifications
 * can be tested on an emulator before google-services.json exists. Never in a
 * release build: this source set is not compiled into one.
 *
 *   adb shell am force-stop com.jawwid.jawwid_chat
 *   adb shell am broadcast -n com.jawwid.jawwid_chat/.DebugPushReceiver \
 *     --es eventType call_started --es callId <call-uuid> --es conversationId <uuid> \
 *     --es title "Lina's teacher" --es body "Incoming voice call"
 */
class DebugPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val extras = intent.extras ?: return
        val data = extras.keySet().associateWith { extras.getString(it).orEmpty() }
        JawwidPush.show(context.applicationContext, data)
    }
}
