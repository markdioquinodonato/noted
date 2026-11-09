create table if not exists private.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour timestamptz not null,
  requests integer not null default 0,
  primary key(user_id,hour)
);
revoke all on private.ai_usage from public, anon, authenticated;
create or replace function public.consume_ai_quota() returns boolean
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode='42501'; end if;
  insert into private.ai_usage(user_id,hour,requests) values((select auth.uid()),date_trunc('hour',now()),1)
  on conflict(user_id,hour) do update set requests=private.ai_usage.requests+1
  where private.ai_usage.requests<20 returning requests into used;
  return used is not null;
end; $$;
revoke all on function public.consume_ai_quota() from public,anon;
grant execute on function public.consume_ai_quota() to authenticated;
