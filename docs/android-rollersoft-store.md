# RandomPage Android / Rollersoft Store Release

RandomPage is packaged as a Capacitor Android wrapper around the production PWA at `https://app.randompage.rollersoft.com.au`.

This document is intentionally Android/store-only. The web app UI must not be changed for this release path.

## Local debug APK

```bash
pnpm install
# Requires a valid Android SDK (`ANDROID_HOME` or apps/app/android/local.properties sdk.dir).
pnpm --filter @randompage/app android:apk:debug
```

Expected debug artifact:

```text
apps/app/android/app/build/outputs/apk/debug/app-debug.apk
```

## Signed release APK via GitHub Actions

Workflow: `.github/workflows/android-release.yml`

Required repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

The workflow builds the web bundle, syncs Capacitor, assembles a signed Android release APK, uploads the APK artifact, and attaches it to GitHub releases created from `v*.*.*` tags.

Release artifact name:

```text
randompage-release.apk
```

## Rollersoft Store

Rollersoft Store is the `exisz/apps-repo` repository published at:

- Web: `https://repo.rollersoft.com.au`
- Index: `https://exisz.github.io/apps-repo/index.json`

Store app directory for RandomPage:

```text
apps/randompage/
```

Store app id:

```text
au.com.rollersoft.randompage
```

Publishing means adding/copying the signed APK into `apps-repo/apps/randompage/`, updating `metadata.json`, rebuilding `index.json` with `scripts/rebuild-index.py`, then committing and pushing `exisz/apps-repo` main.
