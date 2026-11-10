# Making the Android upload key (LR-07c)

**Who:** the owner, once. Never CI, never an agent, never the development user.
**Script:** `scripts/mobile/make-upload-key.sh`.
**Where the values go:** the `store-release` Environment of `docs/release/signed-builds-ci.md`
(the Android secrets and the `ANDROID_UPLOAD_CERT_SHA256` variable). This page replaces the bare
`keytool -genkeypair` line in `docs/mobile/android-release-signing.md` step 1 with a script that sets
every option for you.

With Play App Signing, Google holds the app signing key; this is only the **upload** key. A lost or
leaked upload key can be reset in Play Console, but treat it as a secret all the same.

## 1. Prepare a clean place to run it

1. On your Mac, create a **dedicated standard user** (System Settings → Users & Groups → Add User,
   type *Standard*, not Administrator). Log in to it. Do not use the development user: nothing from
   its shell, tools or agents should be present when the key is made. (While keytool runs, the
   password is in its environment, which other processes of the same macOS user can read.)
2. Install a JDK in that user if `keytool -help` does not work (for example the Temurin installer
   from adoptium.net).
3. Copy `scripts/mobile/make-upload-key.sh` from a reviewed commit on `main` into an **empty folder**
   in that user, for example `~/upload-key/`. Read it: it is short. Never run it inside a project
   folder or a git checkout: the script refuses a folder that has a `.git` in it or in any parent
   folder, and any path containing `/dev/` or `/Documents/jawwid`.
4. Make the password in your password manager: **letters and digits only** (A-Z, a-z, 0-9), **at least
   16 characters**; prefer 32. The CI workflow writes it into a Java properties file and refuses
   anything else.

## 2. Run it

```sh
cd ~/upload-key
bash make-upload-key.sh
```

It asks for the password twice (nothing is shown as you type). Or pipe it in from your password
manager's command line, one line on stdin, so it is never typed or pasted:

```sh
<your password manager CLI> read <item> | bash make-upload-key.sh
```

The script:
- refuses to start if `jawwid-upload.jks` already exists in the folder (it never overwrites a key);
- refuses a password that is not letters and digits only, or is shorter than 16 characters, and a
  typed password whose two entries differ;
- refuses to run in CI and refuses any command-line argument (the password is never accepted there);
- refuses to run inside a git checkout (a `.git` in the folder or any parent) or a project area (a
  path containing `/dev/` or `/Documents/jawwid`);
- runs `keytool -genkeypair -keystore jawwid-upload.jks -storetype PKCS12 -alias jawwid-upload
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Jawwid LLC upload key, O=Jawwid LLC"`
  (no personal names in the certificate);
- gives keytool the password only through an environment variable (`-storepass:env`,
  `-keypass:env`), unset right after; the password is never written to a file or a command line;
- sets the keystore to mode 600.

It prints only:
- the certificate's **SHA-256**, for the variable `ANDROID_UPLOAD_CERT_SHA256`;
- the secret names to fill;
- the command that puts the keystore's base64 on the clipboard without showing it:
  `base64 -i jawwid-upload.jks | tr -d '\n' | pbcopy`.

It never prints the password or the base64.

## 3. Fill in the `store-release` Environment

GitHub → the repository → Settings → Environments → `store-release`. Paste each value yourself:

| Kind | Name | Value |
|---|---|---|
| variable | `ANDROID_UPLOAD_CERT_SHA256` | the SHA-256 the script printed |
| secret | `ANDROID_UPLOAD_KEYSTORE_BASE64` | run the `base64 … \| pbcopy` line, then paste |
| secret | `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | the password, from your password manager |
| secret | `ANDROID_UPLOAD_KEY_ALIAS` | `jawwid-upload` |
| secret | `ANDROID_UPLOAD_KEY_PASSWORD` | the **same** password (a PKCS12 keystore has one password) |

Then clear the clipboard (copy any harmless text).

## 4. Keep it, and clean up

- Store `jawwid-upload.jks` as an attachment of the password manager item that holds its password,
  plus one offline encrypted copy (`docs/release/signing-on-existing-mac.md` §6).
- Then delete the folder in the dedicated user. Keep the user for the next key operation, or delete
  it too.
- When Play Console asks for the upload certificate, or shows it under **App integrity**, compare its
  SHA-256 with the one the script printed.

## 5. If something goes wrong

- *"already exists; refusing to overwrite it"*: you are in a folder that already holds a key. Use a new
  empty folder; never delete a key you may have uploaded or stored.
- *keytool could not create the keystore*: its own message is shown. If a partial `jawwid-upload.jks`
  was left behind, delete that file yourself and run again.
- *its SHA-256 could not be read*: the key was made; run
  `keytool -list -v -keystore jawwid-upload.jks -alias jawwid-upload` (it asks for the password) and copy
  the `SHA256:` line.

## 6. Tests

`test/scripts/make_upload_key_script_test.dart` runs the script against a stand-in `keytool` that
records its arguments and environment (no real key is made). It checks that the script refuses to
overwrite a keystore (file or symlink), refuses weak or invalid passwords and extra stdin, refuses CI and
arguments, refuses a git checkout or project folder, never prints the password or the base64, passes the password via the environment and never
argv, sets mode 600, and prints the fingerprint line. The hidden two-prompt path needs a terminal and is
checked only by reading the script.
