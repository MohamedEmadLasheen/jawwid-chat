package com.jawwid.jawwid_chat

import android.content.Context

/**
 * The last FCM token this device was given, so a rotation that arrives while
 * no Flutter engine is running is registered on the next start. Not a secret:
 * it is a device address the server already holds, and it lives in the app's
 * private preferences.
 */
object PushTokenStore {
    private const val PREFS = "jawwid_push"
    private const val KEY = "fcm_token"

    fun save(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, token).apply()
    }

    fun load(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
}
