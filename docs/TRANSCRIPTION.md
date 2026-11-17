# Recorded-audio transcription

## Production activation and central administration — November 14, 2026

This section supersedes the historical implementation/deployment status below. The original report was reviewed before the activation changes. Existing transcription migrations and functionality were preserved.

| Requirement | Actual current status |
| --- | --- |
| Production frontend | Deployed to https://noted-ph.pages.dev; latest release https://5694833c.noted-ph.pages.dev, bundle `/assets/index-D1Vx7EXs.js`. Live verification confirms the production Supabase project and the recovery/cooldown changes are present. |
| Deepgram secret | `DEEPGRAM_API_KEY` is present in production server secrets. Its value was never printed or included in the client. |
| Real recognition | A deployed operator-only diagnostic using the existing Deepgram adapter received HTTP 200 from Deepgram for its public English `spacewalk.wav` demo: Nova-3, `general-nova-3:2026-10-16.1`, diarizer v2, 25.933313 seconds, 62 recognized words, detected language `en`. The temporary diagnostic function was deleted after the test. This verifies real provider access; it does **not** verify a signed-in Noted user's complete recording/upload workflow. |
| Tagalog / Taglish / difficult audio | Not measured. No consented recordings with human-verified references were supplied. No WER, CER, missing-word, incorrect-word, speaker, noise, quiet-speech, fast-speech or long-recording accuracy score is claimed. |
| Central `/admin` | Implemented and deployed with server-checked membership and MFA before aggregate dashboard data/API access. `/admin/transcription` is now a protected child page. |
| Personal Super Admin | The explicitly confirmed email was checked against production Auth. No account initially existed, so one verification invitation was sent under the user's authorization. The email was subsequently verified and exactly that account was provisioned through the trusted server-side RPC. A later lookup confirms exactly one matching account. No existing password was changed. |
| Owner access / MFA | **Enrollment pending user completion.** An actual one-time email link was tested in a fresh isolated browser against the live website: successful callback → `/admin` → the secure administrator MFA screen and **Set up authenticator** button. The test stopped before enrollment; no authenticator or AAL2 session was fabricated. Only that test session was revoked afterward. No successful administrator data read is claimed. |
| Registered users / database / storage | Live Auth account aggregates, `pg_database_size` and Storage metadata aggregates are available behind the server administrator guard. Storage metadata bytes are not a complete provider billing measurement. |
| Active users / guests / platforms | Implemented as observed opt-in activity: daily, weekly, monthly active users; daily guest-session estimates; Web, Windows, macOS and Android device-day counts. Operational reporting is OFF by default. Counts omit clients that decline reporting or cannot connect; guest counts are session estimates, not unique people. |
| Supabase billing MAU / bandwidth | **Unavailable:** no authorized billing usage feed configured. App-observed MAU is labeled separately and is not substituted for billing MAU. |
| Cloudflare usage | A real authorized local Wrangler API capture recorded 8 all-time Pages deployments. Request/error analytics remain unavailable without a suitable configured analytics source. Server refresh requires scoped credentials; missing credentials return 503 and preserve the previous snapshot. |
| Transcription usage / costs | Aggregates come from the existing production transcription event ledger. No pricing rate was supplied; unpriced calls remain unknown. Estimates are not provider invoices, and failed requests can incur unreported charges. The public diagnostic request was not inserted into the application event ledger. |
| Errors / sync / security / warnings | Bounded opt-in operational categories, sync-failure counts, trusted administrator audit events and aggregate Auth audit actions are implemented. Capacity limits and warning percentages are configurable through a protected RPC. Unknown or stale metrics are not shown as healthy zero usage. |
| Real authenticated security tests | Anonymous production RPC/Edge access was rejected. A real confirmed-owner AAL1 session was verified against Auth; `admin_access` recognized membership but required MFA, and `central_admin_snapshot` denied access. Reusing the one-time token was rejected. Database role/AAL/factor/revocation and Edge contract tests passed. A separate live ordinary-user session and a live owner AAL2 test remain pending; no unrelated user was impersonated. |

### Sign-in defects fixed

The hosted Auth Site URL still pointed to the missing Vercel deployment shown in the user's screenshot. It now points to `https://noted-ph.pages.dev`, with Cloudflare callback URLs added to the redirect allowlist. Only these two Auth configuration fields changed; existing provider/security settings and legacy redirect entries were retained. A follow-up remote diff confirmed no pending changes to the declared fields.

The PKCE-configured client did not accept invitation sessions delivered in URL fragments. The callback now accepts those sessions through Supabase `setSession`, clears the credential fragment, retains PKCE code exchange, and shares concurrent exchanges across React StrictMode effects. Callback errors remain generic and do not echo tokens. Logs later showed expired one-time links, so the live login form now offers **Email me a sign-in link** for existing accounts only (`shouldCreateUser: false`). It preserves `/admin` as the destination. Request and open only the newest email in the same browser; never share its link or MFA QR/code. Owner access still requires authenticator verification.

Follow-up repair after the user's further email-link failure: the normal PKCE request depended on storage in the browser that requested the email. Email requests now use a separate **non-persistent implicit-flow client**, with its own storage key and no PKCE challenge. The primary account client retains PKCE for signup/recovery. A real SDK request regression confirms `create_user: false` and a null code challenge. The existing fragment callback then verifies the returned email session. An expired email error also offers **Continue with this account** when a separate valid normal-login session already exists; this does not validate the expired link or bypass server administrator checks.

A custom token-hash confirmation template was prepared to avoid automatic token consumption on link previews. The production provider rejected its configuration with HTTP 400 `entitlement_required`: this Free/default-email-provider project cannot modify email templates without an eligible plan or custom SMTP. The template was therefore left **optional/commented**, and the live fix uses the existing default template without a plan upgrade. The frontend supports explicit token-hash confirmation if a supported template is enabled later. No claim is made that email scanners can no longer consume default provider links. Old, expired or consumed links still need replacement.

Actual provider tests used only the explicitly confirmed owner identity, checked against exactly one verified Auth record before generating temporary test links. A fresh token-hash exchange succeeded without PKCE storage, duplicate token verification failed, and the actual provider-generated fragment link succeeded through the production browser callback and reached the MFA enrollment gate. No email credential, JWT, service key or link was printed, no password was changed, no private notes were read, and cleanup revoked only each diagnostic session.

During verification, a concurrent local browser build briefly deployed a test-mode bundle. The production-configuration check detected it; it was replaced by the release above. Final live checks confirm the intended production Supabase project and a successful authenticated browser callback. Subsequent build/deployment verification was run sequentially.

### Password recovery delivery limit — follow-up

The user's reset-email screenshot corresponded to real production Auth HTTP 429 email-rate-limit entries at 23:43:36 and 23:43:39 Asia/Shanghai on November 14. The old generic text incorrectly implied that one minute would always resolve this. Supabase documents a shared limit of two messages per hour for its built-in email sender; sign-in, recovery and other Auth emails share that allowance. The error now explains that email delivery is temporarily limited and a one-minute wait may be insufficient. A timestamp-only local convenience cooldown prevents repeated sign-in/reset requests, survives reloads and is shared between pages/tabs. Its countdown is explicitly **not** a promise that the provider's quota has reset, and it never auto-retries requests. Server rate limits remain authoritative.

Already signed-in users can choose a password directly from `/forgot-password` or Settings → Change password → `/reset-password`, without another email. The password form still requires a valid Supabase session, and only the user submits their chosen password to Auth. Signed-out recovery requests use the isolated non-persistent email client to avoid binding the reset link to the originating browser's PKCE storage. Existing signup PKCE, administrator roles and MFA guards were preserved.

The user confirmed that no custom SMTP is configured and their prior session is now expired. They chose personal Gmail as the SMTP sender. **Gmail SMTP is not configured or verified yet**: this requires their own sender address and Google App Password, entered privately in Supabase Auth SMTP settings. No mail credential exists in the project environment files, no password was guessed/set by the agent, no email quota was bypassed, and no successful reset-email delivery or completed password change is claimed. Expected Gmail setup is `smtp.gmail.com`, port `587` (STARTTLS), the full sender Gmail address as username/from-address, and a Google App Password after enabling Google 2-Step Verification. See [Google App Passwords](https://support.google.com/accounts/answer/185833), [Google SMTP settings](https://developers.google.com/workspace/gmail/imap/imap-smtp), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

The current production recovery UI was browser-tested with an explicitly intercepted/simulated HTTP 429 (not a new live email request): correct error, disabled repeated-send button, cooldown surviving reload, exactly one intercepted request, zero real recovery emails sent. The initial diagnostic used a deliberately invalid Gmail-format fixture and did not submit a request; rerunning with a valid test-only address passed. Live server logs, rather than this simulated response, establish the actual provider limit. Real Gmail delivery, a fresh recovery email, and the user's password submission remain pending secure SMTP configuration.

After the user reported saving Gmail SMTP, exactly one real production password-recovery request was made for the explicitly confirmed account, after a read-only Auth lookup again confirmed exactly one verified active match. The public-client recovery request returned **HTTP 500**, not success. Sanitized production Auth logs at **23:56:57 Asia/Shanghai, November 14, 2026** classified the cause as **SMTP authentication failed**. Gmail delivery is therefore still **not operational**: the sender SMTP username/App Password pairing must be corrected privately in Supabase, then one fresh request can be tested. The SMTP credential was not read or printed, no reset link/session token was exposed, no password was changed and no duplicate account was created. The earlier statement that SMTP was unconfigured describes the state before this user configuration attempt; the present blocker is SMTP authentication rejection.

The subsequent SMTP screenshot showed matching sender/username, Gmail host and port 587; its masked password cannot establish which Google account generated the App Password or whether it is valid. One further authorized recovery request still returned HTTP 500. The production Auth log at **00:00:00 Asia/Shanghai, November 15, 2026** again confirmed **SMTP authentication failed**. No reset email delivery is claimed. The next required correction is a Google App Password generated in the exact sender Gmail account shown in Supabase, then saved privately there. The personal-mail-provider advisory in the SMTP UI is separate from this authentication rejection.

### Temporary sender fallback — November 15, 2026

The user reported that Google also blocked adding verification/recovery methods to the new sender account. The configured Gmail SMTP had repeatedly rejected authentication, including a further explicitly requested resend at 00:10:56 local time. To restore the authorized owner recovery flow, the operator reviewed a minimal hosted configuration diff and changed **only** `auth.email.smtp.enabled` from true to false. All 18 undeclared remote properties, including stored Gmail fields, canonical redirects, email confirmation and MFA settings, were left unchanged; no SMTP secret was read or replaced. Custom SMTP is now temporarily disabled and the built-in Supabase sender is active.

Exactly one new recovery-email request for the confirmed owner at **00:16:57 Asia/Shanghai, November 15, 2026** returned **HTTP 200, no Auth error**. This establishes that Supabase accepted the real recovery request; recipient Inbox/Spam delivery, successful link use and the user's chosen password submission still require user confirmation. No additional diagnostic link was generated afterward, to avoid replacing the requested email token. No password/account/role/note was changed.

The user subsequently explicitly confirmed **“Na-update ko na ang password.”** The requested email recovery and user-completed password reset are therefore confirmed successful. The password was chosen and submitted by the user; the agent never received, read or set it. Follow-up remote configuration diff reports no pending declared changes. Administrator MFA enrollment and the subsequent protected dashboard read remain a separate verification step.

The built-in sender remains limited and is not a complete production email solution for arbitrary users. A verified custom SMTP sender is still needed for wider delivery and capacity. Gmail SMTP remains unresolved and disabled until the user can complete Google verification and supply a valid App Password privately.

### Deployment and security changes

- Applied only the new backward-compatible migration `20261114150017_central_admin.sql`; existing `20261114143032_transcription.sql` was not duplicated. No database reset, note deletion, account replacement or native installer change was performed.
- Deployed `app-events` and `admin-providers`; preserved the existing authenticated `transcribe` function. Function platform JWT verification is enabled for administrator/provider and transcription endpoints. The bounded opt-in guest reporting endpoint allows unauthenticated guest reports, validates signed-in identities itself, HMACs identifiers and enforces server budgets.
- Private administrator/operational tables have RLS and no anonymous/authenticated table grants. Service-only owner nomination/provisioning cannot be called by ordinary users. Authorization requires trusted private membership, a confirmed active Auth account, a real verified MFA factor and AAL2. User-editable metadata grants no administrator privileges.
- Dashboard queries return aggregates and sanitized audit fields; no private notes, recordings, transcript text, raw error messages, URLs, raw IPs or email lists are included. Operational data is bounded and retained for 90 days.
- Exact allowed origins include the production website and Tauri native origins. Native application sources and Windows/macOS/Android installers were not rebuilt or tested on those operating systems. Desktop-mode frontend compilation passed.
- Hosted security advisors reported no error-level findings. Deny-all private table RLS and explicitly callable, internally guarded security-definer RPC notices were reviewed. The existing disabled leaked-password-protection warning was not silently changed.

### Verification results

| Check | Result |
| --- | --- |
| Latest complete Vitest suite | **198 passed**, 27 files |
| TypeScript / ESLint | Passed after the latest login changes |
| Full Playwright desktop + mobile regression | **51 passed, 5 skipped** before the final email sign-in addition; four skips require a dedicated Supabase test environment, one concerns a mobile keyboard shortcut |
| Latest administrator-route / Guest Mode browser regression | **23 passed, 1 skipped**, desktop and mobile, after the recovery changes; skip is the mobile keyboard shortcut |
| Deno Edge tests | **4 passed, 5 substeps**; provider errors, invalid auth, low assurance, ordinary users, idempotency and telemetry privacy covered using test doubles |
| Production / offline / desktop-mode builds | Passed; existing large-JavaScript-chunk warning remains |
| Production anonymous access probes | Protected administrator statistics, owner nomination/provisioning, administrator-provider and transcription requests returned 401 |
| Accuracy evaluator | **NOT VERIFIED** because the reference manifest is empty |

### Remaining external requirements

1. Securely configure the user's selected Gmail SMTP sender, then verify actual recovery-email delivery after any remaining applicable rate limit. The user reports their prior session expired. Have the user set their own password via a fresh recovery email, then finish owner authenticator enrollment at `/admin`. Confirm live owner AAL2 data access and run a separate authorized ordinary-user session test without reading that user's data. Expired/consumed links cannot be restored.
2. Run an actual signed-in Noted recording/upload after consent. Supply consented human-verified recordings for every condition listed in `tests/fixtures/transcription/manifest.json`. Store their audio/reference/result paths and consent/verification metadata in the manifest; run `npm run test:transcription:accuracy`. The evaluator reports WER/CER and edit counts only for real supplied hypotheses and references. Never commit private recordings or transcripts.
3. Configure the account's actual `TRANSCRIPTION_USD_PER_MINUTE` server rate if cost estimates are desired; verify it against the provider contract. No rate has been guessed.
4. For periodic Cloudflare API refresh, securely configure `CLOUDFLARE_ANALYTICS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optionally `CLOUDFLARE_PAGES_PROJECT` / `CLOUDFLARE_WORKER_SCRIPT` as server secrets with the required read permissions. Worker analytics require an actual Worker source; a static Pages deployment is not automatically a Worker traffic feed. Do not send tokens in chat or embed them in the frontend.
5. Connect an authorized Supabase billing MAU/bandwidth source. The service-only `record_provider_metric` ingestion RPC exists, but no recurring billing connector is configured. These panels deliberately remain unavailable until an actual source is integrated.

Principal new sources: `src/features/admin/`, `src/features/auth/authCallback.ts`, `supabase/functions/{app-events,admin-providers}/`, `supabase/migrations/20261114150017_central_admin.sql`, `scripts/admin-operator.mjs`, and `scripts/capture-cloudflare-metrics.mjs`. The operator utility requires the explicitly confirmed email twice and never emits provider/service credentials. The new email login button is in `src/features/auth/pages.tsx`.

## Historical initial implementation report

## Current state and selection

The checkout originally supported MediaRecorder recording and browser SpeechRecognition live dictation. It did not contain a saved-audio STT provider, multilingual transcription service, or an administrator dashboard to extend. Those recording/dictation functions and existing account authentication remain intact. This change adds the saved-audio workflow and an aggregate-only administrator page at `/admin/transcription`.

Provider: **Deepgram**, model **Nova-3**, language **multi**, with **Tagalog (`tl`) and English (`en`) hints**. Batch diarization explicitly uses **v2** via `diarize_model=v2`, not the deprecated `diarize` option. `DEEPGRAM_VERSION` can pin a tested model build; actual returned versions are retained in results and monitoring. Without a pin, Nova-3 resolves to the provider's current build. Re-evaluate after model updates.

This is a capability-based initial selection, **not a demonstrated Taglish accuracy winner**. No human-verified audio/reference corpus was present, and no paid recognition benchmark was run. No accuracy, WER, CER, omission rate, hallucination rate, or Filipino speaker-accuracy result is claimed. The aspirational clear-audio target is WER ≤ 0.05 (95% word accuracy); it is **not yet verified**.

Official documentation checked on November 14, 2026:

| Candidate | Findings and decision |
| --- | --- |
| [Deepgram Nova-3 languages](https://developers.deepgram.com/docs/models-languages-overview) and [code-switching / language hints](https://developers.deepgram.com/docs/nova-3-language-prompting) | Documents Tagalog and English in the same multilingual model, including mid-sentence switching. Current documented production model; selected for capability coverage. Documentation is not a Noted benchmark. |
| [Deepgram batch diarization](https://developers.deepgram.com/docs/diarization) | v2 supports Nova batch models and available languages, with word times and speaker scores. Filipino reliability and overlap accuracy are not locally verified. |
| [OpenAI GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) and [workflow guide](https://developers.openai.com/api/docs/guides/transcription) | Current recommended file model, with language/keyword hints, $0.0045/min ($0.27/hour before retries). The current workflow guide assigns speaker labels and word timestamps to deprecated compatibility models, so this integration does not assume GPT-Transcribe supplies them. A future challenger for reference testing. |
| [OpenAI older transcription models](https://developers.openai.com/api/docs/guides/speech-to-text) | Current docs mark Whisper-1 and GPT-4o transcription/diarization models deprecated, shutdown February 26, 2027. Not selected as a new long-term default. |
| [AssemblyAI language coverage](https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages) | Tagalog is documented under Universal-2; its listed provider accuracy tier is not a Noted or Taglish benchmark. Newer model language/feature coverage is not assumed equivalent. Not selected without comparative recordings. |

## Implemented behavior

- Voice → **Transcribe recorded audio** accepts an uploaded file or the microphone recording. Strict Verbatim is the default. Browser live dictation remains separate and is not routed through this accuracy pipeline.
- Strict output preserves recognized word tokens, repetitions, slang, fragments, and particles without a rewrite/translation stage. Clean output uses provider punctuation/capitalization on those tokens; it does not remove fillers, paraphrase, normalize numbers, or correct grammar. Strict word tokens can be lowercase because the provider separates lexical tokens from punctuation/capitalization.
- Optional literal vocabulary, 30 terms of up to 80 characters, and language hints are sent as provider hints. They are never appended to transcript text by Noted. [Keyterm prompting](https://developers.deepgram.com/docs/keyterm) is a recognition bias, so users must still review against the audio.
- Source audio is retained unchanged on the device. Browser decoding creates a separate mono 16 kHz PCM buffer. Forty-second cores have up to two seconds of context on each side. Server independently validates WAV signature, format, length, duration, and request bounds.
- All audio reaches STT, including quiet portions. Half-second energy checks only suggest possible missing speech or noise; they are **not a validated VAD** and never remove audio. Aggressive noise suppression/gating is intentionally absent until reference testing demonstrates a benefit. Mixing stereo to mono may reduce overlapping-speaker fidelity.
- Provider word confidence below 0.75, missing/uncertain speakers, uncovered activity candidates, repeated-phrase anomalies, missing diarization metadata, and chunk-seam disagreement are visible review flags. Thresholds are heuristics, not calibrated accuracy percentages.
- At most **three suspect chunks** receive one extra pass, using original audio without vocabulary/language hints. Optional review-only peak normalization caps gain at +6 dB with headroom. The editor shows disagreements and alternate whole-chunk text, never automatically replacing primary words for fluency. Normalization is not claimed to improve recognition without a benchmark.
- Primary requests allow **two known-failure attempts per chunk**, resumed explicitly. Ambiguous network failures reuse the same request ID. Server request reservations/cache prevent charging the same ID twice; changed audio/options cannot reuse an ID. Pending reservations older than two minutes become failed and can be retried within the budget. An in-flight provider call can finish after a client pauses.
- Full chunk coverage, including first and final cores, is planned deterministically. Overlap words are assigned by timestamp midpoint. Matching repeated words are never removed just because text repeats. Conflicting seam hypotheses are retained and flagged for review; timing drift can still cause boundary errors.
- Progress means successfully processed audio cores, **not word or speech accuracy**. Missing chunks get `[Unclear audio — review required]`. Partial jobs and TXT/VTT/inserted notes carry an incomplete warning. Even 100% processed coverage does not prove all speech was recognized.
- Editable timestamped segments, segment playback, current-playback highlight, speed control, review filtering, speaker-label editing, machine-text comparison, autosave, copy, TXT/VTT/JSON export, original-audio download, insertion, and creation of a separate note are implemented.
- Speaker IDs are **local to each API chunk**. Noted never silently claims that Speaker 1 in one request is the same voice in another. Users can rename labels after listening. Overlap separation, real identity detection and persistent cross-chunk speaker matching are not provided.
- Limit: **150 MB / 120 minutes**, subject to browser decoder, memory and device storage limits. Files are decoded into memory; this is not a streaming multi-hour worker. Unsupported/malformed formats fail without uploading. Do not promise two-hour decoding on low-memory phones.
- Edits, checkpoints and source audio are device-local, scoped to account and note. Resume works on that browser/device. JSON export preserves both machine text and edited text. Sign-out purges that account's local transcript/audio drafts; export important edits or insert them into a note before signing out. Drafts do not sync across devices. Cloud machine-result cache is owner-readable; audio is not stored there.

## Backend configuration

No new public provider keys are required. Never put provider/service-role secrets in a `VITE_` variable.

1. Migration `supabase/migrations/20261114143032_transcription.sql` was verified in PGlite and applied to the linked production project on November 14, 2026. The local filename matches the production migration history. For another environment, apply it through that environment's normal migration workflow.
2. Set Edge Function secrets: `DEEPGRAM_API_KEY`, `ALLOWED_ORIGIN` (the exact website origin), and optionally `DEEPGRAM_VERSION`. For multiple web/desktop origins, set the separate `TRANSCRIPTION_ALLOWED_ORIGINS` comma-separated list; do not change the existing `ai-writer` function's single-origin setting. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in hosted functions. Desktop origins must be allowed explicitly if using this service in Tauri.
3. Set `TRANSCRIPTION_USD_PER_MINUTE` to your **all-inclusive contracted rate**, including multilingual STT, batch diarization, model-improvement opt-out, and any keyterm charge. No guessed default is used: absent rate means unknown cost. One configured blended rate is used for every call; configure a conservative total if reviews/language options have different rates. These are estimates, never invoice totals.
4. Deploy with `supabase functions deploy transcribe`, keeping JWT verification enabled. The function also calls `auth.getUser()` and rejects anonymous accounts. The UI probes an authenticated status operation; it does not upload audio to check availability. Existing `ai-writer` configuration and credentials are unchanged.
5. Provision an administrator using trusted database operations:

   ```sql
   insert into private.transcription_admins(user_id)
   values ('<existing-confirmed-auth-user-uuid>') on conflict do nothing;
   ```

   Visit `/admin/transcription` while signed in as that account. Ordinary users and user-editable metadata cannot grant membership. Revoking the row takes effect on the next monitoring request. This adds a protected monitoring page; it does not claim to recreate an unspecified prior admin suite or add admin MFA.

The database grants users SELECT/DELETE only on their own `transcription_chunks`, with RLS. Inserts/updates and quota/metric RPCs are service-only. Server validates ownership of a non-trashed note before reserving API work. Quotas are atomic per account: **240 provider calls / 9,000 processed seconds per clock hour**, including overlap, reviews and failed reservations. No global project-spend cap is imposed; configure provider budget/concurrency limits for deployment scale.

The `private` schema must stay outside the Data API. Monitoring uses a checked administrator RPC and a service-only event RPC; there is no need to expose that schema. Aggregate events contain day, status, detected language combination, model/version, duration, processing time and optional estimated cost. They never contain user IDs, note IDs, vocabulary, audio, or transcript text. Counts are API attempts, not whole recordings. Failed/time-out calls may still cost money; failed cost is unknown, and a group containing unknown cost displays unknown rather than an understated total. A process crash before event logging can leave telemetry incomplete.

Audio is sent only after an explicit consent checkbox and Transcribe/Resume action. `redact_usage=true` hides hint text in provider usage records and `mip_opt_out=true` requests exclusion from model improvement. Neither is a promise of zero provider retention. Review the provider's current retention/DPA and opt-out pricing before rollout.

Delete recording & transcript removes the device job and the owner's server result cache for that note. It does not delete previously inserted note text, separately saved attachments, exports, or provider-held data. Existing attachment deletion remains available. Permanent note deletion cascades server cache and removes that note's local transcription. Cloud cache is otherwise retained until deletion/account deletion; if your privacy policy requires time-based expiry, schedule a retention job appropriate to that policy and disclose how expiry affects resume.

## Cost estimate

The [official pricing page](https://deepgram.com/pricing) currently shows Nova-3 multilingual at **$0.0058/min promotional**, **$0.0092/min regular**, speaker diarization **$0.0020/min**, and optional keyterms **$0.0013/min**. Rates can depend on processing mode, model-improvement participation and account contract; confirm batch/opt-out rates in your account before setting the estimate.

Illustrative regular-rate budget: ($0.0092 + $0.0020) × 60 = **$0.672/hour**, or **$0.750/hour** including the listed keyterm add-on, **before overlap, reviews, opt-out adjustments and hosting**. Forty-second cores add almost 10% contextual audio for long files. Three review chunks add up to 132 seconds of processing (about $0.025 at $0.0112/min); failed-call retries are additional. The app deliberately displays unknown cost until a verified contracted rate is configured. This illustration is not a quoted batch invoice price.

## Accuracy dataset and evaluation

Run `npm run test:transcription:accuracy`. The supplied manifest is empty and prints **ACCURACY NOT YET VERIFIED**, with no manufactured scores. Add consented recordings and human-verified transcripts for all categories listed in `tests/fixtures/transcription/manifest.json`: clear Tagalog, clear English, natural Taglish, Filipino accent, fast conversations, multiple speakers, noise, long recordings, technical terms and quiet speech. Include silence and interrupted speech as extra challenge sets. Keep private benchmark assets outside Git.

Each manifest recording uses:

```json
{
  "id": "taglish-clear-001",
  "language": "taglish",
  "condition": "natural-taglish",
  "consent": true,
  "referenceVerified": true,
  "audioPath": "audio/001.wav",
  "durationSeconds": 45,
  "referencePath": "references/001.txt",
  "baselineResultPath": "results/001-baseline.json",
  "upgradedResultPath": "results/001-upgraded.json",
  "speakerReferencePath": "references/001-speakers.json"
}
```

Paths are relative to the manifest. `baselineResultPath` and `speakerReferencePath` may be omitted. Record the original browser live-dictation output separately if comparing it; there is no original saved-audio engine to execute retroactively. Use the **same audio**, same reference normalization, and comparable settings for each candidate. Do not change the default based only on vendor marketing or synthetic examples.

Use the editor's **Export JSON** for upgraded results. Its `text` contains original machine segments, `editedText` contains corrections, `processedIntervals` gives successful core coverage, and `speakerSegments` contains machine speaker labels. For other implementations supply JSON with `text`, `model`, `modelVersion`, optional `processingMs`, `apiCostUsd`, `processedIntervals: [[0,40],[40,45]]` and `speakerSegments: [{"start":0,"end":5,"speaker":"a"}]`. Speaker references use that same interval-object array. The exporter records successful API processing time/cost, not a provider invoice or end-to-end queue latency; record wall time separately if comparing interactive latency.

Execute `npm run test:transcription:accuracy -- <manifest.json> <report.local.json>`. Reports separate language/condition/implementation, per-recording and micro-averaged WER/CER, deletion (omitted-word) rate, insertion rate (a **hallucination proxy**, not proof), coverage, processing time, available costs and optional permutation-invariant time-weighted speaker accuracy. NFC/lowercase/punctuation normalization preserves lexical repetitions and particles. Human listening is required to distinguish hallucination, valid alternative spelling, missing words, mistranslation and reference errors. Speaker scoring excludes overlapping reference intervals and returns unavailable above eight distinct labels; it is not DER or a full overlap benchmark. Missing measurements are null/unmeasured. Results do not include or upload reference/transcript content.

Unit tests use synthetic text, deterministic PCM and provider test doubles solely to verify implementation. They are **not actual speech-recognition benchmarks**. The browser fixture is silence and tests device/UI behavior only.

## Main source changes

- `src/features/transcription/`: audio preparation, job types/storage, quality checks/merge/export, checkpointed client workflow, editor, and monitoring page.
- `supabase/functions/transcribe/`: authenticated bounded proxy, WAV/options validation, Deepgram adapter, HTTP contract tests.
- `supabase/migrations/20261114143032_transcription.sql`: owner RLS cache, quota ledger, private administrator membership/events, restricted RPCs.
- Existing Voice panel, routes, account/session cleanup, and local/cloud note deletion integrate the new feature.
- `scripts/*transcription*.mjs`, scorer type declarations, fixture manifest, unit/workflow/database/browser tests supply evaluation and regression coverage.

Verification commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npx deno check supabase/functions/transcribe/index.ts`, `npx deno test --allow-env supabase/functions/transcribe/index_test.ts`, `npx playwright test e2e/voice.spec.ts e2e/transcription.spec.ts`, and `npm run test:transcription:accuracy`. The frontend, migration and Edge Function are deployed. Real provider response/pricing validation and audio accuracy acceptance still require a Deepgram API key and reference recordings.

Observed local results, November 14, 2026:

| Check | Actual result |
| --- | --- |
| Full Vitest unit/component/database suite | **175 passed**, 19 files |
| Full Playwright browser suite, desktop + mobile Chromium | **49 passed, 5 skipped**. Four cloud cases need the dedicated Supabase test environment; the remaining skip is the mobile keyboard-shortcut case. |
| Edge Function Deno type check and HTTP contract test | Passed; **1 test with 5 steps**. Auth/provider/DB HTTP responses are test doubles, not live service validation. |
| TypeScript / ESLint | Passed |
| Production + offline build | Passed; Vite reports a JavaScript chunk above its 500 kB warning threshold. |
| Accuracy evaluator with supplied manifest | **Not yet verified**; no recordings/references, no numerical WER/CER or achieved accuracy claim |
| Hosted deployment | Production frontend, transcription migration and JWT-protected Edge Function deployed and checked. See deployment record below. |
| Live Deepgram recognition | Not run: `DEEPGRAM_API_KEY` is absent from the project's server secrets. |
| Hosted database advisors | Ran; no error-level findings. Warnings cover intentionally callable security-definer RPCs and the existing disabled leaked-password protection setting. |

Source files added: `src/features/transcription/{audio,client,quality,storage,types}.ts`, `src/features/transcription/{TranscriptPanel,TranscriptionAdmin}.tsx`, `supabase/functions/transcribe/{core,index,index_test}.ts`, and the migration above. Existing source files modified: `src/features/notes/ProductivityTools.tsx`, `src/features/auth/{AuthProvider.tsx,sessionCleanup.ts}`, `src/data/{local/localRepository.ts,cloud/cloudRepository.ts}`, and `src/app/App.tsx`. Supporting changes: `README.md`, `package.json`, this report, evaluation/scorer scripts and declarations, fixture manifest, `tests/db/{rls,transcription}.test.ts`, `tests/unit/transcription*.test.ts`, and `e2e/transcription.spec.ts`.

## Production deployment record

At the user's explicit request, future application changes must include verification and live deployment. This preference is saved in `AGENTS.md`.

- Production site: https://noted-ph.pages.dev. Deployment: https://830260b9.noted-ph.pages.dev.
- Production HTML and JavaScript returned HTTP 200 and matched the built `/assets/index-DEkWErqy.js`; that bundle includes the new transcription UI.
- Supabase project: `bvvyiijyvtjjuqkfjzpo` (`smart-notepad`), matching the production frontend configuration.
- Production migration: `20261114143032`, `transcription`. Existing note data was preserved.
- `transcribe` Edge Function: active version 1, JWT verification enabled. Production-origin preflight returned 204 with the expected CORS origin; an unauthenticated POST returned 401.
- `TRANSCRIPTION_ALLOWED_ORIGINS` is set to the production site. `DEEPGRAM_API_KEY` is not configured, so actual AI transcription remains unavailable. No provider key, cost rate or administrator identity was invented or provisioned.
- Hosted privilege queries confirmed owner-cache RLS, denial of anonymous reads, no authenticated inserts/updates into processing tables, service-only reservation/event RPCs, and no anon/authenticated access to the private quota tables. The administrator aggregate RPC intentionally requires authenticated execution and checks private membership internally. [Advisor guidance for callable definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- The existing disabled leaked-password-protection setting was reported by the hosted advisor and was not changed during deployment. [Supabase password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
