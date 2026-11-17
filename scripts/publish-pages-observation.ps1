$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $credentials = npx --yes wrangler@4.162.0 auth token --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$credentials.token) { throw 'Cloudflare deployment verification requires Wrangler authentication.' }

  $base = 'https://api.cloudflare.com/client/v4/accounts/26bc1b213cec6f5003ebcf410baf746b/pages/projects/noted-ph'
  $headers = @{ Authorization = "Bearer $($credentials.token)" }
  $project = Invoke-RestMethod -Uri $base -Headers $headers
  $deployment = $project.result.canonical_deployment
  $local = Get-Content dist/release.json -Raw | ConvertFrom-Json
  $live = Invoke-RestMethod 'https://noted-ph.pages.dev/release.json'
  if ($live.builtAt -ne $local.builtAt -or $deployment.environment -ne 'production' -or $deployment.latest_stage.status -ne 'success') {
    throw 'Cloudflare did not report a successful production deployment of the local build.'
  }

  $published = ([DateTimeOffset]$deployment.modified_on).UtcDateTime.ToString('o')
  $total = (Invoke-RestMethod -Uri "$base/deployments?per_page=1" -Headers $headers).result_info.total_count
  $statement = "select public.record_provider_metric('cloudflare_production',1,'Cloudflare Pages API','available','Production deployment succeeded.',null,'$published')"
  if ($total -is [ValueType] -and $total -ge 0) {
    $statement += ", public.record_provider_metric('cloudflare_deployments',$([long]$total),'Cloudflare Pages API','available','All-time Pages deployments for this project.',null,'$published')"
  }
  npx --yes supabase db query --remote=bvvyiijyvtjjuqkfjzpo --yes $statement
  if ($LASTEXITCODE -ne 0) { throw 'Could not record the verified deployment in Supabase.' }
  [pscustomobject]@{ Deployment = $deployment.id; Status = $deployment.latest_stage.status; URL = $deployment.url; Published = $published }
} finally {
  Pop-Location
}
