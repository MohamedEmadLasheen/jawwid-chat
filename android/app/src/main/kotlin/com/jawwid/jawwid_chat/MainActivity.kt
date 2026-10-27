package com.jawwid.jawwid_chat

import android.content.ActivityNotFoundException
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
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
 *
 * ## Why a FlutterFragmentActivity
 *
 * PD-23's app lock uses `local_auth`, whose BiometricPrompt is a Fragment and needs a
 * FragmentActivity host. FlutterFragmentActivity offers the same `configureFlutterEngine`
 * hook FlutterActivity did, so the push-token channel below is unchanged.
 */
class MainActivity : FlutterFragmentActivity() {
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

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            SECURITY_SETTINGS_CHANNEL,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "openSecuritySettings" -> result.success(openSecuritySettings())
                else -> result.notImplemented()
            }
        }
    }

    /**
     * App lock's "Open settings": the screen where the owner adds what app lock needs.
     *
     * Android 11+ has a biometric enrolment screen that also offers a screen lock (PIN,
     * pattern, password), asked here for exactly the strengths app lock accepts:
     * BIOMETRIC_STRONG or DEVICE_CREDENTIAL. A weak ("convenience") face unlock is not
     * one of them, and Android does not let an app use it. Not every phone ships that
     * screen, so Security settings, then Settings, are the fallbacks.
     *
     * Returns whether anything opened. It never throws into Flutter.
     */
    private fun openSecuritySettings(): Boolean {
        val candidates = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            candidates.add(
                Intent(Settings.ACTION_BIOMETRIC_ENROLL).putExtra(
                    Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                    BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL,
                ),
            )
        }
        candidates.add(Intent(Settings.ACTION_SECURITY_SETTINGS))
        candidates.add(Intent(Settings.ACTION_SETTINGS))

        for (intent in candidates) {
            try {
                startActivity(intent)
                return true
            } catch (e: ActivityNotFoundException) {
                // This phone has no such screen; try the next one.
            } catch (e: SecurityException) {
                // Some vendors guard a screen; try the next one.
            }
        }
        return false
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

        /** Shared with `device_security_settings.dart`. */
        private const val SECURITY_SETTINGS_CHANNEL = "jawwid/device_security_settings"
    }
}
