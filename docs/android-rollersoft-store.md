# RandomPage Android / Rollersoft Store Release

RandomPage is packaged as a Capacitor Android wrapper around the production PWA at `https://app.randompage.rollersoft.com.au`.

## Build debug APK

```bash
pnpm install
# macOS Homebrew JDK example, if /usr/bin/java cannot find a runtime:
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
# Requires a valid Android SDK (`ANDROID_HOME` or apps/app/android/local.properties sdk.dir).
pnpm --filter @randompage/app android:apk:debug
```

Expected unsigned/debug artifact after Android SDK is available:

```text
apps/app/android/app/build/outputs/apk/debug/app-debug.apk
```

Current local validation reached Capacitor sync and Gradle configuration, then stopped because this Mac has no Android SDK configured:

```text
SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or sdk.dir in apps/app/android/local.properties.
```

## Production signing / store publish blocker

This repo/workspace currently has no discoverable Rollersoft Store CLI, API contract, signing keystore, or release credentials. Do **not** invent an upload endpoint.

To publish a signed release, provide:

1. Android signing keystore + alias/passwords (or CI secret names).
2. Rollersoft Store submission mechanism (CLI command, API docs, or repo path for release entries).
3. Store metadata requirements (icon/screenshot sizes, category, privacy URL, changelog format).

Until then, the reproducible output is the debug APK above, ready for device smoke testing.
