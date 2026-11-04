package com.jawwid.jawwid_chat

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Store blocker S-05: FCM's entry point while the app is closed or in the
 * background. Every message is data-only (fcm.provider.ts), so this is what
 * draws it -- see JawwidPush.
 */
class JawwidMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        JawwidPush.show(applicationContext, message.data)
    }

    /**
     * A rotated token. Kept until Flutter can register it: the process may be
     * running without an engine, and a token the server never hears of is a
     * phone that silently stops ringing.
     */
    override fun onNewToken(token: String) {
        PushTokenStore.save(applicationContext, token)
        MainActivity.reportTokenIfAttached(token)
    }
}
