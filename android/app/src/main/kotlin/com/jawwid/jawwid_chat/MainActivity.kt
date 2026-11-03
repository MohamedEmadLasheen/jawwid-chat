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
 * Push-token plumbing for voice calls (W8-W1).
 *
 * THIS FILE REPORTS TOKENS, and today it reports none. It does not present a
 * call, answer one or decline one; a received push will be handled by the
 * native call layer W8-W3 builds, and the call itself still arrives over the
 * app's existing realtime connection.
 *
 * ## FCM, when the build has a Firebase project (PD-32 amendment, 2026-11-03)
 *
 * The Firebase SDK is linked; the Google Services plugin is applied only when
 * `android/app/google-services.json` exists (it is not committed -- it is the
 * Firebase project's), so a developer's build without it still builds. Without
 * it FirebaseApp never initializes, `start` reports no token, and the Dart side
 * treats that as "push is unavailable on this build", which it is. With it,
 * `start` reports this phone's token and [JawwidMessagingService] the rotations.
 *
 * ## Ordinary pushes: drawn, and opened where they point
 *
 * [JawwidMessagingService] draws an ordinary push ([PushPresenter]); a tap starts
 * this activity with the allowlisted ids and this install's nonce. A cold start
 * reads it in [onCreate], a running app in [onNewIntent] (`singleTop`); either
 * way it waits in [PushBridge] until Dart listens on `jawwid/push_opens`, then
 * Dart routes it. Calls are untouched: never drawn, never routed here.
 *
 * ## Why a FlutterFragmentActivity
 *
 * PD-23's app lock uses `local_auth`, whose BiometricPrompt is a Fragment and needs a
 * FragmentActivity host. FlutterFragmentActivity offers the same `configureFlutterEngine`
 * hook FlutterActivity did, so the push-token channel below is unchanged.
 */
class MainActivity : FlutterFragmentActivity() {
    private var channel: MethodChannel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A closed app opened by a notification tap. Not on a restore after the process
        // was killed: that intent was already handled when it first arrived.
        if (savedInstanceState == null) handleTap(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // The app was in the background or open (`singleTop`).
        handleTap(intent)
    }

    override fun onResume() {
        super.onResume()
        PushBridge.inForeground = true
    }

    override fun onPause() {
        PushBridge.inForeground = false
        super.onPause()
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        PushBridge.detach()
        super.cleanUpFlutterEngine(flutterEngine)
    }

    /** A tap on one of OUR notifications only: its nonce must match this install's. */
    private fun handleTap(intent: Intent?) {
        if (intent?.action != PushBridge.ACTION_OPEN) return
        // Reopened from Recents: the system replays the task's original intent -- the tap
        // that launched it, long since opened. Not a new tap.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val extras = intent.extras ?: return
        val raw = PushPayload.OPEN_KEYS.mapNotNull { k -> extras.getString(k)?.let { k to it } }.toMap()
        val open = PushPayload.fromTap(raw, extras.getString(PushBridge.EXTRA_NONCE), PushBridge.nonce(this)) ?: return
        // Consumed: a configuration change re-delivering this intent must not open it twice.
        intent.action = Intent.ACTION_MAIN
        PushBridge.open(open)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CHANNEL_NAME,
        )
        this.channel = channel
        PushBridge.tokenChannelReady(channel)

        val opens = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, OPENS_CHANNEL)
        PushBridge.openChannel = opens
        opens.setMethodCallHandler { call, result ->
            when (call.method) {
                "listen" -> {
                    PushBridge.listen()
                    result.success(null)
                }
                // Sign-out: the previous account's notifications leave the tray.
                "clearDelivered" -> {
                    androidx.core.app.NotificationManagerCompat.from(this).cancelAll()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    // Dart is listening for tokens now: one the service got first is handed over.
                    PushBridge.tokenListening = true
                    PushBridge.flushToken()
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
     * Ask for permission to notify (Android 13+), then for this phone's push token.
     *
     * Called by Dart when a session starts (`PushRegistrar.start`) -- the point where
     * notifications start to matter, never at launch. No token without a Firebase
     * project (see the class comment). It never throws: an Android build without push
     * works, it simply will not notify while closed.
     */
    private fun startRegistering() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFY_REQUEST)
        }
        if (FirebaseApp.getApps(this).isEmpty()) return
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrEmpty()) PushBridge.reportToken(token)
            }
        } catch (e: IllegalStateException) {
            // Firebase present but not usable: push unavailable, as without it.
        }
    }

    companion object {
        /** Shared with `push_tokens.dart`. One string, three places. */
        private const val CHANNEL_NAME = "jawwid/push_tokens"

        /** Shared with `device_security_settings.dart`. */
        private const val SECURITY_SETTINGS_CHANNEL = "jawwid/device_security_settings"

        /** Shared with `push_opens.dart`. */
        private const val OPENS_CHANNEL = "jawwid/push_opens"

        private const val NOTIFY_REQUEST = 7301
    }
}
