package com.jawwid.jawwid_chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Store blocker S-05: "Decline" on the incoming-call notification. The ring
 * comes off the screen at once; the refusal itself reaches the server through
 * Flutter (`onDecline` on jawwid/call_native), as on iOS. If the app is not
 * running it is queued for the next start; by then an unanswered call has
 * usually ended on its own and the server's own timeout records it.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != JawwidPush.ACTION_DECLINE) return
        val callId = intent.getStringExtra(JawwidPush.EXTRA_CALL_ID) ?: return
        JawwidPush.onDecline(context, callId, intent.getStringExtra(JawwidPush.EXTRA_CONVERSATION_ID))
    }
}
