# start-erp.ps1 — bring the whole local Rademics ERP stack up (idempotent).
#
# The four ports, always:
#   :4000  API             (backend — everything needs this)
#   :3000  Staff app       (employees / team leads — e.g. Devi)
#   :3001  Client portal   (client logins — e.g. Meridian Labs)
#   :3002  Staff app #2    (Super Admin's window, so both staff logins can live at once)
#
# :3002 runs from the same code but its OWN build folder (.next-3002 via NEXT_DIST_DIR).
# Two dev servers sharing one .next folder corrupt each other — that caused the
# "project won't open" 500s on 2026-07-27. Never remove the NEXT_DIST_DIR line.
#
# Safe to run any time: services already up are left alone.

$repo = 'D:\Rademics ERP'
Set-Location $repo

function Test-PortUp($port) {
  return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Service($label, $port, $command) {
  if (Test-PortUp $port) {
    Write-Host "[ok]    $label already running on :$port"
  } else {
    Write-Host "[start] $label on :$port"
    Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', $command
  }
}

Write-Host '== Rademics ERP local stack =='

# 1) Infrastructure (Postgres/Redis/MinIO/ClamAV/Mailhog) — no-op if already up.
& pnpm docker:up | Out-Null
Write-Host '[ok]    docker services'

# 2) The four app services.
Start-Service 'API'            4000 "cd '$repo'; pnpm --filter @rademics/api dev"
Start-Service 'Staff app'      3000 "cd '$repo'; pnpm --filter @rademics/internal dev"
Start-Service 'Client portal'  3001 "cd '$repo'; pnpm --filter @rademics/portal dev"
Start-Service 'Staff app #2'   3002 "cd '$repo\apps\internal'; `$env:NEXT_DIST_DIR='.next-3002'; npx next dev -p 3002"

Write-Host ''
Write-Host 'Staff / Devi   -> http://localhost:3000'
Write-Host 'Client portal  -> http://localhost:3001'
Write-Host 'Super Admin    -> http://localhost:3002'
