# Building the Android app (APK) with Capacitor and Android Studio

The Android project is already set up in `android/`: app id `com.realtynmore.news`, name **R&M News**, with the R&M launcher icon and a charcoal splash screen. Everything below is free. A Google Play developer account costs a one-time fee, but you only need it to publish on the Play Store; you can install the APK directly without it.

## 1. One-time setup (about 30–45 minutes, mostly downloads)

1. **Install Android Studio** (free) from <https://developer.android.com/studio>.
   - Choose the **Standard** setup. This installs the Android SDK, an emulator and a Java runtime (JDK 21), which Capacitor 8 needs.
   - You don't need to install Java separately.
2. Open Android Studio once and let it finish downloading SDK components.
3. Optional, if `npx cap open android` can't find Android Studio: in PowerShell, point Capacitor at it. This is the default install path:

   ```powershell
   setx CAPACITOR_ANDROID_STUDIO_PATH "C:\Program Files\Android\Android Studio\bin\studio64.exe"
   ```

   Close and reopen the terminal afterwards.

## 2. Build the web app and copy it into Android

From `C:\RealtyNMore\news-app`:

```bash
npm run android:sync
```

This runs the production build (it also refreshes the YouTube list bundled with the app) and copies `dist/` into the Android project. **Run it again after every change to the app.**

If you ever delete and re-create the `android/` folder (`npx cap add android`), restore the R&M icons with:

```bash
python scripts/android_icons.py
```

## 3. Open the project in Android Studio

```bash
npx cap open android
```

Wait for **Gradle sync** to finish (progress bar at the bottom; the first run takes several minutes).

## 4. Build a test (debug) APK

**Build ▸ Build App Bundle(s) / APK(s) ▸ Build APK(s)**

When it finishes, click **locate** in the pop-up. The file is:

```
android\app\build\outputs\apk\debug\app-debug.apk
```

Command-line alternative (run inside `android\`, with `JAVA_HOME` set to Android Studio's JDK):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug
```

### Install it on a phone

- **USB:** on the phone, open *Settings ▸ About phone* and tap *Build number* 7 times. Then turn on *Developer options ▸ USB debugging*, plug the phone in, pick it in Android Studio's device list and press **Run ▶**.
- **Or share the file:** send `app-debug.apk` to the phone and open it. Android will ask you to allow installs from that app (file manager or WhatsApp) first.

## 5. Build a release (signed) version

A debug APK is fine for testing. For real distribution, sign the app:

1. **Build ▸ Generate Signed App Bundle / APK**.
2. Choose **Android App Bundle** (for the Play Store) or **APK** (to share directly).
3. Click **Create new…** to make a keystore. Store the `.jks` file and both passwords somewhere safe outside the project, such as a password manager. **If you lose them, you can never publish updates to the same app.** `.gitignore` already keeps `*.jks` / `*.keystore` out of Git.
4. Choose the **release** build variant and click **Create**. Output: `android\app\release\`.

Before each new release, raise `versionCode` (for example 1 → 2) and `versionName` (for example "1.0" → "1.1") in `android\app\build.gradle`.

## 6. How the Android app gets its content

| Content | Source in the Android app |
|---|---|
| News, images, categories, search | realtynmore.com WordPress API (live) |
| Videos and podcasts | YouTube RSS, fetched directly through Capacitor's native HTTP (no CORS problem). If that fails, it uses the copy bundled at build time. |
| Saved articles | Stored on the phone, available offline |
| Sharing | Android share sheet (`@capacitor/share`) |
| Back button | Goes back inside the app; exits from the first screen |

## Troubleshooting

- **"Unsupported Java" or Gradle JDK errors:** *File ▸ Settings ▸ Build, Execution, Deployment ▸ Build Tools ▸ Gradle ▸ Gradle JDK* → choose the bundled **jbr-21**.
- **Old content in the app:** run `npm run android:sync` again, then rebuild.
- **A YouTube video won't play inside the app** (YouTube sometimes blocks embeds in app WebViews): use the **Watch on YouTube** button in the player. It opens the YouTube app.
- **Header sits under the status bar on a particular phone:** the layout already uses safe-area insets. If one device still overlaps, tell me which model and Android version.
