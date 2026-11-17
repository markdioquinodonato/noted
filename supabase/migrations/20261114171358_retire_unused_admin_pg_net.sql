-- The provider probe now uses restricted pgsql-http. Preserve pg_net if another integration uses it.
do $$ begin
  if to_regclass('net.http_request_queue') is null then return; end if;
  if not exists(select 1 from net.http_request_queue)
    and not exists(select 1 from net._http_response)
    and not exists(select 1 from cron.job where command ilike '%net.http_%') then
    drop extension pg_net restrict;
  end if;
end $$;
