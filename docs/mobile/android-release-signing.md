# Android release signing (PD-56)

## How a release build is signed

A release build is signed only with the **upload key** named in
`android/key.properties`. That file is git-ignored, as are `*.jks` and
`*.keystore`. Copy `android/key.properties.example` to create it. It needs:

| Field | Meaning |
|---|---|
| `storeFile` | the upload keystore, absolute or relative to `android/` |
| `storePassword` | the keystore's password |
| `keyAlias` | the upload key's alias |
| `keyPassword` | the key's password |

The release build **fails** before building anything if any of these is wrong:
- the file is missing;
- a field is empty;
- the keystore it names does not exist.

The error reads `Release signing: …`. A release build is **never** signed with
the debug key; that fallback was removed. Debug builds and `flutter run` need
nothing.

Store builds go through `scripts/mobile/build-store.sh android`, which checks
for the file too (`docs/mobile/store-builds.md`).

## Google Play App Signing

Google Play signs what users install with the **app signing key**, which
Google holds. We sign uploads with our **upload key**.

### First upload (once, by the owner in the Play Console)

1. Create the upload key on a trusted machine:

   ```bash
   keytool -genkeypair -keystore jawwid-upload.jks -storetype PKCS12 \
     -alias jawwid-upload -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Keep `jawwid-upload.jks` and its passwords in the team's password manager,
   **never in git**, a ticket or chat.
3. Create the app in the Play Console with Play App Signing on, and let Google
   generate the app signing key.
4. Build with `scripts/mobile/build-store.sh android` and upload the `.aab`.
   Play registers the key that signed it as the upload key.

### Later

- **A lost or leaked upload key:** ask Google Play support to reset it. The app
  signing key, and every installed user, are not affected.
- **Server checks need the app's certificate** (for example, Android App
  Links): use the app signing key's SHA-256 from Play Console → App integrity,
  not the upload key's.
