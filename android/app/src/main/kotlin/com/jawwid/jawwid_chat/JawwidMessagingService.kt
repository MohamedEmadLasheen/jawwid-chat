package com.jawwid.jawwid_chat

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM's entry point (PD-32 amendment, 2026-11-03). Runs only in a build with a Firebase
 * project (`google-services.json`); without one FCM never starts and this never runs.
 *
 * A data-only message arrives here in every app state -- closed, background, open.
 * Ordinary pushes are drawn ([PushPresenter]); a CALL is left exactly as before this file
 * existed: not drawn and not routed (calls arrive over the realtime connection).
 */
class JawwidMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        android.os.Handler(mainLooper).post { PushBridge.reportToken(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (PushPayload.isCall(data)) return
        PushPresenter.show(applicationContext, data)
    }
}
