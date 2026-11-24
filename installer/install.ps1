# Sectium Browser — Sovereign 1-Line Windows Installer
# Usage: irm https://github.com/awesome-os/sectium-browser/releases/latest/download/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$InstallDir = if ($env:AWESOME_OS_INSTALL_DIR) { $env:AWESOME_OS_INSTALL_DIR } else { "$env:LOCALAPPDATA\AwesomeOS\SectiumBrowser" }
$Tag = if ($env:AWESOME_OS_TAG) { $env:AWESOME_OS_TAG } else { "latest" }
$base = if ($Tag -eq "latest") {
  "https://github.com/awesome-os/sectium-browser/releases/latest/download"
} else {
  "https://github.com/awesome-os/sectium-browser/releases/download/$Tag"
}

Write-Host "[Sectium Browser] Installing to $InstallDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$exePath = Join-Path $InstallDir "sectium-browser.exe"
$sumsPath = Join-Path $InstallDir "SHA256SUMS.txt"

Invoke-WebRequest -UseBasicParsing -Uri "$base/sectium-browser.exe" -OutFile $exePath
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $sumsPath

$expectedLine = Get-Content $sumsPath | Where-Object { $_ -match '\s+sectium-browser\.exe$' } | Select-Object -First 1
if ($expectedLine) {
  $expected = ($expectedLine -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $exePath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item -Force $exePath -ErrorAction SilentlyContinue
    throw "SHA-256 verification failed! Expected $expected, got $actual"
  }
  Write-Host "[Sectium Browser] SHA-256 verified: $actual" -ForegroundColor Green
}

# Create Start Menu shortcut with explicit icon binding
try {
  $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $lnkPath = Join-Path $startMenu "Sectium Browser.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnkPath)
  $sc.TargetPath = $exePath
  $sc.WorkingDirectory = $InstallDir
  $sc.IconLocation = "$exePath,0"
  $sc.Description = "Sectium Browser — Sovereign Chromium 158+ with AtlasKV Search"
  $sc.Save()
  Write-Host "[Sectium Browser] Start Menu shortcut created: $lnkPath" -ForegroundColor Green
} catch {
  Write-Warning "Could not create Start Menu shortcut: $($_.Exception.Message)"
}

Write-Host "`n[Sectium Browser] Installed successfully!" -ForegroundColor Green
Write-Host "Launch now:  & `"$exePath`"" -ForegroundColor White
