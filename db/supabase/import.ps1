# =============================================================================
# Precios Tandil -> Supabase : migracion de schema + datos
# =============================================================================
# Uso:
#   .\import.ps1 -SupabaseUrl "postgresql://postgres.<ref>:<pass>@...:5432/postgres"
#   .\import.ps1 -SupabaseUrl "..." -Mode full          # import completo (648 MB)
#   .\import.ps1 -SupabaseUrl "..." -SkipDump           # solo schema+vistas+RLS
#
# Modos:
#   public  (default)  Solo datos publicables: tablas chicas completas y
#                      price_record limitado a SKUs matcheados (~250 MB). Entra
#                      en el free tier de Supabase (500 MB).
#   full               Todo el historial de price_record (~648 MB). Requiere
#                      Supabase Pro (8 GB).
#
# La URL de Neon se lee de <repo>/.env (DATABASE_URL). Nada de secretos aca.
# =============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SupabaseUrl,
  [ValidateSet('public', 'full')][string]$Mode = 'public',
  [string]$PgBin = 'C:\pgsql16\bin',
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$WorkDir = (Join-Path $PSScriptRoot '_work'),
  [switch]$SkipSchema,
  [switch]$SkipDump
)

$ErrorActionPreference = 'Stop'

$psql      = Join-Path $PgBin 'psql.exe'
$pgDump    = Join-Path $PgBin 'pg_dump.exe'
$pgRestore = Join-Path $PgBin 'pg_restore.exe'
foreach ($exe in @($psql, $pgDump, $pgRestore)) {
  if (-not (Test-Path $exe)) { throw "No encontrado: $exe (ajusta -PgBin)" }
}

# --- Neon URL desde .env ---
$envFile = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envFile)) { throw "No existe $envFile" }
$neonUrl = (Get-Content -LiteralPath $envFile |
  Where-Object { $_ -match '^DATABASE_URL=' } |
  ForEach-Object { ($_ -split '=', 2)[1] }).Trim().Trim('"')
if (-not $neonUrl) { throw "DATABASE_URL no encontrada en $envFile" }

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

function Invoke-Psql {
  param([string]$Db, [string[]]$Args)
  & $psql $Db -w -v ON_ERROR_STOP=1 @Args
  if ($LASTEXITCODE -ne 0) { throw "psql fallo (exit $LASTEXITCODE)" }
}

Write-Host "== Ping Neon y Supabase ==" -ForegroundColor Cyan
Invoke-Psql -Db $neonUrl -Args @('-tAc', 'select 1')
Invoke-Psql -Db $SupabaseUrl -Args @('-tAc', 'select 1')

if (-not $SkipSchema) {
  Write-Host "== 1/5 schema ==" -ForegroundColor Cyan
  Invoke-Psql -Db $SupabaseUrl -Args @('-f', (Join-Path $PSScriptRoot 'schema.sql'))
  Write-Host "== 2/5 vistas ==" -ForegroundColor Cyan
  Invoke-Psql -Db $SupabaseUrl -Args @('-f', (Join-Path $PSScriptRoot 'views.sql'))
  Write-Host "== 3/5 RLS y grants ==" -ForegroundColor Cyan
  Invoke-Psql -Db $SupabaseUrl -Args @('-f', (Join-Path $PSScriptRoot 'supabase_rls.sql'))
}

if (-not $SkipDump) {
  if ($Mode -eq 'full') {
    Write-Warning "Modo full: ~648 MB. No entra en el free tier (500 MB) de Supabase."
  }

  $dump = Join-Path $WorkDir 'neon_data.dump'
  $exclude = @(
    '--exclude-table=public.pgmigrations',
    '--exclude-table-data=public.daily_series'
  )
  if ($Mode -eq 'public') {
    $exclude += '--exclude-table-data=public.price_record'
  }

  Write-Host "== 4/5 dump de datos ($Mode) ==" -ForegroundColor Cyan
  & $pgDump $neonUrl --data-only --schema=public --no-owner --no-privileges `
    -Fc @exclude -f $dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo" }

  Write-Host "  restore en Supabase..." -ForegroundColor Cyan
  & $pgRestore --data-only --no-owner --no-privileges -d $SupabaseUrl $dump
  # pg_restore devuelve warning si no hay nada que restaurar; toleramos WARN.
  if ($LASTEXITCODE -gt 1) { throw "pg_restore fallo (exit $LASTEXITCODE)" }

  if ($Mode -eq 'public') {
    Write-Host "  copiando price_record solo de SKUs matcheados..." -ForegroundColor Cyan
    $csv = Join-Path $WorkDir 'prices.csv'
    Invoke-Psql -Db $neonUrl -Args @(
      '-c', "\copy (select id, store_sku_id, price_amount, currency, list_or_promo, unit_price, source_url, captured_at, run_id, is_suspect from price_record where is_suspect = false and store_sku_id in (select id from match_link where status in ('auto','confirmed'))) to '$csv' csv"
    )
    Invoke-Psql -Db $SupabaseUrl -Args @(
      '-c', "\copy price_record (id, store_sku_id, price_amount, currency, list_or_promo, unit_price, source_url, captured_at, run_id, is_suspect) from '$csv' csv"
    )
    Invoke-Psql -Db $SupabaseUrl -Args @(
      '-c', "select setval('price_record_id_seq', greatest((select max(id) from price_record), 1))"
    )
  }
}

Write-Host "== 5/5 seed + refresh ==" -ForegroundColor Cyan
$env:DATABASE_URL = $SupabaseUrl
pnpm --filter @precios/db seed
Invoke-Psql -Db $SupabaseUrl -Args @('-c', 'refresh materialized view daily_series')

Write-Host "Listo. Datos migrados a Supabase." -ForegroundColor Green
Write-Host "Pendiente: correr 'pnpm --filter @precios/worker finalize' contra Supabase para refrescar price_aggregate." -ForegroundColor Yellow
