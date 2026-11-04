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
 *
 * Also "Hang up" on the ongoing-call notification (S-06): `onEnd`, the same
 * path as the in-app button; the service comes down when the call is over.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(JawwidPush.EXTRA_CALL_ID) ?: return
        when (intent.action) {
            JawwidPush.ACTION_DECLINE -> JawwidPush.onDecline(context, callId, intent.getStringExtra(JawwidPush.EXTRA_CONVERSATION_ID))
            // S-06: Hang up on the ongoing-call notification (CallForegroundService).
            JawwidPush.ACTION_HANG_UP -> JawwidPush.onHangUp(callId)
        }
    }
}
