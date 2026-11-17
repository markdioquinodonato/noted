$ErrorActionPreference = "Stop"
$ref = "bvvyiijyvtjjuqkfjzpo"
$endpoint = "https://$ref.supabase.co/functions/v1/admin-providers"
$token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$secretFile = [IO.Path]::GetTempFileName()
$sqlFile = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($secretFile, "ADMIN_MONITORING_JOB_TOKEN=$token")
  $statement = @"
do BLOCK declare entry uuid; begin
  select id into entry from vault.secrets where name = 'noted_admin_monitoring_job_token';
  if entry is null then
    perform vault.create_secret('JOB_TOKEN', 'noted_admin_monitoring_job_token');
  else
    perform vault.update_secret(entry, 'JOB_TOKEN');
  end if;
  select id into entry from vault.secrets where name = 'noted_admin_monitoring_endpoint';
  if entry is null then
    perform vault.create_secret('JOB_ENDPOINT', 'noted_admin_monitoring_endpoint');
  else
    perform vault.update_secret(entry, 'JOB_ENDPOINT');
  end if;
end BLOCK;
"@
  [IO.File]::WriteAllText($sqlFile, $statement.Replace("JOB_TOKEN", $token).Replace("JOB_ENDPOINT", $endpoint).Replace("BLOCK", ([string][char]36 + [char]36)))
  $secretResult = npx --yes supabase secrets set "--remote=$ref" --env-file $secretFile --yes 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Supabase declined the scheduled Edge Function credential." }
  $vaultResult = npx --yes supabase db query "--remote=$ref" --yes --file $sqlFile 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("Vault setup failed. " + (($vaultResult | Out-String).Replace($token, "[redacted]"))) }
  "Configured the scheduled Noted provider probe."
} finally {
  [IO.File]::Delete($secretFile)
  [IO.File]::Delete($sqlFile)
}
