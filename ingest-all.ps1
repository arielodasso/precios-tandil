$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\ariel\OneDrive\Escritorio\ARIEL\precios\precios-tandil'
$env:DATABASE_URL = ((Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^DATABASE_URL=' } | ForEach-Object { ($_ -split '=',2)[1] }).Trim().Trim('"'))

$stores = @('golopolis','carrefour','monarca','comerciante-maxi','dia','cooperativa-obrera','vea')
$progress = 'ingest-progress.log'
Remove-Item -ErrorAction SilentlyContinue $progress

foreach ($store in $stores) {
  $log = "ingest-$store.log"
  Remove-Item -ErrorAction SilentlyContinue $log
  $started = Get-Date
  Add-Content -LiteralPath $progress -Value "[start] $store $started"
  & "C:\Users\ariel\AppData\Roaming\npm\pnpm.cmd" --filter @precios/worker ingest --store $store *>> $log
  $exit = $LASTEXITCODE
  $ended = Get-Date
  Add-Content -LiteralPath $progress -Value "[done] $store exit=$exit $ended (dur=$((New-TimeSpan -Start $started -End $ended).TotalMinutes)min)"
}

Add-Content -LiteralPath $progress -Value "[ALL DONE]"