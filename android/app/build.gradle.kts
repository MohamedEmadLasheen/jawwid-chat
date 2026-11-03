import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// PD-32 amendment: FCM needs the Firebase project's google-services.json, which is not
// committed (it is the project's, like the signing key). Without it the plugin is not
// applied, the build still builds, and the app simply receives no pushes on Android.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// PD-56 (store compliance): the release key. android/key.properties is git-ignored
// and holds storeFile, storePassword, keyAlias and keyPassword (docs/mobile/
// android-release-signing.md). Without it -- or with a field missing -- a release
// build FAILS: it is never signed with the debug key. Debug builds need nothing.
val releaseKeyFile = rootProject.file("key.properties")
val releaseKey = Properties().apply { if (releaseKeyFile.exists()) releaseKeyFile.inputStream().use { load(it) } }
val releaseKeyFields = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val releaseKeyProblem: String? = when {
    !releaseKeyFile.exists() -> "android/key.properties is missing"
    else -> releaseKeyFields.filter { releaseKey.getProperty(it).isNullOrBlank() }
        .takeIf { it.isNotEmpty() }?.let { "android/key.properties lacks ${it.joinToString()}" }
        ?: rootProject.file(releaseKey.getProperty("storeFile")).let { store ->
            if (store.exists()) null else "the keystore android/key.properties names does not exist: ${store.path}"
        }
}

android {
    namespace = "com.jawwid.jawwid_chat"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.jawwid.jawwid_chat"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // PD-56 (department head, 2026-11-02): Android 8.0+. Sentry's SDK (crash
        // reporting, S-07) needs API 26; Android 7.x is a very small share of devices.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseKeyProblem == null) {
            create("release") {
                storeFile = rootProject.file(releaseKey.getProperty("storeFile"))
                storePassword = releaseKey.getProperty("storePassword")
                keyAlias = releaseKey.getProperty("keyAlias")
                keyPassword = releaseKey.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // The upload key Google Play App Signing knows; never the debug key.
            signingConfig = if (releaseKeyProblem == null) signingConfigs.getByName("release") else null
        }
    }
}

// A release artefact without the release key is refused before anything is built.
gradle.taskGraph.whenReady {
    val releaseArtefact = allTasks.any { task ->
        task.project == project && task.name.contains("Release") &&
            (task.name.startsWith("assemble") || task.name.startsWith("bundle") || task.name.startsWith("package"))
    }
    if (releaseArtefact && releaseKeyProblem != null) {
        throw GradleException(
            "Release signing: $releaseKeyProblem. A release build is never signed with the debug key; " +
                "see docs/mobile/android-release-signing.md."
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // PD-23: local_auth's BiometricPrompt needs an AppCompat launch theme, or it
    // crashes on Android 8 and below (minSdk is 26 since PD-56). local_auth_android brings
    // biometric/fragment/core, not appcompat, so the theme's parent comes from here.
    implementation("androidx.appcompat:appcompat:1.7.1")
    // PD-32 amendment: ordinary pushes (FCM, data-only) drawn by the app.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.13.1")
    testImplementation("junit:junit:4.13.2")
}
