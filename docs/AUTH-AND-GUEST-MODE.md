# Noted: login and Guest Mode

Implemented in the existing React/Vite application on 8 November 2026. Existing branding, Supabase tables and local notes were retained. No hosted database was changed.

## Entry and guest experience

The welcome screen provides **Log In**, **Create an Account**, and **Continue as Guest**. Choosing Guest opens the actual dashboard immediately. Local note creation, editing, trash/recovery, folders, tags, favorites, pins, rich formatting, checklists, search, imports/exports, themes and camera text scanning work without Supabase credentials.

Guest data uses IndexedDB. Tests verify persistence after refresh, offline reload, and closing and reopening an entire browser process with the same profile. Local data can still be lost when browser data is cleared or evicted; it is not a permanent backup.

The **Guest account menu** includes login, registration, import/export and Guest Data Information. Account-only sharing, collaboration and cloud features retain explanatory unavailable states. A non-modal warning appears when IndexedDB is inaccessible or full. Blocked localStorage/sessionStorage preference reads also fall back safely so the warning screen remains usable. Export includes the currently open editor's latest text, even if its autosave is pending.

## Local camera text scanner

The sidebar scanner supports camera permission, a live preview, capture, image selection, real English OCR, editable recognition results, and saving the result as an actual note. Camera tracks and recognition workers are released on close. Unsupported/denied camera access still allows image selection.

Recognition uses `tesseract.js` and `@tesseract.js-data/eng`. `scripts/prepare-ocr.mjs` copies the packaged worker, baseline WASM core, English model and license into generated `public/ocr/` files before development/build. No external image service or account is used. Production builds cache these same-origin files with the app shell. Offline recognition is verified after that cache has installed.

The scanner accepts PNG/JPEG/WebP up to 10 MB and 25 megapixels, and downsizes images before recognition. Current recognition is intended for printed English. Handwriting and other languages are not advertised as supported. Tests use a synthetic camera plus generated printed-text images; no personal camera hardware or images were accessed.

## Authentication and isolation

The existing Supabase registration, email/password login, verification callback, password reset, persistent sessions and profile settings remain in use. Invalid cloud URLs disable cloud configuration without blocking Guest Mode.

Each guest/account identity now receives its own TanStack Query client. Switching identities cancels and clears the former query cache. Old note savers stop issuing retries while preserving scoped drafts. Signed-out account snapshots are blocked from being repopulated by late responses and are cleared. Repository requests check that the active session matches their account scope. Guest storage never receives account records.

Session initialization ignores a stale `getSession()` result if a newer auth event has selected another user. Failed session restoration no longer causes an unhandled rejection. Logout uses Supabase's current-session sign-out and reports failures instead of falsely entering Guest Mode. If unsaved edits have neither a successful save nor a local backup, manual logout asks the user to save/download those edits first.

Settings and the account menu offer **Sign out & continue as guest**. This ends the current authenticated session before entering the separate guest dashboard. Unsynced account drafts remain scoped to that account for a later authenticated session; no encryption is claimed.

## Safe guest-to-account transfer

After login, a quiet banner offers: “Would you like to save your guest notes to your account?” The review screen shows the actual notes and selection count. No automatic upload or deletion occurs.

Deterministic per-account IDs keep retries resumable and prevent unnecessary duplicates. Existing account note content is never overwritten. Verification now compares content and note metadata, including folders, tags, favorites, colors, archive/trash and reminders; merely finding a cloud ID is insufficient. Equivalent PostgreSQL timestamp representations are compared correctly. Divergent existing cloud copies remain unchanged and the guest copy stays local.

Verified transfers produce receipts for both copies. Before local removal, the app re-reads both sides and checks those receipts. Local deletion also compares the expected note inside an IndexedDB transaction, including tag-only changes. Newly changed guest notes are offered for review again using a per-account revision ledger. Unrelated empty guest folders/tags are retained.

Guest attachments and local version history are not transferred by account import. Guest notes with attachments are retained rather than discarded. Download/re-attach files separately.

## Verification

- `npm test`: **115 passed** in nine files, including PostgreSQL access policies and test-only auth lifecycle clients.
- `npm run test:e2e`: **47 passed, 5 explicitly skipped**, desktop and mobile Chromium.
- The skipped cases are four hosted Supabase cases without test credentials and one mobile exclusion for a desktop keyboard shortcut.
- Browser checks cover real offline OCR with zero external requests, camera capture, saving/reopening scanned text, full browser restarts, storage-denied warnings, guest account actions and the existing notepad features.
- A separate development-server smoke check verified OCR, saved-note reload and React Strict Mode, with zero page errors. The scanner screenshot was inspected.

Live registration/email delivery, Supabase note transfers and cross-device retrieval still require the configured test project and test users described in README. Lifecycle tests use test doubles only in the test directory; the application uses real Supabase APIs. No demo accounts, mocked production operations, deployment or destructive migration were added.

## Main changed files

- New: `src/features/auth/{AccountMenu.tsx,sessionCleanup.ts}`, `src/app/queryClient.ts`, `src/features/scanner/{ScannerDialog.tsx,ocr.ts}`, `src/features/io/exportAll.ts`, `src/features/notes/GuestStorageNotice.tsx`, `src/lib/browserStorage.ts`, `scripts/prepare-ocr.mjs`.
- Updated: auth provider/pages, repository provider, cloud/local repositories, offline cache, note saver, dashboard/sidebar/workspace/hooks, guest migration/review and settings.
- Tests: new `tests/components/authSession.test.tsx` and `e2e/scanner.spec.ts`; expanded migration/local repository tests and updated welcome-flow expectations.
- Configuration: package/lock files, `.gitignore` and README. No additional SQL migration is needed for this follow-up.

Run `npm install` followed by `npm run dev`. Production: `npm run build`, then serve `dist/` with SPA fallback and HTTPS for camera access. The prebuild step generates OCR assets automatically. Keep `.env.local` credentials private and use only Supabase publishable keys in `VITE_*` variables.
