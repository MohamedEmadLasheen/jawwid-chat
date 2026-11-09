package com.jawwid.jawwid_chat

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
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
        // NOT on a recreate (rotation, process restore) or a launch from recents: the
        // intent is the one already handled, and replaying it would answer again.
        val fromHistory = (intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
        if (savedInstanceState == null && !fromHistory) {
            handleCallIntent(intent)
            handlePushTap(intent)
        }
        // Rotation does not recreate this activity (manifest configChanges). A real
        // recreate detaches the engine, whose cleanup clears the tracker, so this
        // starts from nothing and fails closed: the lock screen comes back.
        applyLockScreenPolicy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallIntent(intent)
        handlePushTap(intent)
    }

    /**
     * PD-32: a tap on an ordinary notification (JawwidPush.showMessage).
     *
     * The launcher activity is exported, so any app can start it with any extras. A tap
     * counts only when it carries this install's nonce, which no other app can know, and
     * only the allow-listed, id-shaped keys pass ([PushPayload.fromTap]). Calls never come
     * this way: they have their own intents (handleCallIntent). Held by [PushBridge] until
     * Dart listens on `jawwid/push_opens`; Dart then routes it.
     */
    private fun handlePushTap(intent: Intent?) {
        if (intent?.action != PushBridge.ACTION_OPEN) return
        val extras = intent.extras ?: return
        val raw = PushPayload.OPEN_KEYS.mapNotNull { k -> extras.getString(k)?.let { k to it } }.toMap()
        val open = PushPayload.fromTap(raw, extras.getString(PushBridge.EXTRA_NONCE), PushBridge.nonce(this)) ?: return
        // Consumed: a configuration change re-delivering this intent must not open it twice.
        intent.action = Intent.ACTION_MAIN
        PushBridge.open(open)
    }

    /**
     * A call action: shown over the lock screen and waking it (#408 review --
     * otherwise a full-screen ring or an Answer lands on the unlock prompt),
     * handed to Flutter, then cleared so nothing replays it. Shown over the lock
     * screen only while that call rings or is in progress ([LockScreenCall]).
     */
    private fun handleCallIntent(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != JawwidPush.ACTION_ANSWER && action != JawwidPush.ACTION_OPEN_CALL) return
        // Another app can start this exported activity with these actions and any call id;
        // only the ring this app drew carries the install's nonce (as a notification tap does).
        if (!PushPayload.isTrustedTap(intent.getStringExtra(PushBridge.EXTRA_NONCE), PushBridge.nonce(this))) return
        intent.getStringExtra(JawwidPush.EXTRA_CALL_ID)?.let { lockScreenCalls.ringing(it) }
        applyLockScreenPolicy()
        JawwidPush.onCallIntent(applicationContext, intent)
        intent.action = null
        intent.removeExtra(JawwidPush.EXTRA_CALL_ID)
    }

    /**
     * Show over the lock screen (and turn the screen on) exactly while a call from the
     * lock screen rings or is in progress; otherwise reset both, so after the call the
     * phone shows its lock screen, not the app.
     */
    @Suppress("DEPRECATION")
    private fun applyLockScreenPolicy() {
        val show = lockScreenCalls.showWhenLocked()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(show)
            setTurnScreenOn(show)
        } else {
            // Android 8.0 (minSdk 26): the window flags, the only way there.
            val flags = android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            if (show) window.addFlags(flags) else window.clearFlags(flags)
        }
    }

    override fun onResume() {
        super.onResume()
        JawwidPush.inForeground = true
        applyLockScreenPolicy()
    }

    override fun onPause() {
        JawwidPush.inForeground = false
        super.onPause()
    }

    /** Defensive: leaving the screen with no call alive drops the lock-screen permission. */
    override fun onStop() {
        applyLockScreenPolicy()
        super.onStop()
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        // The engine ran the calls; with it gone nothing can end them, so none holds the lock screen.
        lockScreenCalls.clear()
        applyLockScreenPolicy()
        callChannel?.let { JawwidPush.detach(it) }
        callChannel = null
        PushBridge.detach()
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

        // PD-32: taps on ordinary notifications, and sign-out clearing the tray.
        val opens = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, OPENS_CHANNEL)
        PushBridge.openChannel = opens
        opens.setMethodCallHandler { call, result ->
            when (call.method) {
                "listen" -> {
                    PushBridge.listen()
                    result.success(null)
                }
                "clearDelivered" -> {
                    JawwidPush.clearMessages(applicationContext)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

        val callChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, JawwidPush.CALL_CHANNEL_NAME)
        this.callChannel = callChannel
        callChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "ready" -> {
                    JawwidPush.attach(applicationContext, callChannel)
                    result.success(null)
                }
                // Dart sends this when a call ends for this device (decline, missed, ended,
                // answered elsewhere, failed) and when its call controller is torn down
                // mid-call (sign-out, session rebuild). Not sent if Dart never took the ring
                // (busy, no session): that entry lapses with the tracker's ring window.
                "dismiss" -> {
                    call.argument<String>("callId")?.let {
                        JawwidPush.cancelCall(applicationContext, it)
                        lockScreenCalls.ended(it)
                    }
                    applyLockScreenPolicy()
                    result.success(null)
                }
                // S-06: the call keeps its microphone in the background (CallForegroundService).
                "ongoingStart" -> {
                    val callId = call.argument<String>("callId")
                    if (callId != null) {
                        CallForegroundService.start(applicationContext, callId, call.argument<String>("title").orEmpty())
                        // An answer from the lock screen stays over it for the whole call.
                        lockScreenCalls.connected(callId)
                    }
                    applyLockScreenPolicy()
                    result.success(null)
                }
                "ongoingStop" -> {
                    CallForegroundService.stop(applicationContext)
                    // The call is over: the app no longer shows over the lock screen.
                    call.argument<String>("callId")?.let { lockScreenCalls.ended(it) } ?: lockScreenCalls.clear()
                    applyLockScreenPolicy()
                    result.success(null)
                }
                // LR-27: may a ring take over the screen (Android 14+), and the screen to allow it.
                "canUseFullScreenIntent" -> result.success(JawwidPush.canUseFullScreenIntent(applicationContext))
                "openFullScreenIntentSettings" -> result.success(openFullScreenIntentSettings())
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
     * LR-27: the system screen where the person lets this app's calls take over the
     * screen (Android 14+), with the app's notification settings as the fallback.
     * Returns whether anything opened; false below Android 14, where there is no such
     * permission to give. It never throws into Flutter.
     */
    private fun openFullScreenIntentSettings(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
        val candidates = listOf(
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:$packageName")),
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
        )
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

        /**
         * Which calls let the app show over the lock screen. Process-wide, so a recreated
         * activity keeps a live call's permission. Touched only on the main thread (lifecycle
         * and channel handlers). The ring window: the ring, then time to connect an answer.
         */
        private val lockScreenCalls = LockScreenCall.Tracker({ SystemClock.elapsedRealtime() }, 2 * JawwidPush.RING_TIMEOUT_MS)

        /** Shared with `lib/core/push/push_opens.dart`. */
        private const val OPENS_CHANNEL = "jawwid/push_opens"
    }
}
