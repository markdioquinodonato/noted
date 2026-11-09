# Noted implementation report

Updated 8 November 2026. Changes were made in the existing `smart-notepad` application. No hosted database was connected, reset, or migrated.

## Existing application audit

The application already used React 19, TypeScript, Vite, Tailwind 4, Radix/shadcn, TanStack Query, Supabase Auth/PostgreSQL, and IndexedDB. It had guest access, authentication screens, password recovery, profile settings, note CRUD, pinning, archive/trash, folders/tags, plain-text search, TXT import/export, debounced autosave, draft recovery, and version history. Its initial checks passed 90 tests, lint, and TypeScript.

That architecture, branding assets, existing records, and plain-text content were retained. Next.js would have required an unnecessary framework migration. Server-only AI runs as a Supabase Edge Function.

## Added behavior

- Rich editor: bold, italic, underline, strike, H1–H3, bullets, numbered lists, interactive checklists, task reordering, highlight, quote, links, code, divider, tables, undo/redo, and keyboard formatting shortcuts. Task completion is persistent. Unsupported HTML never becomes application markup.
- Note favorites, colors, duplication, per-card actions, grid/list preference, and full-screen writing. Dashboard shows actual recent/pinned/favorite notes, folder counts, and reminder schedules. Desktop sidebar collapses; mobile navigation remains a drawer.
- Optional Personal, School, and Work folders through an explicit button; folder colors and icons. Custom folder/tag creation, rename, deletion and existing counts remain intact. Deleting a folder keeps its notes.
- Search includes title, readable rich content, folder and tag names, with created/edited-since filters and existing sort/highlight controls. Cloud queries retain RLS and pagination.
- Stored reminders with due indicators, completion/cancellation, a notifications inbox, in-app delivery while open, and opt-in browser notifications. Notifications are deduplicated in persistent storage.
- Attachments: upload/download/delete, image/audio previews, 10 MB limit, an allowlist of MIME types/extensions, guest IndexedDB blobs, and private Supabase bucket policies. HTML, executables and SVG are excluded. Owners alone access attachments.
- Voice: MediaRecorder recording, pause/resume, stop, preview, and persistent audio attachment. Live browser dictation has an editable transcript and insertion action, a service-use notice, and unsupported/denied-permission handling.
- Markdown import/export, PDF text import, DOCX import/export, plus browser Print / Save as PDF. Word conversion preserves supported headings, marks, links, paragraphs, lists and tables. DOCX HTML passes through DOMPurify and the editor schema. PDF import is limited to 100 pages; scanned PDFs require external OCR. Documents are limited to 1 MB, 50 files per import, and 1,000,000 stored characters; DOCX expanded-size limits reject ZIP bombs.
- Internal note links, searchable selection, backlinks, and Ctrl/⌘+click navigation. Deleted or inaccessible targets produce the existing not-found state. Guest-to-account import remaps links between selected notes and carries note/folder appearance and reminder fields.
- Account sharing: registered-user lookup through an ownership-checked RPC, read or text-edit permission, collaborators, revocation, a Shared Notes view, optional Supabase Realtime updates, and a polling fallback. Atomic revision checks prevent silent concurrent overwrites. This is conflict-aware editing, **not CRDT/character-level merging or live cursors**.
- AI integration: ten writing actions, explicit provider disclosure, selected-text or whole-note input, editable preview, insert/replace/copy/cancel, replacement confirmation, server-side authentication, a 20-request/hour atomic quota, input/output limits, timeout and safe errors. Only actual Anthropic responses can become results. Without configured services it displays an unavailable state and sends no note text.
- Offline: production app-shell service worker, guest offline reload/editing, and account-scoped snapshots of previously opened owned notes. Shared notes are excluded from the offline snapshot cache. Pending text drafts synchronize using revision checks. Organization changes, file uploads and new cloud notes still require connectivity. Logout clears account snapshots.

## Reliability and security fixes

Metadata operations now share the text-save lock, including simultaneous favorite/pin changes while typing. A failed trash operation no longer reports success or closes the note. Failed local draft backups are surfaced; an offline state cannot claim a local backup succeeded when it failed. Version restoration is blocked while pending edits cannot be saved. Conflict controls include keeping both versions as separate notes and downloading local edits.

The migration retains ownership grants and RLS, adds shared access without permitting direct collaborator metadata updates, and locks notes before shared revision-checked writes. Storage policies verify the metadata path and owner. Security tests caught and corrected an ambiguous storage-column reference. Cached static asset lookup ignores `Vary` headers because its allowlist contains only immutable, build-owned files; API and authentication requests are never cached by the service worker.

Guest account import does not transfer attachments. Guest copies that still have attachments are kept even when the user requests removal of verified local copies. Download and reattach files separately. Existing guest version history also stays local.

## Database migrations

Apply migration files in filename order through the Supabase migration ledger, once per target database:

1. Existing `20261108000000_init_schema.sql` — base tables, ownership, RLS, versions and search.
2. New `20261108010000_productivity.sql` — note/folder fields; `note_shares`, `attachments`, `notifications`; access/sharing/save RPCs; rich search and indexes; extended counts.
3. New `20261108020000_private_storage.sql` — private `note-attachments` bucket and object policies.
4. New `20261108030000_ai_quota.sql` — private quota counters and authenticated quota RPC.
5. New `20261108040000_realtime.sql` — adds notes to the existing Supabase Realtime publication when present.

No destructive reset or hosted migration was executed. Existing data is preserved by the additive upgrades. PGlite tests execute these actual SQL files with Supabase auth/storage role stubs. They are not a substitute for smoke testing the hosted Supabase APIs before release.

## Dependencies and configuration

Added `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, task-list/task-item/highlight/table extensions, `@tiptap/markdown`, `docx`, `mammoth`, `pdfjs-dist`, and `dompurify`. The `minimatch` override updates the vulnerable transitive glob package without downgrading ESLint. Runtime document parsers are loaded when used. Editor/UI/React/Supabase bundles are grouped for caching.

Frontend optional environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SITE_URL`. Without these, guest storage works without an account. Never expose service-role keys or provider secrets through `VITE_*`.

AI server secrets: `ANTHROPIC_API_KEY`, a supported `ANTHROPIC_MODEL`, and the exact frontend `ALLOWED_ORIGIN`. The Edge runtime supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Deploy `ai-writer` and apply its quota migration. A model ID is deliberately not hardcoded; choose a model available to your provider account.

## Verification and release limits

Final checks: lint and TypeScript passed; 115 unit/component/PostgreSQL tests passed; production build passed; 47 desktop/mobile browser tests passed with 5 explicit skips; npm audit found 0 vulnerabilities; the AI Edge Function passed Deno type checking. Desktop and mobile dashboard screenshots were inspected. The suite covers note persistence, rich formatting/checklists, attachments, reminders, import/export, voice bytes using Chromium's synthetic microphone, XSS rejection, links, folder appearance, offline reload/reconnection, and desktop/mobile layout. Unit and real PostgreSQL tests cover revision races, storage failures, user isolation, sharing/revocation, file policies, and quotas.

Still requiring external configuration or work:

- Hosted Supabase sign-up/login, storage API transfers, account import, shared updates and Realtime need a real test project and two test accounts. The four hosted-cloud browser cases are skipped without credentials.
- AI provider generation is type-checked and securely wired, but no authenticated provider call has been made here.
- Browser notification permissions/delivery and live dictation depend on browser support, service access, and user permission. Real microphone hardware has not been accessed.
- Closed-app reminder delivery requires a scheduled backend plus Web Push/email infrastructure; that delivery worker is not implemented.
- Existing audio-file transcription needs a configured transcription provider. Current browser dictation captures live speech only.
- Character-level collaborative merging/live cursors, automatic scanned-PDF OCR, end-to-end encryption, and password-locked notes are not implemented or advertised.
- PDF export invokes the browser print/save workflow; automated direct PDF download is not implemented. Complex Word layouts, embedded images and document-specific page styles are not fully preserved. Attachments export separately from text backups.
- Offline tests verify guest reload/editing. Full hosted-account synchronization under token expiry and cross-device interruption still needs the configured cloud test environment.

Do not call this deployment production-verified until those hosted integrations and supported real browsers have passed acceptance checks.

## Files changed

Created:

- `src/lib/richText.ts`; `src/data/attachments.ts`; `src/data/offlineCache.ts`.
- `src/features/io/documents.ts`.
- `src/features/notes/{RichEditor,ProductivityTools,AiAssistant,Dashboard,NotificationInbox}.tsx`; `src/features/notes/reminders.ts`.
- Four upgrade migrations listed above; `supabase/functions/ai-writer/index.ts`; `supabase/functions/.env.example`.
- `scripts/offline-build.mjs`; `tests/db/productivity.test.ts`; `tests/unit/productivity.test.ts`; `e2e/productivity.spec.ts`; `e2e/voice.spec.ts`; this report.

Modified:

- `package.json`, `package-lock.json`, `vite.config.ts`, `eslint.config.js`, `README.md`.
- `src/app/RepositoryProvider.tsx`; `src/main.tsx`; `src/index.css`; `src/lib/text.ts`.
- `src/domain/{types,repository,query}.ts`; `src/data/drafts.ts`; `src/data/local/localRepository.ts`; `src/data/cloud/cloudRepository.ts`.
- `src/features/auth/AuthProvider.tsx`; `src/features/io/txt.ts`; `src/features/migration/{guestMigration.ts,ImportPage.tsx}`.
- `src/features/notes/{Workspace,Sidebar,NoteList,NoteEditor,VersionHistoryDialog}.tsx`; `src/features/notes/{hooks,noteSaver}.ts`.
- `tests/setup.ts`, `tests/components/app.test.tsx`, `tests/db/{harness,rls.test}.ts`, `tests/unit/{localRepository,noteSaver}.test.ts`, `e2e/{guest,cloud}.spec.ts`.

The repository was already entirely untracked at inspection, so Git has no committed baseline for a conventional diff. Existing files were edited in place; no commit, publish, or deployment was made.

## Reference documentation

[Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react), [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage), [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [storage access policies](https://supabase.com/docs/guides/storage/security/access-control), [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create), [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting).

The subsequent [login and Guest Mode upgrade](AUTH-AND-GUEST-MODE.md) adds local English camera OCR, account menus, stronger session cleanup and stricter migration verification without another database migration.
