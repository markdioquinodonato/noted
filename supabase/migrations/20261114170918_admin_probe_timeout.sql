-- Allow the provider probe to complete after an Edge Function cold start.
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
  perform set_config('http.curlopt_timeout_ms', '40000', true);
  select status into status_code from noted_monitoring.http((
    'POST', endpoint, array[noted_monitoring.http_header('x-noted-monitoring-job', job_token)],
    'application/json', '{}'
  )::noted_monitoring.http_request);
  if status_code not in (200,429) then
    raise exception 'Scheduled provider request failed (HTTP %)', status_code;
  end if;
end $$;
