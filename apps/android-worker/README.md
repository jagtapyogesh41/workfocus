# ShiftFocus Worker — Native Android Companion App (BYOD)

This native Android (Kotlin) app enforces **real on-device app blocking** on workers' personal Android phones during active shifts, backed by the ShiftFocus API (`/v1/device/*`).

## How It Works
1. **Background Sync (`FocusMonitorService`)**: Polls `GET /v1/device/status` every 3 seconds to fetch the latest `desiredMode` (`focus` vs `unrestricted`), `restrictedApps`, `alwaysAllowedApps`, and `override` state.
2. **Real App Blocking (`UsageStatsManager` + `ShiftAccessibilityService`)**: When `desiredMode == "focus"` and no emergency override is active, opening any restricted package (e.g. `com.instagram.android`, `com.google.android.youtube`) immediately launches `BlockedAppActivity` over it.
3. **1-Tap Emergency Override**: Workers can tap **⚡ Emergency Override** from either the main screen or the blocking screen to unlock all apps immediately (`POST /v1/device/override`).

## Building the APK
- **GitHub Actions**: Every push touching `apps/android-worker/**` (or manual **Run workflow**) builds `app-debug.apk` and uploads it as the **`ShiftFocus-Worker-APK`** artifact.
- **Android Studio**: Open `apps/android-worker/` in Android Studio and click **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

## Required Permissions on Worker Phone
1. **Usage Access** (`Settings → Apps → Special app access → Usage access → ShiftFocus Worker`)
2. **Display over other apps** (`Settings → Apps → Special app access → Display over other apps → ShiftFocus Worker`)
3. **Accessibility Service** *(optional, for instant blocking)* (`Settings → Accessibility → ShiftFocus Worker`)
