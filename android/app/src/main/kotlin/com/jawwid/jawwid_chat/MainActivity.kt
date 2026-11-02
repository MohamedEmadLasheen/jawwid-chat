package com.jawwid.jawwid_chat

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Push tokens (W8-W1) and Android's half of the native call contract (store
 * blocker S-05).
 *
 * ## The FCM token
 *
 * `start` (from push_tokens.dart, after sign-in) asks Firebase Messaging for
 * this device's token and reports it on `jawwid/push_tokens` as
 * `android`/`standard`. Firebase is configured by `android/app/google-services.json`
 * from the owner's Firebase project. A DEBUG build without that file runs with
 * push off (`start` reports nothing, as before); a RELEASE build without it
 * fails at build time (android/app/build.gradle.kts). A token rotated while no
 * engine is running is kept (PushTokenStore) and reported on the next start.
 *
 * `start` is also where Android 13+'s POST_NOTIFICATIONS is asked for: after
 * sign-in, when a notification first matters, never at launch.
 *
 * ## The call channel
 *
 * `jawwid/call_native` speaks the contract iOS's CallKitBridge speaks
 * (lib/core/call_native/call_presentation.dart): Dart says `ready` and
 * `dismiss`; native reports `onIncoming`, `onAnswer`, `onDecline`. Answer and a
 * tap on the ring open this activity with a call intent (JawwidPush), on a cold
 * start or a warm one, and are handed to Flutter once it is ready.
 *
 * ## Why a FlutterFragmentActivity
 *
 * PD-23's app lock uses `local_auth`, whose BiometricPrompt is a Fragment and needs a
 * FragmentActivity host. FlutterFragmentActivity offers the same `configureFlutterEngine`
 * hook FlutterActivity did, so the channels below are unchanged.
 */
class MainActivity : FlutterFragmentActivity() {
    private var channel: MethodChannel? = null
    private var callChannel: MethodChannel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A cold start from Answer or a tap on the ring: queued until Dart is ready.
        JawwidPush.onCallIntent(applicationContext, intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        JawwidPush.onCallIntent(applicationContext, intent)
    }

    override fun onResume() {
        super.onResume()
        JawwidPush.inForeground = true
    }

    override fun onPause() {
        JawwidPush.inForeground = false
        super.onPause()
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        callChannel?.let { JawwidPush.detach(it) }
        callChannel = null
        if (attached === this) attached = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        attached = this

        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CHANNEL_NAME,
        )
        this.channel = channel

        val callChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, JawwidPush.CALL_CHANNEL_NAME)
        this.callChannel = callChannel
        callChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "ready" -> {
                    JawwidPush.attach(callChannel)
                    result.success(null)
                }
                "dismiss" -> {
                    call.argument<String>("callId")?.let { JawwidPush.cancelCall(applicationContext, it) }
                    result.success(null)
                }
                // S-06: the call keeps its microphone in the background (CallForegroundService).
                "ongoingStart" -> {
                    val callId = call.argument<String>("callId")
                    if (callId != null) CallForegroundService.start(applicationContext, callId, call.argument<String>("title").orEmpty())
                    result.success(null)
                }
                "ongoingStop" -> {
                    CallForegroundService.stop(applicationContext)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

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
     * Ask Firebase for this device's push token, and for permission to show
     * notifications (Android 13+).
     *
     * It never throws: a debug build without google-services.json has no
     * Firebase app, and then reports nothing -- push is simply off on that build.
     */
    private fun startRegistering() {
        JawwidPush.ensureChannels(applicationContext)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        if (FirebaseApp.getApps(applicationContext).isEmpty()) return
        PushTokenStore.load(applicationContext)?.let { reportToken(it) }
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrEmpty()) {
                    PushTokenStore.save(applicationContext, token)
                    reportToken(token)
                }
            }
        } catch (e: IllegalStateException) {
            // Firebase present but not initialised for messaging: push stays off.
        }
    }

    /**
     * Hand a token to Flutter. `kind` is always "standard": FCM has no VoIP
     * channel, which is why the server routes Android calls to ordinary tokens.
     */
    fun reportToken(token: String) {
        channel?.invokeMethod(
            "onToken",
            mapOf("token" to token, "platform" to "android", "kind" to "standard"),
        )
    }

    companion object {
        /** Shared with `push_tokens.dart`. One string, three places. */
        private const val CHANNEL_NAME = "jawwid/push_tokens"

        private const val NOTIFICATION_PERMISSION_REQUEST = 4601

        /** The activity whose engine is live, for a token rotated by JawwidMessagingService. */
        @Volatile
        private var attached: MainActivity? = null

        fun reportTokenIfAttached(token: String) {
            val activity = attached ?: return
            activity.runOnUiThread { activity.reportToken(token) }
        }

        /** Shared with `device_security_settings.dart`. */
        private const val SECURITY_SETTINGS_CHANNEL = "jawwid/device_security_settings"
    }
}
