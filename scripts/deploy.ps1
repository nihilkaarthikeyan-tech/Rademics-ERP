# deploy.ps1 - ship the committed HEAD to production, and PROVE it arrived.
#
# Why this exists: on 2026-07-28 a deploy reported success while shipping
# nothing. The rebuild command had been given a service name that owns no build
# definition, so it did nothing and exited 0; the follow-up restart brought the
# containers back up on the OLD image. Every signal we had said "fine" - the
# build's exit code, the container's restart time, even the health endpoint's
# release field (it reads an environment variable, so it happily reported the
# new version while serving old code).
#
# The lesson: a deploy is only proven by evidence that CHANGED. So this script
# snapshots the live system before and after, and fails loudly unless:
#   * a new image was actually built, AND
#   * all three containers are running THAT image, AND
#   * the API is healthy and both sites respond, AND
#   * when the release touches front-end code, the browser bundles differ.
#
# ASCII only, deliberately: Windows PowerShell reads .ps1 as ANSI unless the
# file carries a BOM, and a stray em-dash in a comment is enough to break
# parsing of the whole script.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#         powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -DryRun

param(
  [switch]$DryRun,
  # Skip the clean-working-tree gate. For emergencies; you are shipping
  # something that is not in git and therefore not reproducible.
  [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'

$VpsHost   = 'root@187.127.145.132'
$SshKey    = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$RemoteDir = '/opt/rademics-erp'
$ApiHealth = 'https://api.52digit.com/api/health'
$Sites     = [ordered]@{
  'staff app'     = 'https://rademics.52digit.com/login'
  'client portal' = 'https://clientportal.52digit.com/login'
}

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  PASS  $msg" -ForegroundColor Green }
function Bad($msg)  { Write-Host "  FAIL  $msg" -ForegroundColor Red }
function Note($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }

function Invoke-Vps([string]$cmd) { & ssh -i $SshKey -o BatchMode=yes $VpsHost $cmd }

# Parse KEY=VALUE lines from the remote helper into a hashtable.
function ConvertTo-Kv([object]$lines) {
  $h = @{}
  foreach ($l in @($lines)) {
    if ("$l" -match '^([A-Za-z_]+)=(.*)$') { $h[$Matches[1]] = $Matches[2].Trim() }
  }
  return $h
}

# The content-hashed script bundles a browser is told to download. If front-end
# code changed, these filenames MUST change - that is what makes them evidence.
function Get-LiveBundles([string]$url) {
  try {
    $html = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30).Content
    $m = [regex]::Matches($html, 'src="(/_next/static/[^"]+\.js)"')
    return (($m | ForEach-Object { $_.Groups[1].Value }) | Sort-Object) -join '|'
  } catch {
    return 'UNREACHABLE'
  }
}

$failures = New-Object System.Collections.Generic.List[string]

# ---- 1. What are we shipping? ----
Step 'Release'
Push-Location (Split-Path $PSScriptRoot -Parent)

$dirty = git status --porcelain
if ($dirty -and -not $AllowDirty) {
  Bad 'Uncommitted changes - commit them first (or pass -AllowDirty).'
  foreach ($d in $dirty) { Note $d }
  Pop-Location
  exit 1
}
$sha = (git rev-parse --short HEAD).Trim()
Ok "HEAD is $sha"

git fetch origin 2>$null | Out-Null
$originSha = (git rev-parse --short origin/main).Trim()
if ($sha -ne $originSha) {
  Note "GitHub is at $originSha - remember to push."
} else {
  Ok 'GitHub is in sync'
}

# ---- 2. Snapshot what is live BEFORE we touch anything ----
Step 'Snapshot before'
& scp -i $SshKey -o BatchMode=yes 'scripts/deploy-remote.sh' "${VpsHost}:/tmp/deploy-remote.sh" | Out-Null
$before = ConvertTo-Kv (Invoke-Vps 'sh /tmp/deploy-remote.sh before')
if ($before.IMAGE_ID) {
  $shortBefore = $before.IMAGE_ID.Substring(0, [Math]::Min(19, $before.IMAGE_ID.Length))
  Note "image now: $shortBefore"
}
$bundlesBefore = @{}
foreach ($k in $Sites.Keys) { $bundlesBefore[$k] = Get-LiveBundles $Sites[$k] }
Ok 'captured live fingerprint'

if ($DryRun) {
  Step 'Dry run - nothing shipped'
  Pop-Location
  exit 0
}

# ---- 3. Ship it ----
Step "Deploying $sha"
$tar = Join-Path $env:TEMP "release-$sha.tar.gz"
git archive -o $tar HEAD
& scp -i $SshKey -o BatchMode=yes $tar "${VpsHost}:/tmp/release.tar.gz" | Out-Null
Invoke-Vps "cd $RemoteDir && tar -xzf /tmp/release.tar.gz && rm -f /tmp/release.tar.gz" | Out-Null
Ok 'code synced'
Remove-Item $tar -ErrorAction SilentlyContinue

Note 'building + recreating (several minutes)...'
# Grep the status lines rather than tailing: BACKUP=ok is printed before several
# thousand lines of build output, so `tail -40` silently dropped it and the
# script reported a backup failure that had not happened.
$deployOut = Invoke-Vps "sh /tmp/deploy-remote.sh deploy $sha 2>&1 | grep -E '^(BACKUP|BUILD|RECREATE|ERROR)='"
$deployKv = ConvertTo-Kv $deployOut
foreach ($k in @('BACKUP', 'BUILD', 'RECREATE')) {
  if ($deployKv[$k] -eq 'ok') {
    Ok $k.ToLower()
  } else {
    Bad "$($k.ToLower()) did not report ok"
    $failures.Add($k)
  }
}

# ---- 4. PROVE it - the part that was missing ----
Step 'Proof'
$after = ConvertTo-Kv (Invoke-Vps 'sh /tmp/deploy-remote.sh after')

# 4a. A genuinely new image must exist.
if ($after.IMAGE_ID -and $after.IMAGE_ID -ne $before.IMAGE_ID) {
  Ok 'a new image was built'
} else {
  Bad 'image is UNCHANGED - the build did nothing (this is the exact 2026-07-28 failure)'
  $failures.Add('image-unchanged')
}

# 4b. Every container must be running THAT image - not the previous one.
foreach ($svc in @('api', 'internal', 'portal')) {
  if ($after["CONTAINER_$svc"] -and $after["CONTAINER_$svc"] -eq $after.IMAGE_ID) {
    Ok "$svc is running the new image"
  } else {
    Bad "$svc is running a DIFFERENT image than the one just built"
    $failures.Add("stale-$svc")
  }
}

# 4c. The API must actually be alive.
$health = $null
foreach ($i in 1..30) {
  try {
    $health = Invoke-RestMethod -Uri $ApiHealth -TimeoutSec 5
    if ($health.status -eq 'ok') { break }
  } catch { }
  Start-Sleep -Seconds 4
}
if ($health -and $health.status -eq 'ok' -and $health.db -eq 'up') {
  Ok "api healthy (db $($health.db))"
} else {
  Bad 'api did not come back healthy'
  $failures.Add('health')
}

# 4d. Both sites must serve.
foreach ($k in $Sites.Keys) {
  try {
    $code = (Invoke-WebRequest -Uri $Sites[$k] -UseBasicParsing -TimeoutSec 30).StatusCode
    if ($code -eq 200) { Ok "$k responds" } else { Bad "$k returned $code"; $failures.Add($k) }
  } catch {
    Bad "$k unreachable"
    $failures.Add($k)
  }
}

# 4e. If this release touched front-end code, the browser must be served
#     different bundles. Same filenames = the browser still has the old app.
$changed = git diff --name-only "$sha~1" $sha 2>$null
$touchedUi = @($changed) -match '^apps/(internal|portal)/'
foreach ($k in $Sites.Keys) {
  $now = Get-LiveBundles $Sites[$k]
  if ($now -eq 'UNREACHABLE') {
    Bad "$k could not be fetched for comparison"
    $failures.Add("bundles-$k")
  } elseif ($touchedUi -and $now -eq $bundlesBefore[$k]) {
    Bad "$k is serving the SAME files as before, but this release changed front-end code"
    $failures.Add("bundles-$k")
  } elseif ($touchedUi) {
    Ok "$k is serving newly built files"
  } else {
    Note "$k unchanged (this release touched no front-end code - expected)"
  }
}

# ---- 5. Verdict ----
Pop-Location
Write-Host ''
if ($failures.Count -eq 0) {
  Write-Host "DEPLOY VERIFIED - $sha is live and proven." -ForegroundColor Green
  exit 0
} else {
  Write-Host 'DEPLOY NOT PROVEN - do not tell anyone this shipped.' -ForegroundColor Red
  Write-Host "Failed checks: $($failures -join ', ')" -ForegroundColor Red
  Write-Host 'The previous image is still on the server; rollback = recreate from it.' -ForegroundColor Yellow
  exit 1
}
