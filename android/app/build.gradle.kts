import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Store blocker S-05: Firebase (push) is configured by google-services.json from the
// owner's Firebase project, never committed (.gitignore). A DEBUG build without it runs
// with push off, so a developer's machine and CI keep building; a RELEASE build without it
// fails here, before anything is signed, because a store build that cannot ring is not one.
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}
gradle.taskGraph.whenReady {
    val releasing = allTasks.any { t ->
        t.project == project && (t.name.startsWith("assemble") || t.name.startsWith("bundle")) && t.name.contains("Release")
    }
    if (releasing && !hasGoogleServices) {
        throw GradleException(
            "android/app/google-services.json is missing. A release build needs it for push " +
                "notifications and call rings (Firebase Cloud Messaging). Download it from the " +
                "Firebase project (Project settings > Your apps > Android, package " +
                "com.jawwid.jawwid_chat) and place it at android/app/google-services.json.",
        )
    }
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
        minSdk = flutter.minSdkVersion
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
    // crashes on Android 8 and below (minSdk is 24). local_auth_android brings
    // biometric/fragment/core, not appcompat, so the theme's parent comes from here.
    implementation("androidx.appcompat:appcompat:1.7.1")

    // Store blocker S-05: push. Firebase Messaging only (no Analytics), versions from the BoM.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    // NotificationCompat.CallStyle (the incoming-call notification) is core 1.9+.
    implementation("androidx.core:core-ktx:1.13.1")
}
