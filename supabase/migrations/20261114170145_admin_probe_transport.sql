-- Send the Vault credential directly. Managed pg_net restores public queue grants.
do $$ begin
  if to_regclass('cron.job') is not null and to_regclass('vault.decrypted_secrets') is not null
    and exists(select 1 from pg_available_extensions where name = 'http') then
    create schema if not exists noted_monitoring;
    revoke all on schema noted_monitoring from public, anon, authenticated, service_role;
    create extension if not exists http with schema noted_monitoring;
    if (select nspname from pg_extension join pg_namespace on extnamespace = pg_namespace.oid
        where extname = 'http') <> 'noted_monitoring' then
      raise exception 'The HTTP extension must reside in the restricted monitoring schema';
    end if;
    perform cron.schedule('noted-admin-provider-probe', '2,17,32,47 * * * *',
      'select private.enqueue_admin_provider_probe()');
  end if;
end $$;

create or replace function private.enqueue_admin_provider_probe() returns void
language plpgsql security definer set search_path = '' as $$
declare job_token text; endpoint text; status_code integer;
begin
  select decrypted_secret into job_token from vault.decrypted_secrets where name = 'noted_admin_monitoring_job_token';
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'noted_admin_monitoring_endpoint';
  if job_token is null or endpoint is null then return; end if;
  if endpoint !~ '^https://[a-z]{20}[.]supabase[.]co/functions/v1/admin-providers$' then
    raise exception 'Invalid admin monitoring endpoint';
  end if;
  perform set_config('http.curlopt_timeout_msec', '40000', true);
  select status into status_code from noted_monitoring.http((
    'POST', endpoint, array[noted_monitoring.http_header('x-noted-monitoring-job', job_token)],
    'application/json', '{}'
  )::noted_monitoring.http_request);
  if status_code not in (200,429) then
    raise exception 'Scheduled provider request failed (HTTP %)', status_code;
  end if;
end $$;
