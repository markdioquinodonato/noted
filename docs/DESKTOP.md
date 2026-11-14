# Noted Desktop (Windows & macOS)

Noted Desktop is the same React app wrapped in a native **Tauri v2** window. The UI is bundled inside the installer (no browser is opened), guest notes are stored on the computer, and accounts sync through the same Supabase project as the website.

## How it is built

| Piece | Where |
|---|---|
| Tauri app (Rust shell, plugins) | `src-tauri/` (`tauri.conf.json`, `capabilities/default.json`, `src/lib.rs`) |
| Desktop-only frontend code | `src/desktop/desktop.ts`, `src/lib/platform.ts` |
| Download dialog (website) | `src/features/download/` |
| CI build + release | `.github/workflows/desktop.yml` |
| Helper scripts | `scripts/desktop-release-config.mjs`, `scripts/collect-installers.mjs` |

The frontend is a static Vite build (`npm run build:desktop`, mode `desktop`), so no server code, API routes or secrets are involved. Only the public Supabase URL and the **publishable** key are compiled in.

### Desktop behaviour

- **Window:** native title bar with minimize, maximize and close. Only one instance runs at a time; a second launch focuses the open window. The default macOS app menu (Edit, Window, Quit) is provided by Tauri.
- **Offline / guest mode:** notes are kept in the webview's IndexedDB under the app identifier `ph.noted.desktop`. On Windows this is `%LOCALAPPDATA%\ph.noted.desktop\EBWebView`; on macOS it is `~/Library/WebKit/ph.noted.desktop`. Data survives restarts and app updates. It does **not** survive uninstalling with "delete app data", or manually deleting those folders. **Never change the identifier**, or existing users will lose access to their local notes.
- **Accounts:** email and password sign-in work inside the app window. Verification and password-reset emails open the website (`VITE_SITE_URL`); afterwards, log in in the app.
- **Files:** export and download use the native **Save** dialog. Imports use the normal file picker.
- **Links:** external links open in the default browser, never inside the app.
- **Camera / microphone:** these use the system webview. macOS asks permission using the texts in `src-tauri/Info.plist`. If no camera is available, the scanner falls back to image upload; note editing is never affected.
- **Security:**
  - The Content Security Policy only allows the bundled app, `*.supabase.co` (HTTPS/WSS), and local `blob:`/`data:` URLs.
  - The app gets least-privilege permissions only: open URL, save dialog, write the file the user chose, restart, and check/install updates.
  - No service worker runs in the desktop app.

## Building installers (GitHub Actions)

Workflow: **`.github/workflows/desktop.yml`**

| Job | Runner | Output |
|---|---|---|
| Windows x64 | `windows-latest` | `Noted_<v>_x64-setup.exe`, `Noted_<v>_x64_en-US.msi` |
| macOS Apple Silicon | `macos-latest` (`aarch64-apple-darwin`) | `Noted_<v>_aarch64.dmg`, `Noted.app.tar.gz` |
| macOS Intel | `macos-latest` (`x86_64-apple-darwin`) | `Noted_<v>_x64.dmg`, `Noted.app.tar.gz` |

The installers are also uploaded as workflow artifacts with friendly names: `Noted-Setup-Windows-x64.exe`, `Noted-Windows-x64.msi`, `Noted-macOS-AppleSilicon.dmg` and `Noted-macOS-Intel.dmg`.

- **Run workflow** (manual): builds all platforms and uploads artifacts. Tick **release** to also publish.
- **Push tag `vX.Y.Z`** (must equal `package.json` version): builds everything and publishes the GitHub Release only after every platform succeeded **and** all installers plus `latest.json` are attached. Otherwise the release stays a draft.

### Required repository settings

| Kind | Name | Value |
|---|---|---|
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | contents of `.tauri-signing/noted-updater.key` (local, git-ignored) |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty (the key was generated without a password) |
| Variable | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key |
| Variable | `VITE_SITE_URL` | `https://noted-ph.pages.dev` |

**Back up `.tauri-signing/noted-updater.key`.** If it is lost, installed apps can no longer receive updates; users would have to reinstall manually.

### Website download buttons

Set `VITE_RELEASES_REPO=<owner>/<repo>` in `.env.production.local` before building for Cloudflare Pages. The dialog reads `https://api.github.com/repos/<owner>/<repo>/releases/latest`, which only returns **published** releases, and links straight to the release assets. Missing installers show "Coming Soon — Installer Not Available Yet". In the desktop app the download entry is replaced by **Check for updates**.

## Code signing & notarization

- **Windows:** installers are not code-signed with a commercial certificate. SmartScreen shows "Windows protected your PC"; the user clicks **More info → Run anyway**. To remove the warning, buy an OV/EV code-signing certificate (or use Azure Trusted Signing) and add the Tauri `bundle.windows.signCommand`/certificate settings.
- **macOS:** without Apple Developer secrets the app is **ad-hoc signed only and NOT notarized**. Gatekeeper blocks a double-click on first launch; the user must right-click **Noted → Open**. On recent macOS versions they may instead need **System Settings → Privacy & Security → Open Anyway**. To notarize, join the Apple Developer Program ($99/yr) and add these repository secrets:
  - `APPLE_CERTIFICATE`: a base64 "Developer ID Application" .p12
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_SIGNING_IDENTITY`
  - `APPLE_ID` and `APPLE_PASSWORD` (an app-specific password)
  - `APPLE_TEAM_ID`

  The workflow picks them up automatically.

## Local development

```bash
npm run desktop:dev     # needs Rust + platform build tools (MSVC on Windows, Xcode CLT on macOS)
npm run desktop:build   # local installers in src-tauri/target/release/bundle/
```

Local builds read the public Supabase values from `.env.desktop.local` (git-ignored).
