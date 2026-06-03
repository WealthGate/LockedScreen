# Lockedscreen Android Mobile Runtime

Lockedscreen Mobile is an Android-first student fallback runtime. It is intended for cases where a student's laptop is unavailable and the school permits a managed phone to be used for an exam.

## Scope

The first mobile runtime is student-only:

- import a teacher-exported `.lscp` package
- verify package integrity
- verify the optional exam start code
- run app-based multiple-choice exams
- auto-submit when the timer expires
- calculate the same score as the desktop app through `@lockedscreen/exam-engine`
- send results to package-carried auto-sync destinations such as Google Sheets or a school Google Classroom grade-sync bridge

Teacher/admin setup remains in the Windows desktop app. OAuth client setup, Classroom class selection, package creation, and sync destination templates should not be managed from student phones.

## Security Boundary

Android cannot be locked down reliably by a normal app alone. A normal app can request fullscreen, keep the screen awake, and discourage navigation, but it cannot fully block Home, Recents, notification shade, system gestures, screenshots, or manufacturer overlays.

For real exam use, schools should deploy the Android app under one of these managed modes:

1. Android Enterprise device owner with Lock Task Mode.
2. A school MDM that pins Lockedscreen Mobile as a kiosk app.
3. Dedicated school exam phones provisioned only for Lockedscreen.

Personal unmanaged phones should be treated as a fallback convenience mode, not as a fully secure lockdown environment.

The generated Android project includes:

- `MainActivity` fullscreen/immersive mode
- `FLAG_KEEP_SCREEN_ON`
- Lock Task startup when Android permits it
- `LockedscreenDeviceAdminReceiver` for school/MDM device-owner provisioning

For lab testing on a dedicated resettable Android device, an administrator can provision the app as device owner with Android Debug Bridge after installing the APK:

```powershell
adb shell dpm set-device-owner com.wealthgate.lockedscreen.mobile/.LockedscreenDeviceAdminReceiver
```

Do not run device-owner provisioning on a personal phone unless you are prepared to factory reset the device.

## Package Compatibility

The Android runtime reads version 2 Lockedscreen packages, which include both:

- `ExamConfigPackage`
- `Exam`

The mobile decryptor is browser-compatible and matches the desktop package protection settings:

- AES-256-GCM
- scrypt key derivation using `N=16384`, `r=8`, `p=1`, `dkLen=32`
- SHA-256 package checksum verification

## LMS And Grade Sync

The mobile app does not carry teacher OAuth tokens. This keeps teacher credentials off student phones.

Automatic grade sync should use the same school-owned endpoints already configured in desktop package exports:

- Google Sheets: student result posts to the Apps Script `/exec` URL, which writes to the teacher Sheet.
- Google Classroom: student result posts to the school Classroom grade-sync bridge, which writes grades using teacher/admin authorization stored server-side.
- Generic LMS: student result posts to the configured school endpoint.

## Link-Based Exams

The first Android runtime does not run link-based Google Forms exams inside a mobile WebView. Google sign-in can be blocked in embedded browsers, and opening an external browser breaks kiosk control unless the school manages Chrome or a secure browser through MDM.

For phone-based Google Forms exams, the next phase should be an Android managed-browser design:

1. Lockedscreen Mobile starts a managed Lock Task session.
2. The school MDM allows only Lockedscreen and the approved browser package.
3. The app launches the Form URL through the managed browser path.
4. The Google Forms Apps Script trigger handles score passback after submission.

## Build Requirements

Android APK/AAB builds require:

- Android Studio
- JDK 17 or newer
- Android SDK
- Gradle/Android Gradle Plugin through the generated Capacitor Android project

The local Windows workspace can typecheck and build the web runtime without Android Studio. Native Android packaging requires installing the Android toolchain first, then running:

```powershell
npm install
npm run build --workspace @lockedscreen/mobile
npm run cap:sync:android --workspace @lockedscreen/mobile
npm run cap:open:android --workspace @lockedscreen/mobile
```
