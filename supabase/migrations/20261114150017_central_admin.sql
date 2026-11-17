-- Backward-compatible central administration. No note/audio/transcript content.
create table private.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin' check(role='super_admin'),
  created_at timestamptz not null default now(), disabled_at timestamptz
);
create unique index one_active_super_admin on private.admin_members((role)) where disabled_at is null;
create table private.owner_nomination(singleton boolean primary key default true check(singleton),email text not null,fulfilled_by uuid references auth.users(id),created_at timestamptz not null default now());
create table private.admin_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(), actor uuid,
  action text not null check(action in ('owner_provisioned','dashboard_read','threshold_changed','provider_refresh','admin_denied')),
  outcome text not null check(outcome in ('success','denied','failed')),
  target text check(target in ('owner','dashboard','capacity','providers'))
);
create table private.app_activity (
  day date not null default current_date, actor_hash text not null,
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null check(platform in ('web','windows','macos','android','linux','ios','other')),
  primary key(day,actor_hash,platform)
);
create index app_activity_user_day on private.app_activity(user_id,day);
create table private.app_events (
  day date not null default current_date,
  code text not null check(code in ('uncaught_error','unhandled_rejection','route_error','sync_failed','sync_offline','sync_conflict')),
  platform text not null check(platform in ('web','windows','macos','android','linux','ios','other')),
  count bigint not null default 0, primary key(day,code,platform)
);
create table private.telemetry_budget(day date not null,bucket text not null,count integer not null default 0,primary key(day,bucket));
create table private.admin_thresholds (
  metric text primary key check(metric in ('database_bytes','storage_bytes','supabase_mau','supabase_bandwidth_bytes','cloudflare_requests','transcription_cost_usd','app_errors','sync_failures')),
  limit_value numeric not null check(limit_value>0), warning_percent integer not null default 80 check(warning_percent between 1 and 100),
  updated_at timestamptz not null default now()
);
create table private.provider_metrics (
  metric text primary key check(metric in ('supabase_mau','supabase_bandwidth_bytes','cloudflare_requests','cloudflare_errors','cloudflare_deployments')),
  value numeric check(value>=0), source text not null,
  period_start timestamptz, period_end timestamptz,
  measured_at timestamptz not null default now(),
  status text not null check(status in ('available','unavailable','error')), detail text not null
);
insert into private.provider_metrics(metric,value,source,status,detail) values
 ('supabase_mau',null,'Supabase billing usage','unavailable','No authorized billing usage feed configured. App MAU is a different measurement.'),
 ('supabase_bandwidth_bytes',null,'Supabase billing usage','unavailable','No authorized billing bandwidth feed configured.'),
 ('cloudflare_requests',null,'Cloudflare Analytics API','unavailable','Configure a scoped server-side Analytics read token.'),
 ('cloudflare_errors',null,'Cloudflare Analytics API','unavailable','Configure a scoped server-side Analytics read token.'),
 ('cloudflare_deployments',null,'Cloudflare Pages API','unavailable','Configure a scoped server-side Pages read token.');
do $$ declare t text; begin
 foreach t in array array['admin_members','owner_nomination','admin_audit','app_activity','app_events','telemetry_budget','admin_thresholds','provider_metrics'] loop
   execute format('alter table private.%I enable row level security',t);
   execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end; $$;

create function private.admin_mfa_verified() returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and coalesce((select auth.jwt())->>'aal','aal1')='aal2'
 and exists(select 1 from auth.mfa_factors where user_id=(select auth.uid()) and status='verified')
 and exists(select 1 from auth.users where id=(select auth.uid()) and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now()))
 ;
$$;
revoke all on function private.admin_mfa_verified() from public,anon,authenticated;
create function private.admin_authorized() returns boolean language sql stable security definer set search_path='' as $$
 select private.admin_mfa_verified() and exists(select 1 from private.admin_members where user_id=(select auth.uid()) and disabled_at is null);
$$;
revoke all on function private.admin_authorized() from public,anon,authenticated;
create function public.admin_access(p_scope text default 'central') returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('member',exists(select 1 from private.admin_members where user_id=(select auth.uid()) and disabled_at is null)
   or (p_scope='transcription' and exists(select 1 from private.transcription_admins where user_id=(select auth.uid()))),
   'authorized',private.admin_authorized() or (p_scope='transcription' and private.admin_mfa_verified() and exists(select 1 from private.transcription_admins where user_id=(select auth.uid()))),'mfa_required',true,
   'owner_setup_available',exists(select 1 from private.owner_nomination n join auth.users u on lower(btrim(u.email))=n.email where u.id=(select auth.uid()) and u.email_confirmed_at is not null and u.deleted_at is null and (n.fulfilled_by is null or n.fulfilled_by=u.id)));
$$;
revoke all on function public.admin_access(text) from public,anon;
grant execute on function public.admin_access(text) to authenticated;

-- Operator/service-only provisioning. No email guessing, passwords, signup, or self-promotion.
create function public.provision_owner_admin(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(77002341);
  if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and not coalesce(is_anonymous,false) and deleted_at is null and (banned_until is null or banned_until<now())) then
    raise exception 'confirmed active Auth account required' using errcode='42501';
  end if;
  if exists(select 1 from private.admin_members where disabled_at is null and user_id<>p_user) then
    raise exception 'owner already provisioned' using errcode='42501';
  end if;
  insert into private.admin_members(user_id) values(p_user) on conflict(user_id) do nothing;
  insert into private.admin_audit(actor,action,outcome,target) values(null,'owner_provisioned','success','owner');
end; $$;
revoke all on function public.provision_owner_admin(uuid) from public,anon,authenticated;
grant execute on function public.provision_owner_admin(uuid) to service_role;

create function public.nominate_owner_email(p_email text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(77002341);
 if lower(btrim(p_email)) !~ '^[a-z0-9][a-z0-9.+]*@gmail\.com$' then raise exception 'invalid owner email'; end if;
 if exists(select 1 from private.owner_nomination where email<>lower(btrim(p_email))) or exists(select 1 from private.admin_members m join auth.users u on u.id=m.user_id where m.disabled_at is null and lower(btrim(u.email))<>lower(btrim(p_email))) then raise exception 'owner already nominated'; end if;
 insert into private.owner_nomination(email) values(lower(btrim(p_email))) on conflict(singleton) do nothing;
end; $$;
revoke all on function public.nominate_owner_email(text) from public,anon,authenticated;
grant execute on function public.nominate_owner_email(text) to service_role;
create function public.complete_owner_setup() returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not exists(select 1 from private.owner_nomination n join auth.users u on n.email=lower(btrim(u.email)) where u.id=(select auth.uid()) and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null and (n.fulfilled_by is null or n.fulfilled_by=u.id)) then raise exception 'verified nominated owner required' using errcode='42501'; end if;
 perform public.provision_owner_admin((select auth.uid()));
 update private.owner_nomination set fulfilled_by=(select auth.uid()) where singleton;
end; $$;
revoke all on function public.complete_owner_setup() from public,anon;
grant execute on function public.complete_owner_setup() to authenticated;

-- Harden existing endpoint in place; do not recreate transcription tables/history.
create or replace function public.transcription_admin_stats() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not (private.admin_authorized() or (private.admin_mfa_verified() and exists(select 1 from private.transcription_admins where user_id=(select auth.uid())))) then raise exception 'administrator MFA required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from (
    select date_trunc('day',created_at)::date as day,model,model_version,language,
      count(*) filter(where status='complete') as successes,count(*) filter(where status='failed') as failures,
      round(avg(processing_ms)) as average_processing_ms,sum(duration_seconds) as audio_seconds,
      case when count(estimated_cost_usd)=count(*) then sum(estimated_cost_usd) else null end as estimated_cost_usd
    from private.transcription_events where created_at>=now()-interval '90 days' group by 1,2,3,4 order by 1 desc
  ) t),'[]'::jsonb);
end; $$;

create function public.record_app_event(p_user uuid,p_actor text,p_network text,p_platform text,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
  if p_actor !~ '^[a-f0-9]{64}$' or p_network !~ '^[a-f0-9]{64}$' or p_platform not in ('web','windows','macos','android','linux','ios','other')
     or p_code not in ('activity','uncaught_error','unhandled_rejection','route_error','sync_failed','sync_offline','sync_conflict') then raise exception 'invalid telemetry'; end if;
  -- Global + per-network budgets; each is atomic. No raw IP, UA, URL, or content retained.
  insert into private.telemetry_budget(day,bucket,count) values(current_date,'global',1)
    on conflict(day,bucket) do update set count=private.telemetry_budget.count+1 where private.telemetry_budget.count<50000 returning count into used;
  if used is null then return false; end if;
  insert into private.telemetry_budget(day,bucket,count) values(current_date,p_network,1)
    on conflict(day,bucket) do update set count=private.telemetry_budget.count+1 where private.telemetry_budget.count<500 returning count into used;
  if used is null then return false; end if;
  if p_code='activity' then
    insert into private.app_activity(day,actor_hash,user_id,platform) values(current_date,p_actor,p_user,p_platform) on conflict do nothing;
  else
    insert into private.app_events(day,code,platform,count) values(current_date,p_code,p_platform,1)
      on conflict(day,code,platform) do update set count=private.app_events.count+1;
  end if;
  delete from private.telemetry_budget where day<current_date-2;
  delete from private.app_activity where day<current_date-90;
  delete from private.app_events where day<current_date-90;
  return true;
end; $$;
revoke all on function public.record_app_event(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_app_event(uuid,text,text,text,text) to service_role;

create function public.set_capacity_warning(p_metric text,p_limit numeric,p_percent integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode='42501'; end if;
  if p_limit is null or p_limit::text in ('NaN','Infinity','-Infinity') or p_limit<=0 or p_limit>1000000000000000000 then raise exception 'invalid capacity limit'; end if;
  insert into private.admin_thresholds(metric,limit_value,warning_percent) values(p_metric,p_limit,p_percent)
   on conflict(metric) do update set limit_value=excluded.limit_value,warning_percent=excluded.warning_percent,updated_at=now();
  insert into private.admin_audit(actor,action,outcome,target) values((select auth.uid()),'threshold_changed','success','capacity');
end; $$;
revoke all on function public.set_capacity_warning(text,numeric,integer) from public,anon;
grant execute on function public.set_capacity_warning(text,numeric,integer) to authenticated;

create function public.record_provider_metric(p_metric text,p_value numeric,p_source text,p_status text,p_detail text,p_start timestamptz,p_end timestamptz) returns void
language sql security definer set search_path='' as $$
 insert into private.provider_metrics(metric,value,source,status,detail,period_start,period_end) values(p_metric,p_value,left(p_source,120),p_status,left(p_detail,240),p_start,p_end)
 on conflict(metric) do update set value=excluded.value,source=excluded.source,status=excluded.status,detail=excluded.detail,period_start=excluded.period_start,period_end=excluded.period_end,measured_at=now();
$$;
revoke all on function public.record_provider_metric(text,numeric,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.record_provider_metric(text,numeric,text,text,text,timestamptz,timestamptz) to service_role;

create function public.central_admin_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode='42501'; end if;
 select jsonb_build_object(
  'generated_at',now(),'collection_started_at',(select min(day) from private.app_activity),
  'registered_users',(select count(*) from auth.users where not coalesce(is_anonymous,false) and deleted_at is null),
  'confirmed_users',(select count(*) from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and deleted_at is null),
  'dau',(select count(distinct user_id) from private.app_activity where day=current_date),
  'wau',(select count(distinct user_id) from private.app_activity where day>=current_date-6),
  'mau',(select count(distinct user_id) from private.app_activity where day>=current_date-29),
  'guest_sessions_today',(select count(distinct actor_hash) from private.app_activity where day=current_date and user_id is null),
  'database_bytes',pg_database_size(current_database()),
  'storage_bytes',(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end),0) from storage.objects),
  'platforms',coalesce((select jsonb_agg(row_to_json(t)) from (select platform,count(*) as active_device_days,count(distinct user_id) as registered_users from private.app_activity where day>=current_date-29 group by platform) t),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(row_to_json(t)) from (select day,count(distinct user_id) as users,count(distinct actor_hash) filter(where user_id is null) as guests from private.app_activity where day>=current_date-29 group by day order by day) t),'[]'::jsonb),
  'errors',coalesce((select jsonb_agg(row_to_json(t)) from (select day,code,platform,count from private.app_events where day>=current_date-29 order by day desc limit 200) t),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(row_to_json(t)) from (select created_at,action,outcome,target from private.admin_audit order by id desc limit 100) t),'[]'::jsonb),
  'auth_audit',coalesce((select jsonb_agg(row_to_json(t)) from (select date_trunc('day',created_at)::date as day,left(payload->>'action',80) as action,count(*) as count from auth.audit_log_entries where created_at>now()-interval '30 days' group by 1,2 order by 1 desc limit 100) t),'[]'::jsonb),
  'thresholds',coalesce((select jsonb_agg(to_jsonb(t)) from private.admin_thresholds t),'[]'::jsonb),
  'provider_metrics',coalesce((select jsonb_agg(to_jsonb(t)) from private.provider_metrics t),'[]'::jsonb),
  'transcription',public.transcription_admin_stats()
 ) into result;
 insert into private.admin_audit(actor,action,outcome,target) values((select auth.uid()),'dashboard_read','success','dashboard');
 return result;
end; $$;
revoke all on function public.central_admin_snapshot() from public,anon;
grant execute on function public.central_admin_snapshot() to authenticated;

create function public.authorize_admin_refresh() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.admin_authorized() then raise exception 'administrator MFA required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(77002342);
 if exists(select 1 from private.admin_audit where action='provider_refresh' and created_at>now()-interval '1 minute') then return false; end if;
 insert into private.admin_audit(actor,action,outcome,target) values((select auth.uid()),'provider_refresh','success','providers');
 return true;
end; $$;
revoke all on function public.authorize_admin_refresh() from public,anon;
grant execute on function public.authorize_admin_refresh() to authenticated;
