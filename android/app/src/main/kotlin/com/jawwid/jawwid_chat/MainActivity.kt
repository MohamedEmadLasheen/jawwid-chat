package com.jawwid.jawwid_chat

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Push-token plumbing for voice calls (W8-W1).
 *
 * THIS FILE REPORTS TOKENS, and today it reports none. It does not present a
 * call, answer one or decline one; a received push will be handled by the
 * native call layer W8-W3 builds, and the call itself still arrives over the
 * app's existing realtime connection.
 *
 * ## Why there is no FCM token here yet
 *
 * Obtaining one requires the Firebase SDK on the Gradle classpath AND an
 * `android/app/google-services.json` issued by a Firebase project. Neither
 * exists in this repository, and adding the Gradle plugin without the
 * configuration file breaks every Android build — including a developer's.
 *
 * That is **provider configuration**, not implementation, and W8-W1 was
 * explicitly scoped to keep the two apart. The channel, the contract and the
 * Dart side above it are complete and tested; the last step is an infrastructure
 * one:
 *
 *   1. add `google-services.json` from the Firebase project,
 *   2. add the `com.google.gms.google-services` plugin and
 *      `firebase-messaging` to `android/app/build.gradle.kts`,
 *   3. call `FirebaseMessaging.getInstance().token` here and pass the result to
 *      [reportToken], and add a `FirebaseMessagingService` for rotations.
 *
 * Until then `start` is honest: it reports nothing rather than pretending a
 * token exists. The Dart side treats "no token" as "push is unavailable on this
 * build", which is exactly what it is.
 */
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CHANNEL_NAME,
        )
        this.channel = channel

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    startRegistering()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    /**
     * Ask the platform for a push token.
     *
     * A no-op until Firebase is configured — see the class comment. It
     * deliberately does not throw: an Android build without push works, it
     * simply will not notify while closed.
     */
    private fun startRegistering() {
        // Intentionally empty. See the class comment for the three steps that
        // complete this, and why they are configuration rather than code.
    }

    /**
     * Hand a token to Flutter. `kind` is always "standard": FCM has no VoIP
     * channel, which is why the server routes Android calls to ordinary tokens.
     */
    @Suppress("unused")
    fun reportToken(token: String) {
        channel?.invokeMethod(
            "onToken",
            mapOf("token" to token, "platform" to "android", "kind" to "standard"),
        )
    }

    companion object {
        /** Shared with `push_tokens.dart`. One string, three places. */
        private const val CHANNEL_NAME = "jawwid/push_tokens"
    }
}
