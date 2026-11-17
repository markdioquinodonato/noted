-- Add content-free reporting and owner workflows alongside the existing admin RPCs.
create table private.admin_note_activity (
  day date primary key,
  created bigint not null default 0,
  updated bigint not null default 0
);
create table private.admin_measurements (
  day date primary key,
  database_bytes bigint not null,
  storage_bytes numeric not null,
  measured_at timestamptz not null
);
create table private.admin_cloudflare_traffic (
  day date primary key,
  requests bigint not null check (requests >= 0),
  errors bigint not null check (errors >= 0 and errors <= requests)
);
create table private.admin_probe_budget (
  singleton boolean primary key default true check(singleton),
  requested_at timestamptz not null
);
create table private.admin_alerts (
  id bigint generated always as identity primary key,
  code text not null,
  title text not null,
  detail text not null,
  priority text not null check (priority in ('notice', 'warning', 'critical')),
  section text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index admin_alert_open_code on private.admin_alerts(code) where resolved_at is null;
create table private.admin_alert_state (
  alert_id bigint not null references private.admin_alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  dismissed_at timestamptz,
  primary key (alert_id, user_id)
);
create table private.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 2000),
  priority text not null check (priority in ('normal', 'important', 'urgent')),
  platform text not null check (platform in ('all', 'web', 'windows', 'macos', 'android')),
  min_version text check (min_version ~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$'),
  max_version text check (max_version ~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$'),
  published boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz check (ends_at > starts_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transcription_events_created_idx on private.transcription_events(created_at);
create index admin_provider_refresh_idx on private.admin_audit(created_at desc)
  where action = 'provider_refresh';

do $$ declare name text; begin
  foreach name in array array['admin_note_activity', 'admin_measurements', 'admin_cloudflare_traffic', 'admin_probe_budget', 'admin_alerts', 'admin_alert_state', 'announcements'] loop
    execute format('alter table private.%I enable row level security', name);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', name);
  end loop;
end $$;

alter table private.admin_audit drop constraint admin_audit_action_check;
alter table private.admin_audit add constraint admin_audit_action_check check (
  action in ('owner_provisioned','dashboard_read','threshold_changed','provider_refresh','admin_denied',
             'announcement_created','announcement_updated','announcement_published','announcement_unpublished')
);
alter table private.admin_audit drop constraint admin_audit_target_check;
alter table private.admin_audit add constraint admin_audit_target_check check (
  target in ('owner','dashboard','capacity','providers') or target ~ '^announcement:[a-f0-9-]{36}$'
);

alter table private.provider_metrics drop constraint provider_metrics_metric_check;
alter table private.provider_metrics add constraint provider_metrics_metric_check check (metric in (
  'supabase_mau','supabase_bandwidth_bytes','cloudflare_requests','cloudflare_errors','cloudflare_deployments',
  'cloudflare_page_requests','cloudflare_page_errors','cloudflare_bandwidth_bytes','cloudflare_production',
  'frontend_health','deepgram_health','edge_health','supabase_realtime','supabase_api_requests',
  'supabase_database_quota_bytes','supabase_storage_quota_bytes'
));

-- A statement-level trigger records totals without storing IDs or note text.
create function private.count_cloud_note_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare writes bigint;
begin
  if tg_op = 'INSERT' then
    select count(*) into writes from report_new;
    if writes > 0 then
      insert into private.admin_note_activity(day, created)
        values ((now() at time zone 'UTC')::date, writes)
        on conflict(day) do update set created = private.admin_note_activity.created + excluded.created;
    end if;
  else
    select count(*) into writes from report_new n join report_old o using (id)
    where (n.title, n.content, n.folder_id, n.is_pinned, n.is_archived, n.deleted_at)
          is distinct from (o.title, o.content, o.folder_id, o.is_pinned, o.is_archived, o.deleted_at);
    if writes > 0 then
      insert into private.admin_note_activity(day, updated)
        values ((now() at time zone 'UTC')::date, writes)
        on conflict(day) do update set updated = private.admin_note_activity.updated + excluded.updated;
    end if;
  end if;
  return null;
end $$;
revoke all on function private.count_cloud_note_writes() from public, anon, authenticated;
create trigger admin_count_note_insert after insert on public.notes
  referencing new table as report_new for each statement execute function private.count_cloud_note_writes();
create trigger admin_count_note_update after update on public.notes
  referencing old table as report_old new table as report_new for each statement execute function private.count_cloud_note_writes();

create function public.admin_workspace_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  -- The existing snapshot validates membership, MFA and the verified factor.
  return public.central_admin_snapshot() || jsonb_build_object(
    'cloud_notes', (select count(*) from public.notes where deleted_at is null),
    'storage_history', coalesce((select jsonb_agg(to_jsonb(m) order by m.day)
      from private.admin_measurements m where day >= (now() at time zone 'UTC')::date - 90), '[]'::jsonb),
    'database_connections', (select numbackends from pg_stat_database where datname = current_database()),
    'event_totals', (select jsonb_build_object(
      'app_errors', coalesce(sum(count) filter(where code in ('uncaught_error','unhandled_rejection','route_error')),0),
      'sync_failures', coalesce(sum(count) filter(where code in ('sync_failed','sync_conflict')),0))
      from private.app_events where day >= (now() at time zone 'UTC')::date - 29),
    'ai_writing', coalesce((select jsonb_agg(to_jsonb(w) order by day) from (
      select (hour at time zone 'UTC')::date as day, sum(requests) as requests from private.ai_usage
      where hour >= now() - interval '46 days' group by 1
    ) w), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_workspace_snapshot() from public, anon;
grant execute on function public.admin_workspace_snapshot() to authenticated;

create function public.admin_analytics(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date;
        from_day date;
        activity_start date;
        errors_start date;
        note_start date;
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  if p_days is null or p_days not between 1 and 45 then raise exception 'Invalid analytics window'; end if;
  from_day := today - (2 * p_days - 1);
  select min(day) into activity_start from private.app_activity;
  select min(day) into errors_start from (
    select min(day) as day from private.app_events union all select activity_start
  ) e;
  select min(day) into note_start from private.admin_measurements;
  return (
    with days as (
      select today - n as day from generate_series(0, 2 * p_days - 1) n
    ), registrations as (
      select (created_at at time zone 'UTC')::date as day, count(*) as count
      from auth.users where created_at >= (from_day::timestamp at time zone 'UTC')
        and deleted_at is null and not coalesce(is_anonymous, false)
      group by 1
    ), events as (
      select day,
        sum(count) filter (where code in ('uncaught_error','unhandled_rejection','route_error')) as errors,
        sum(count) filter (where code in ('sync_failed','sync_conflict')) as sync_failed,
        sum(count) filter (where code = 'sync_offline') as sync_offline
      from private.app_events where day >= from_day group by day
    ), active as (
      select d.day,
        count(distinct a.user_id) filter (where a.day = d.day) as dau,
        count(distinct a.user_id) filter (where a.day >= d.day - 6) as wau,
        count(distinct a.user_id) as mau,
        count(distinct a.actor_hash) filter (where a.user_id is null and a.day = d.day) as guests
      from days d left join private.app_activity a on a.day between d.day - 29 and d.day group by d.day
    )
    select jsonb_build_object(
      'days', (select jsonb_agg(row_to_json(r) order by r.day) from (
        select d.day, coalesce(reg.count, 0) as registrations,
          case when d.day >= activity_start then a.dau end as dau,
          case when d.day - 6 >= activity_start then a.wau end as wau,
          case when d.day - 29 >= activity_start then a.mau end as mau,
          case when d.day >= activity_start then a.guests end as guests,
          case when d.day >= errors_start then coalesce(e.errors, 0) end as errors,
          case when d.day >= errors_start then coalesce(e.sync_failed, 0) end as sync_failed,
          case when d.day >= errors_start then coalesce(e.sync_offline, 0) end as sync_offline,
          case when d.day >= note_start then coalesce(n.created, 0) end as notes_created,
          case when d.day >= note_start then coalesce(n.updated, 0) end as notes_updated
        from days d join active a using (day) left join registrations reg using (day)
        left join events e using (day) left join private.admin_note_activity n using (day)
      ) r),
      'platforms', coalesce((select jsonb_agg(row_to_json(p)) from (
        select case when platform in ('web','windows','macos','android') then platform else 'other' end as platform,
          count(*) as active_device_days, count(distinct user_id) as registered_users
        from private.app_activity where day between today - (p_days - 1) and today group by 1
      ) p), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.admin_analytics(integer) from public, anon;
grant execute on function public.admin_analytics(integer) to authenticated;

create function public.admin_user_directory(
  p_search text default '', p_status text default 'all', p_oldest boolean default false, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  if p_search is null or length(p_search) > 120 or p_status is null
    or p_status not in ('all','active','unverified','suspended','admin')
    or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid directory filter'; end if;
  return (
    with accounts as (
      select u.id, u.email, u.created_at, u.email_confirmed_at is not null as verified,
        case when m.user_id is not null then 'Owner'
             when ta.user_id is not null then 'Transcription admin' else 'Member' end as role,
        case when u.banned_until > now() then 'suspended'
             when u.email_confirmed_at is null then 'unverified' else 'active' end as status
      from auth.users u
      left join private.admin_members m on m.user_id = u.id and m.disabled_at is null
      left join private.transcription_admins ta on ta.user_id = u.id
      where not coalesce(u.is_anonymous, false) and u.deleted_at is null
        and strpos(lower(coalesce(u.email, '')), lower(btrim(p_search))) > 0
    ), filtered as (
      select * from accounts where p_status = 'all' or status = p_status
        or (p_status = 'admin' and role <> 'Member')
    ), page as (
      select *, row_number() over (order by case when p_oldest then created_at end,
        case when not coalesce(p_oldest, false) then created_at end desc, id) as sort_order
      from filtered order by sort_order limit 25 offset p_offset
    )
    select jsonb_build_object('total', (select count(*) from filtered), 'rows', coalesce((
      select jsonb_agg((to_jsonb(p) - 'sort_order') || jsonb_build_object('last_activity',
        (select max(day) from private.app_activity a where a.user_id = p.id)) order by p.sort_order)
      from page p
    ), '[]'::jsonb))
  );
end $$;
revoke all on function public.admin_user_directory(text,text,boolean,integer) from public, anon;
grant execute on function public.admin_user_directory(text,text,boolean,integer) to authenticated;

create function private.release_version(p_version text) returns integer[]
language sql immutable set search_path = '' as $$
  select case when p_version ~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}$'
    then string_to_array(p_version, '.')::integer[] end;
$$;

create function public.noted_announcements(p_platform text, p_version text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body,
    'priority', priority, 'starts_at', starts_at)
    order by case priority when 'urgent' then 0 when 'important' then 1 else 2 end, starts_at desc), '[]'::jsonb)
  from (select * from private.announcements
    where p_platform in ('web','windows','macos','android','other')
      and private.release_version(p_version) is not null
      and published and starts_at <= now() and (ends_at is null or ends_at > now())
      and platform in ('all', p_platform)
      and (min_version is null or private.release_version(p_version) >= private.release_version(min_version))
      and (max_version is null or private.release_version(p_version) <= private.release_version(max_version))
    order by case priority when 'urgent' then 0 when 'important' then 1 else 2 end, starts_at desc, id limit 30
  ) a
$$;
revoke all on function public.noted_announcements(text,text) from public;
grant execute on function public.noted_announcements(text,text) to anon, authenticated;

create function public.admin_announcements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from private.announcements a), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (
      select created_at, action, target from private.admin_audit where target like 'announcement:%'
      order by id desc limit 100
    ) h), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;

create function public.admin_save_announcement(p_id uuid, p_expected timestamptz, p_item jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare before_row private.announcements; row_id uuid; next_published boolean;
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  if jsonb_typeof(p_item) is distinct from 'object' or octet_length(p_item::text) > 12000 then raise exception 'Invalid announcement'; end if;
  if length(coalesce(p_item->>'min_version','')) > 0 and private.release_version(p_item->>'min_version') is null
    or length(coalesce(p_item->>'max_version','')) > 0 and private.release_version(p_item->>'max_version') is null
    or private.release_version(p_item->>'min_version') > private.release_version(p_item->>'max_version') then
    raise exception 'Invalid version range';
  end if;
  perform pg_advisory_xact_lock(77002344);
  if (select count(*) from private.admin_audit where actor = (select auth.uid())
      and target like 'announcement:%' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Announcement update limit reached';
  end if;
  if p_id is not null then
    select * into before_row from private.announcements where id = p_id for update;
    if not found or before_row.updated_at is distinct from p_expected then raise exception 'Announcement changed. Reload and retry.' using errcode = '40001'; end if;
  end if;
  next_published := coalesce((p_item->>'published')::boolean, false);
  insert into private.announcements(id, title, body, priority, platform, min_version, max_version, published, starts_at, ends_at)
    values(coalesce(p_id, gen_random_uuid()), btrim(p_item->>'title'), btrim(p_item->>'body'),
      p_item->>'priority', p_item->>'platform', nullif(p_item->>'min_version',''), nullif(p_item->>'max_version',''),
      next_published, coalesce((p_item->>'starts_at')::timestamptz, now()), (p_item->>'ends_at')::timestamptz)
    on conflict(id) do update set title = excluded.title, body = excluded.body, priority = excluded.priority,
      platform = excluded.platform, min_version = excluded.min_version, max_version = excluded.max_version,
      published = excluded.published, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
    returning id into row_id;
  insert into private.admin_audit(actor, action, outcome, target) values ((select auth.uid()),
    case when next_published and not coalesce(before_row.published,false) then 'announcement_published'
         when not next_published and before_row.published then 'announcement_unpublished'
         when p_id is null then 'announcement_created' else 'announcement_updated' end,
    'success', 'announcement:' || row_id);
  return row_id;
end $$;
revoke all on function public.admin_save_announcement(uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.admin_save_announcement(uuid,timestamptz,jsonb) to authenticated;

create function public.admin_alert_inbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'last_checked', (select max(measured_at) from private.admin_measurements),
    'items', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id desc) from (
      select a.id, a.title, a.detail, a.priority, a.section, a.created_at, a.resolved_at,
        s.read_at, s.acknowledged_at, s.dismissed_at
      from private.admin_alerts a left join private.admin_alert_state s
        on a.id = s.alert_id and s.user_id = (select auth.uid())
      order by a.created_at desc, a.id desc limit 100
    ) n), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_alert_inbox() from public, anon;
grant execute on function public.admin_alert_inbox() to authenticated;

create function public.admin_update_alert(p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('read','acknowledge','dismiss') then raise exception 'Invalid alert action'; end if;
  insert into private.admin_alert_state(alert_id, user_id, read_at, acknowledged_at, dismissed_at)
    values(p_id, (select auth.uid()), now(), case when p_action = 'acknowledge' then now() end,
      case when p_action = 'dismiss' then now() end)
    on conflict(alert_id, user_id) do update set read_at = coalesce(private.admin_alert_state.read_at, excluded.read_at),
      acknowledged_at = coalesce(private.admin_alert_state.acknowledged_at, excluded.acknowledged_at),
      dismissed_at = coalesce(private.admin_alert_state.dismissed_at, excluded.dismissed_at);
end $$;
revoke all on function public.admin_update_alert(bigint,text) from public, anon;
grant execute on function public.admin_update_alert(bigint,text) to authenticated;

create function private.record_admin_alert(
  p_code text, p_title text, p_detail text, p_priority text, p_section text, p_active boolean
) returns void language plpgsql set search_path = '' as $$
begin
  if p_active then
    -- Escalation creates a new unread incident while retaining the original.
    update private.admin_alerts set resolved_at = now()
      where code = p_code and resolved_at is null and priority <> p_priority;
    insert into private.admin_alerts(code, title, detail, priority, section)
      values(p_code, p_title, p_detail, p_priority, p_section)
      on conflict (code) where resolved_at is null do update set detail = excluded.detail;
  elsif p_active is false then
    update private.admin_alerts set resolved_at = now() where code = p_code and resolved_at is null;
  end if;
end $$;
revoke all on function private.record_admin_alert(text,text,text,text,text,boolean) from public, anon, authenticated;

create function private.sample_admin_monitoring() returns void
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date;
        db_size bigint := pg_database_size(current_database());
        disk_size numeric;
        app_errors bigint;
        sync_errors bigint;
        speech_cost numeric;
        factor_removals bigint;
        t record;
        p record;
        measurement numeric;
        ratio numeric;
begin
  if not pg_try_advisory_xact_lock(77002345) then return; end if;
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end), 0)
    into disk_size from storage.objects;
  insert into private.admin_measurements(day, database_bytes, storage_bytes, measured_at)
    values(today, db_size, disk_size, now()) on conflict(day) do update set
      database_bytes = excluded.database_bytes, storage_bytes = excluded.storage_bytes, measured_at = excluded.measured_at;
  select coalesce(sum(count) filter(where code in ('uncaught_error','unhandled_rejection','route_error')),0),
         coalesce(sum(count) filter(where code in ('sync_failed','sync_conflict')),0)
    into app_errors, sync_errors from private.app_events where day between today - 29 and today;
  select case when count(estimated_cost_usd) = count(*) filter(where status = 'complete') then sum(estimated_cost_usd) end
    into speech_cost from private.transcription_events where created_at >= ((today - 29)::timestamp at time zone 'UTC');
  for t in
    select metric, limit_value, warning_percent from private.admin_thresholds
    union all
    select q.limit_metric, quota.value, 85
    from (values ('supabase_database_quota_bytes','database_bytes'), ('supabase_storage_quota_bytes','storage_bytes'))
      q(provider_metric, limit_metric)
    join private.provider_metrics quota on quota.metric = q.provider_metric and quota.status = 'available' and quota.value > 0
    where not exists (select 1 from private.admin_thresholds a where a.metric = q.limit_metric)
  loop
    measurement := case t.metric when 'database_bytes' then db_size when 'storage_bytes' then disk_size
      when 'app_errors' then app_errors when 'sync_failures' then sync_errors
      when 'transcription_cost_usd' then speech_cost else (
        select value from private.provider_metrics where metric = t.metric and status = 'available'
          and measured_at > now() - interval '6 hours'
      ) end;
    if measurement is null then continue; end if;
    ratio := 100 * measurement / t.limit_value;
    perform private.record_admin_alert('threshold:' || t.metric, initcap(replace(t.metric, '_',' ')),
      format('%s%% of the configured monitoring limit.', round(ratio, 1)),
      case when ratio >= greatest(t.warning_percent,95) then 'critical'
           when ratio >= t.warning_percent then 'warning' else 'notice' end,
      case when t.metric like 'cloudflare_%' then '/admin/cloudflare'
           when t.metric = 'transcription_cost_usd' then '/admin/ai-usage'
           when t.metric in ('app_errors','sync_failures') then '/admin/health' else '/admin/supabase' end,
      ratio >= case when t.metric in ('database_bytes','storage_bytes') then least(t.warning_percent,70) else t.warning_percent end);
  end loop;
  for p in select metric, status, detail, measured_at from private.provider_metrics
    where metric in ('frontend_health','edge_health','deepgram_health') loop
    if p.measured_at > now() - interval '6 hours' then
      perform private.record_admin_alert('health:' || p.metric, initcap(replace(p.metric,'_',' ')),
        p.detail, 'critical', '/admin/health',
        case when p.status = 'error' then true when p.status = 'available' then false end);
    end if;
  end loop;
  select count(*) into factor_removals from auth.audit_log_entries
    where created_at > now() - interval '1 day' and payload->>'action' in ('factor_unenrolled','factor_deleted','user_unenrolled_factor')
      and coalesce(payload->>'actor_id', payload->>'user_id') in (select user_id::text from private.admin_members where disabled_at is null);
  perform private.record_admin_alert('security:mfa_removed', 'Administrator MFA factor removed',
    'The Auth audit log recorded an administrator removing an MFA factor within the last day.',
    'critical', '/admin/security', factor_removals > 0);
end $$;
revoke all on function private.sample_admin_monitoring() from public, anon, authenticated, service_role;

-- Hosted Supabase supports pg_cron. Keep the local WASM RLS harness usable.
do $$ begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('noted-admin-monitoring', '*/15 * * * *', 'select private.sample_admin_monitoring()');
  end if;
end $$;
select private.sample_admin_monitoring();

-- The scoped transcription-only role continues to see just its own reporting surface.
create or replace function public.admin_access(p_scope text default 'central') returns jsonb
language sql stable security definer set search_path = '' as $$
  with verified as (
    select private.admin_authorized() as central,
      p_scope = 'transcription' and exists(select 1 from private.transcription_admins
        where user_id = (select auth.uid())) as transcription_member
  )
  select jsonb_build_object(
    'member', exists(select 1 from private.admin_members
        where user_id = (select auth.uid()) and disabled_at is null) or transcription_member,
    'authorized', central or (transcription_member and private.admin_mfa_verified()),
    'mfa_required', true,
    'owner_setup_available', exists(select 1 from private.owner_nomination n join auth.users u
      on lower(btrim(u.email)) = n.email where u.id = (select auth.uid())
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (n.fulfilled_by is null or n.fulfilled_by = u.id))
  ) || case when p_scope = 'transcription' then jsonb_build_object('central_authorized', central)
            else '{}'::jsonb end
  from verified;
$$;

create or replace function public.transcription_admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.admin_authorized() or (private.admin_mfa_verified() and exists(
    select 1 from private.transcription_admins where user_id = (select auth.uid())
  ))) then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from (
    select (created_at at time zone 'UTC')::date as day, model, model_version, language,
      count(*) filter (where status = 'complete') as successes,
      count(*) filter (where status = 'failed') as failures,
      avg(processing_ms) as average_processing_ms, sum(duration_seconds) as audio_seconds,
      count(estimated_cost_usd) filter (where status = 'complete') as priced_successes,
      case when count(estimated_cost_usd) filter (where status = 'complete') = count(*) filter (where status = 'complete')
        then sum(estimated_cost_usd) filter (where status = 'complete') end as estimated_cost_usd
    from private.transcription_events where created_at >= now() - interval '90 days'
    group by 1, 2, 3, 4 order by 1 desc
  ) t), '[]'::jsonb);
end $$;

create function public.admin_cloudflare_history() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(h) order by day) from private.admin_cloudflare_traffic h
    where day >= (now() at time zone 'UTC')::date - 30), '[]'::jsonb);
end $$;
revoke all on function public.admin_cloudflare_history() from public, anon;
grant execute on function public.admin_cloudflare_history() to authenticated;

create function public.admin_ingest_provider_checks(p_metrics jsonb, p_traffic jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_metrics) is distinct from 'array' or jsonb_array_length(p_metrics) > 20
    or jsonb_typeof(p_traffic) is distinct from 'array' or jsonb_array_length(p_traffic) > 31 then
    raise exception 'Invalid provider measurements';
  end if;
  perform public.record_provider_metric(metric, value, source, status, detail, start_at, end_at)
    from jsonb_to_recordset(p_metrics) as m(metric text, value numeric, source text, status text, detail text,
      start_at timestamptz, end_at timestamptz);
  insert into private.admin_cloudflare_traffic(day, requests, errors)
    select day, requests, errors from jsonb_to_recordset(p_traffic) as t(day date, requests bigint, errors bigint)
    on conflict (day) do update set requests = excluded.requests, errors = excluded.errors;
  perform private.sample_admin_monitoring();
end $$;
revoke all on function public.admin_ingest_provider_checks(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.admin_ingest_provider_checks(jsonb,jsonb) to service_role;

create function public.admin_authorize_scheduled_probe() returns boolean
language plpgsql security definer set search_path = '' as $$
declare next_probe timestamptz;
begin
  insert into private.admin_probe_budget(singleton, requested_at) values(true, now())
    on conflict (singleton) do update set requested_at = excluded.requested_at
      where private.admin_probe_budget.requested_at < now() - interval '10 minutes'
    returning requested_at into next_probe;
  return next_probe is not null;
end $$;
revoke all on function public.admin_authorize_scheduled_probe() from public, anon, authenticated;
grant execute on function public.admin_authorize_scheduled_probe() to service_role;

-- The job is configured through Vault. Ordinary browser calls still require owner MFA.
create function private.enqueue_admin_provider_probe() returns void
language plpgsql security definer set search_path = '' as $$
declare job_token text; endpoint text;
begin
  select decrypted_secret into job_token from vault.decrypted_secrets where name = 'noted_admin_monitoring_job_token';
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'noted_admin_monitoring_endpoint';
  if job_token is null or endpoint is null then return; end if;
  if endpoint !~ '^https://[a-z]{20}[.]supabase[.]co/functions/v1/admin-providers$' then
    raise exception 'Invalid admin monitoring endpoint';
  end if;
  perform net.http_post(url := endpoint, headers := jsonb_build_object(
    'Content-Type', 'application/json', 'x-noted-monitoring-job', job_token
  ), timeout_milliseconds := 40000);
end $$;
revoke all on function private.enqueue_admin_provider_probe() from public, anon, authenticated, service_role;

do $$ begin
  if to_regclass('cron.job') is not null and to_regclass('vault.decrypted_secrets') is not null
    and exists(select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    -- Only the scheduled definer needs this secret-bearing networking queue.
    revoke all on schema net from public, anon, authenticated;
    revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;
    perform cron.schedule('noted-admin-provider-probe', '2,17,32,47 * * * *',
      'select private.enqueue_admin_provider_probe()');
  end if;
end $$;
