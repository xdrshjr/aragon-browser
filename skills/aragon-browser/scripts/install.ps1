# Install aragon-browser on Windows.
#
# The installer is the only supported path: the CLI ships inside the app and
# cannot drive a browser without it. This script exists to make the steps
# repeatable, not to replace the installer.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Path <installer.exe>] [-SkipLaunch]
#
# It deliberately does NOT append to PATH. That is a separate, explicit action
# (File -> Add CLI to PATH in the app), because a browser that rewrites your
# environment during onboarding is indistinguishable from malware.

[CmdletBinding()]
param(
  [string]$Path,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'

function Find-Installer {
  $candidates = @()
  if ($Path) { $candidates += (Resolve-Path $Path).Path }
  $candidates += Get-ChildItem -Path (Join-Path $PSScriptRoot '..\..\dist\*.exe') -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*portable*' -and $_.Name -notlike '*uninstaller*' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -ExpandProperty FullName
  $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Test-Installed {
  $exe = Join-Path $env:LOCALAPPDATA 'Programs\aragon-browser\aragon-browser.exe'
  $alt = Join-Path $env:LOCALAPPDATA 'aragon-browser\aragon-browser.exe'
  if (Test-Path $exe) { return $exe }
  if (Test-Path $alt) { return $alt }
  return $null
}

$installed = Test-Installed
if ($installed) {
  Write-Host "[install] already installed: $installed"
} else {
  $installer = Find-Installer
  if (-not $installer) {
    Write-Host '[install] no installer found.'
    Write-Host '[install] Download it from the repo releases, or pass -Path <installer.exe>.'
    exit 1
  }
  Write-Host "[install] running $installer"
  # /S silent, current user, no elevation prompt.
  $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Write-Host "[install] installer exited $($process.ExitCode)."
    Write-Host '[install] If SmartScreen blocked it, choose "More info" -> "Run anyway".'
    exit $process.ExitCode
  }
  $installed = Test-Installed
  if (-not $installed) {
    Write-Host '[install] installer reported success but the app was not found.'
    exit 1
  }
}

if (-not $SkipLaunch) {
  $running = Get-Process -Name 'aragon-browser' -ErrorAction SilentlyContinue
  if (-not $running) {
    Write-Host '[install] launching once so first-run setup writes the CLI shim...'
    Start-Process -FilePath $installed
    # The shim is written during app startup; poll instead of guessing a delay.
    $shim = Join-Path $env:LOCALAPPDATA 'aragon-browser\bin\aragon-browser.cmd'
    $deadline = (Get-Date).AddSeconds(45)
    while (-not (Test-Path $shim) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path $shim)) {
      Write-Host "[install] the CLI shim did not appear at $shim"
      Write-Host '[install] Open the app manually and check Agent -> Show setup status.'
      exit 1
    }
    Write-Host "[install] CLI installed: $shim"
  }
}

$shim = Join-Path $env:LOCALAPPDATA 'aragon-browser\bin\aragon-browser.cmd'
$onPath = ($env:PATH -split ';') -contains (Split-Path $shim)
if ($onPath) {
  Write-Host '[install] ready. Run: aragon-browser skill'
} else {
  Write-Host '[install] installed, but its bin directory is not on PATH yet.'
  Write-Host "[install] Add it: setx PATH `"$(Split-Path $shim);%PATH%`""
  Write-Host "[install] Or use the app menu: File -> Add CLI to PATH"
  Write-Host "[install] Meanwhile: `"$shim`" skill"
}
