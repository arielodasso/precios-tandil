$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\ariel\OneDrive\Escritorio\ARIEL\precios\precios-tandil'
$env:DATABASE_URL = ((Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^DATABASE_URL=' } | ForEach-Object { ($_ -split '=',2)[1] }).Trim().Trim('"'))
$env:NODE_ENV = 'production'

$stores = @('carrefour','monarca','comerciante-maxi','dia','cooperativa-obrera','vea')
$progress = 'ingest-progress.log'
Remove-Item -ErrorAction SilentlyContinue $progress
Add-Content -LiteralPath $progress -Value "[start] remainder $(Get-Date -Format s)"

foreach ($store in $stores) {
  $log = "ingest-$store.log"
  Remove-Item -ErrorAction SilentlyContinue $log
  $started = Get-Date
  Add-Content -LiteralPath $progress -Value "[start] $store $($started.ToString('s'))"
  & "C:\Users\ariel\AppData\Roaming\npm\pnpm.cmd" --filter @precios/worker ingest --store $store *>> $log
  $exit = $LASTEXITCODE
  $ended = Get-Date
  $dur = [math]::Round(((New-TimeSpan -Start $started -End $ended).TotalMinutes),1)
  Add-Content -LiteralPath $progress -Value "[done] $store exit=$exit $($ended.ToString('s')) dur=${dur}min"
}

Add-Content -LiteralPath $progress -Value "[ALL DONE] $(Get-Date -Format s)"
