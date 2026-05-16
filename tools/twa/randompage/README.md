# RandomPage Android TWA

RandomPage Android uses the same Rollersoft Store path as Crossroads/LifeForge:
Bubblewrap Trusted Web Activity → GitHub Release APK asset → `exisz/apps-repo` publish workflow.

This does **not** change the RandomPage web app UI. It wraps the production PWA at:

<https://app.randompage.rollersoft.com.au>

## CI path

1. Push a `v*.*.*` tag.
2. `.github/workflows/android-build.yml` builds `randompage-bubblewrap-release.apk`.
3. The release asset URL is resolved after upload.
4. `.github/workflows/publish-to-store.yml` calls `exisz/apps-repo/.github/workflows/publish.yml`.
5. Rollersoft Store index updates at <https://repo.rollersoft.com.au> / <https://exisz.github.io/apps-repo/index.json>.

Required repo secrets mirror Crossroads/LifeForge:

- `TWA_KEYSTORE_BASE64`
- `TWA_KEYSTORE_PASSWORD`
- `TWA_KEY_PASSWORD`
- `APPS_REPO_PAT`

## Local manual build

Requires Java + Android SDK:

```bash
cd tools/twa/randompage
# android.keystore must exist locally, with alias android.
yes "" | pnpm dlx @bubblewrap/cli build --skipPwaValidation
```
