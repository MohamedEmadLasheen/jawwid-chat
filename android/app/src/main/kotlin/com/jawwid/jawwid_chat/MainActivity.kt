package com.jawwid.jawwid_chat

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
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
 * sign-in, when a notification first matters, never at launch. `register` (LR-11)
 * does everything `start` does except that request, and answers whether a prompt
 * is still possible; Dart calls it at session start and `start` only after the
 * in-app explanation's Continue. `permissionStatus` and `openNotificationSettings`
 * (LR-11b) back the Settings row "Notifications on this device".
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
        if (savedInstanceState == null && !fromHistory) handleCallIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallIntent(intent)
    }

    /**
     * A call action: shown over the lock screen and waking it (#408 review --
     * otherwise a full-screen ring or an Answer lands on the unlock prompt),
     * handed to Flutter, then cleared so nothing replays it.
     */
    private fun handleCallIntent(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != JawwidPush.ACTION_ANSWER && action != JawwidPush.ACTION_OPEN_CALL) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        JawwidPush.onCallIntent(applicationContext, intent)
        intent.action = null
        intent.removeExtra(JawwidPush.EXTRA_CALL_ID)
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
                    JawwidPush.attach(applicationContext, callChannel)
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
                // LR-11: the token without the prompt; answers whether `start` would prompt.
                "register" -> result.success(registerForPush())
                // LR-11b: the status the Settings row shows, and its way back.
                "permissionStatus" -> result.success(notificationPermissionStatus())
                "openNotificationSettings" -> result.success(openNotificationSettings())
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
        registerForPush()
        if (Build.VERSION.SDK_INT < 33) return
        // Never asked, or refused once and the OS will still ask (LR-11b: the Settings
        // row's Allow). Blocked or granted: the OS would show nothing.
        val status = notificationPermissionStatus()
        if (status != STATUS_NOT_DETERMINED && status != STATUS_DENIED) return
        permissionPrefs().edit().putBoolean(PREF_REQUESTED, true).apply()
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
    }

    /**
     * LR-11b: this app's notification permission, as the Settings row shows it.
     *
     *  * `granted`: notifications are allowed (and not switched off in Settings).
     *  * `notDetermined`: Android 13+, never asked.
     *  * `denied`: Android 13+, refused once; the OS will still show its prompt.
     *  * `blocked`: only Settings can turn them on (switched off there, before
     *    Android 13 where there is no prompt, or refused a second time).
     *
     * Android does not say "never asked" itself: a permission never requested and
     * one refused twice both read "not granted, no rationale". So the first request
     * is remembered here (PREF_REQUESTED). Dismissing the very first prompt without
     * answering reads as `blocked`; the row then opens Settings, which still works.
     */
    private fun notificationPermissionStatus(): String {
        val enabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < 33) return if (enabled) STATUS_GRANTED else STATUS_BLOCKED
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) return if (enabled) STATUS_GRANTED else STATUS_BLOCKED
        if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS)) {
            return STATUS_DENIED
        }
        return if (permissionPrefs().getBoolean(PREF_REQUESTED, false)) STATUS_BLOCKED else STATUS_NOT_DETERMINED
    }

    private fun permissionPrefs() = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)

    /**
     * LR-11b "Open settings": this app's notification settings, where the person
     * can turn them on (or off). App info, then Settings, are the fallbacks for a
     * phone without that screen. Returns whether anything opened; never throws.
     */
    private fun openNotificationSettings(): Boolean {
        val candidates = listOf(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
            Intent(Settings.ACTION_SETTINGS),
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
     * Everything [startRegistering] does EXCEPT ask for POST_NOTIFICATIONS (LR-11
     * `register`): the app explains notifications first and asks through `start`
     * only after Continue. Returns whether the FIRST prompt is still to come: only
     * when the permission has never been asked (Android 13+). After a refusal it is
     * false, so a session start never asks again at launch; asking again is the
     * Settings row's Allow (LR-11b).
     */
    private fun registerForPush(): Boolean {
        JawwidPush.ensureChannels(applicationContext)
        val promptPossible = notificationPermissionStatus() == STATUS_NOT_DETERMINED
        if (FirebaseApp.getApps(applicationContext).isEmpty()) return promptPossible
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
        return promptPossible
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

        /** LR-11b: the statuses `notification_permission.dart` parses. */
        private const val STATUS_GRANTED = "granted"
        private const val STATUS_NOT_DETERMINED = "notDetermined"
        private const val STATUS_DENIED = "denied"
        private const val STATUS_BLOCKED = "blocked"

        /** Whether POST_NOTIFICATIONS was ever requested on this install. */
        private const val PERMISSION_PREFS = "jawwid_notification_permission"
        private const val PREF_REQUESTED = "requested"

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
