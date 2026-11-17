# Noted administration

The production workspace lives at [Noted Admin](https://noted-ph.pages.dev/admin). Sign in with the provisioned owner account and complete TOTP verification. The existing transcription-only role can open `/admin/transcription`.

## Routes

| Area | URLs |
| --- | --- |
| Overview | `/admin`, `/admin/users`, `/admin/user-analytics`, `/admin/platform-analytics` |
| Infrastructure | `/admin/supabase`, `/admin/cloudflare`, `/admin/health`, `/admin/storage` |
| AI services | `/admin/transcription`, `/admin/ai-usage` |
| Management | `/admin/announcements`, `/admin/security`, `/admin/releases`, `/admin/settings`, `/admin/notifications` |

## Source files

| Files | Changes |
| --- | --- |
| `src/features/admin/` and `src/app/App.tsx` | Lazy routes, responsive navigation, charts, account directory, provider views, alerts, capacity settings and announcement management |
| `src/features/transcription/TranscriptionAdmin.tsx` | Request, language, model, processing time and estimated cost reporting |
| `src/features/notes/Workspace.tsx` and `WorkspaceAnnouncements.tsx` | Version- and platform-targeted announcements. The editor owns its open draft while initial queries load. |
| `src/features/download/releases.ts` and `scripts/offline-build.mjs` | Published installer metadata and production build metadata |
| `package.json` and `package-lock.json` | Recharts |
| `supabase/config.toml` and `supabase/functions/admin-providers/` | Provider and health checks, owner MFA validation, scheduled secret authentication and rate limits |
| `scripts/configure-admin-monitoring.ps1` and `scripts/publish-pages-observation.ps1` | Provision the dedicated scheduled probe secret and verify a Pages deployment |
| `tests/db/premiumAdmin.test.ts`, `e2e/adminWorkspace.spec.ts` and `playwright.config.ts` | Database and isolated browser coverage |

## Database and authorization

The additive migrations are `20261114162709_premium_admin.sql`, `20261114170145_admin_probe_transport.sql`, `20261114170918_admin_probe_timeout.sql` and `20261114171358_retire_unused_admin_pg_net.sql`. They add private aggregate, measurement, announcements and alert tables with RLS and restricted grants. The read-only account directory exposes operational account fields. Announcement changes use optimistic concurrency, rate limiting, confirmation for publishing or unpublishing, and an audit trail.

The note-write triggers count eligible changes without retaining note IDs or content in reports. The public announcement RPC exposes eligible published text within its schedule. The other reporting RPCs validate owner membership and MFA, while transcription preserves its scoped role. Scheduled requests authenticate with a dedicated server-side secret.

## Operations

The database and provider jobs run every 15 minutes. Adjust alert thresholds in Admin Settings. The storage bars use configured thresholds when set. Their initial limits came from the verified Supabase Free plan. File storage usage represents the Noted project’s contribution to its organization allowance. Refresh the verified limits if the organization changes plans. [Supabase pricing](https://supabase.com/pricing)

Cloudflare static traffic needs a scoped zone token, zone and hostname. Worker telemetry needs a scoped account token and measured Worker. The production deployment status is verified through Cloudflare’s Pages API after upload. Optional Supabase API usage requires a scoped management token. Billed MAU, bandwidth and Realtime billing totals rely on authorized provider readings. [Cloudflare Pages API](https://developers.cloudflare.com/pages/configuration/api/) · [Supabase Management API](https://supabase.com/docs/reference/api/v1-get-project-usage-api-count)

The Deepgram probe checks credential acceptance for its auth endpoint. A rejected check may reflect the key’s permissions. Confirm speech processing separately with a consented audio sample in an authorized session. Estimated transcription spend requires an operator-verified `TRANSCRIPTION_USD_PER_MINUTE`. Older app builds continue to use existing APIs. The announcement feed is bundled into new client builds.

## Deployment and rollback

Run `npm run deploy` for production Cloudflare Pages. With the linked Supabase project and Wrangler authenticated, run `pwsh -NoProfile -File scripts/publish-pages-observation.ps1` to verify the live build and record deployment status.

The pre-redesign production Pages deployment was `5694833c-e80c-421c-b4e1-3444dfdcdfec`. To roll back the web UI, restore it from Cloudflare’s deployment list. The earlier admin endpoints remain available. If monitoring needs to be paused, unschedule `noted-admin-monitoring` and `noted-admin-provider-probe` in Supabase Cron. Keep existing user data and monitoring history in place. [Supabase Cron](https://supabase.com/docs/guides/cron)
