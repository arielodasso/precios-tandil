<# 
  update-tunnel.ps1
  Restarts cloudflared, extracts the new tunnel URL, updates the Vercel env var,
  and redeploys the web frontend.
  
  Usage: .\scripts\update-tunnel.ps1
#>

$ErrorActionPreference = 'Stop'

Write-Host "=== Precios Tandil — Tunnel URL Updater ===" -ForegroundColor Cyan

# 1. Kill existing cloudflared
$existing = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[1/5] Stopping existing cloudflared..." -ForegroundColor Yellow
    Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 2. Start cloudflared in background and capture output
Write-Host "[2/5] Starting cloudflared tunnel..." -ForegroundColor Yellow
$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = "cloudflared"
$process.StartInfo.Arguments = "tunnel --url http://localhost:3001"
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.Start() | Out-Null

# Wait for the URL to appear in stderr (cloudflared prints to stderr)
$ tunnelUrl = $null
$maxWait = 30
$elapsed = 0
while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 1
    $elapsed++
    # Read stderr line by line
    while ($process.StandardError.Peek() -ge 0) {
        $line = $process.StandardError.ReadLine()
        if ($line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
            break
        }
    }
    if ($tunnelUrl) { break }
}

if (-not $tunnelUrl) {
    Write-Host "ERROR: Could not detect tunnel URL after ${maxWait}s" -ForegroundColor Red
    $process.Kill()
    exit 1
}

Write-Host "   Tunnel URL: $tunnelUrl" -ForegroundColor Green

# 3. Update Vercel env var
Write-Host "[3/5] Updating Vercel env var NEXT_PUBLIC_API_BASE_URL..." -ForegroundColor Yellow
$apiUrl = "${tunnelUrl}/api/v1"

# Remove old value
npx vercel env rm NEXT_PUBLIC_API_BASE_URL production --yes 2>$null

# Add new value  
npx vercel env add NEXT_PUBLIC_API_BASE_URL production --value $apiUrl 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to update Vercel env var" -ForegroundColor Red
    exit 1
}

# 4. Deploy to production
Write-Host "[4/5] Deploying to Vercel production..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\..\apps\web"
npx vercel --prod --yes 2>&1 | ForEach-Object { Write-Host "   $_" }
Pop-Location

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Vercel deployment failed" -ForegroundColor Red
    exit 1
}

# 5. Update PM2 ecosystem config (for next manual restart)
Write-Host "[5/5] Updating ecosystem.config.cjs..." -ForegroundColor Yellow
$ecoPath = "$PSScriptRoot\..\ecosystem.config.cjs"
$ecoContent = Get-Content $ecoPath -Raw
$ecoContent = $ecoContent -replace 'NEXT_PUBLIC_API_BASE_URL.*', "NEXT_PUBLIC_API_BASE_URL: '$apiUrl',"
Set-Content $ecoPath -Value $ecoContent -NoNewline

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Tunnel URL:  $tunnelUrl"
Write-Host "API URL:     $apiUrl"
Write-Host "Web URL:     https://web-two-plum-r3fk6yvjnz.vercel.app"
Write-Host ""
Write-Host "Note: cloudflared is running in background (PID: $($process.Id))" -ForegroundColor DarkGray
Write-Host "To stop: Stop-Process -Id $($process.Id)" -ForegroundColor DarkGray
