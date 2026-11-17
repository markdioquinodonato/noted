-- Audio remains on the user's device. Only owner-readable retry results are cached.
create table public.transcription_chunks (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  note_id uuid not null references public.notes(id) on delete cascade,
  digest text not null,
  status text not null default 'processing' check(status in ('processing','complete','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table public.transcription_chunks enable row level security;
revoke all on public.transcription_chunks from public,anon,authenticated;
grant select,delete on public.transcription_chunks to authenticated;
grant all on public.transcription_chunks to service_role;
create policy transcription_owner_read on public.transcription_chunks for select to authenticated
using(user_id=(select auth.uid()));
create policy transcription_owner_delete on public.transcription_chunks for delete to authenticated
using(user_id=(select auth.uid()));
create index transcription_chunks_note on public.transcription_chunks(note_id);

create table private.transcription_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour timestamptz not null,
  requests integer not null,
  seconds numeric not null,
  primary key(user_id,hour)
);
create table private.transcription_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null check(status in ('complete','failed')),
  language text not null,
  model text not null,
  model_version text not null,
  duration_seconds numeric not null,
  processing_ms integer not null,
  estimated_cost_usd numeric
);
-- Membership can only be provisioned by a database operator, never user metadata.
create table private.transcription_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
revoke all on private.transcription_quota,private.transcription_events,private.transcription_admins from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.transcription_quota,private.transcription_events,private.transcription_admins to service_role;

-- Service-only entry: caller identity and ownership are verified by the Edge Function.
-- Atomic lock serializes concurrent reservations and prevents quota races.
create function public.reserve_transcription(p_user uuid,p_note uuid,p_request uuid,p_digest text,p_seconds numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.transcription_chunks; used private.transcription_quota;
begin
  if p_seconds <= 0 or p_seconds > 45 or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid chunk';
  end if;
  if not exists(select 1 from public.notes where id=p_note and owner_id=p_user and deleted_at is null) then
    raise exception 'note not owned' using errcode='42501';
  end if;
  insert into private.transcription_quota values(p_user,date_trunc('hour',now()),0,0) on conflict do nothing;
  select * into used from private.transcription_quota where user_id=p_user and hour=date_trunc('hour',now()) for update;
  select * into prior from public.transcription_chunks where user_id=p_user and request_id=p_request;
  if found then
    if prior.digest <> p_digest or prior.note_id <> p_note then raise exception 'request collision'; end if;
    if prior.status='processing' and prior.created_at < now()-interval '120 seconds' then
      update public.transcription_chunks set status='failed' where user_id=p_user and request_id=p_request;
      return '{"status":"failed"}'::jsonb;
    end if;
    return jsonb_build_object('status',prior.status,'result',prior.result);
  end if;
  if used.requests >= 240 or used.seconds+p_seconds > 9000 then return '{"status":"quota"}'::jsonb; end if;
  update private.transcription_quota set requests=requests+1, seconds=seconds+p_seconds
  where user_id=p_user and hour=date_trunc('hour',now());
  insert into public.transcription_chunks(user_id,request_id,note_id,digest) values(p_user,p_request,p_note,p_digest);
  return '{"status":"reserved"}'::jsonb;
end; $$;
revoke all on function public.reserve_transcription(uuid,uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.reserve_transcription(uuid,uuid,uuid,text,numeric) to service_role;

-- Keep private schema outside the Data API. Only this service-only RPC writes metrics.
create function public.record_transcription_event(p_status text,p_language text,p_model text,p_version text,p_seconds numeric,p_ms integer,p_cost numeric)
returns void language sql security definer set search_path='' as $$
  insert into private.transcription_events(status,language,model,model_version,duration_seconds,processing_ms,estimated_cost_usd)
  values(p_status,p_language,p_model,p_version,p_seconds,p_ms,p_cost);
$$;
revoke all on function public.record_transcription_event(text,text,text,text,numeric,integer,numeric) from public,anon,authenticated;
grant execute on function public.record_transcription_event(text,text,text,text,numeric,integer,numeric) to service_role;

-- SECURITY DEFINER is needed solely to aggregate private events after checking
-- the non-user-editable membership table. It never returns content or user IDs.
create function public.transcription_admin_stats() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not exists(select 1 from private.transcription_admins where user_id=(select auth.uid())) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from (
    select date_trunc('day',created_at)::date as day,model,model_version,language,
      count(*) filter(where status='complete') as successes,
      count(*) filter(where status='failed') as failures,
      round(avg(processing_ms)) as average_processing_ms,
      sum(duration_seconds) as audio_seconds,
      case when count(estimated_cost_usd)=count(*) then sum(estimated_cost_usd) else null end as estimated_cost_usd
    from private.transcription_events where created_at>=now()-interval '90 days'
    group by 1,2,3,4 order by 1 desc
  ) t),'[]'::jsonb);
end; $$;
revoke all on function public.transcription_admin_stats() from public,anon;
grant execute on function public.transcription_admin_stats() to authenticated;
