# =============================================================================
# Cowork sandbox repair — restores the missing rootfs.vhdx by decompressing
# the rootfs.vhdx.zst that the Claude installer ships with the app bundle.
#
# WHAT WENT WRONG:
#   Cowork's Linux sandbox boots from rootfs.vhdx. That file is missing in your
#   install, but the source rootfs.vhdx.zst is present. The Claude app already
#   tried an auto-reinstall once (marker file: .auto_reinstall_attempted) and
#   failed, so it stopped retrying.
#
# WHAT THIS SCRIPT DOES:
#   1. Removes the .auto_reinstall_attempted marker
#   2. Decompresses rootfs.vhdx.zst → rootfs.vhdx (and the kernel/initrd files
#      if they are missing too)
#   3. Decompression is attempted via, in order of preference:
#        a) `zstd` if already on PATH
#        b) `winget install` zstd
#        c) Python's `zstandard` library (installed via pip if needed)
#        d) Downloads portable zstd from GitHub releases
#
# HOW TO RUN:
#   Right-click this file → "Run with PowerShell"  (or run from an admin
#   PowerShell prompt). Then restart the Claude desktop app.
# =============================================================================

$ErrorActionPreference = 'Stop'

$BundleDir = "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\vm_bundles\claudevm.bundle"

Write-Host '== Cowork sandbox repair =='
Write-Host "Bundle directory: $BundleDir"
Write-Host ''

if (-not (Test-Path $BundleDir)) {
    Write-Host "ERROR: Bundle directory not found. Is Claude installed?" -ForegroundColor Red
    Pause
    exit 1
}

# -----------------------------------------------------------------------------
# Step 1: clear the auto-reinstall marker so Claude will retry on next launch
# -----------------------------------------------------------------------------
$MarkerFile = Join-Path $BundleDir '.auto_reinstall_attempted'
if (Test-Path $MarkerFile) {
    Write-Host "Removing .auto_reinstall_attempted marker..." -ForegroundColor Cyan
    Remove-Item $MarkerFile -Force
    Write-Host '  Done.'
} else {
    Write-Host "No marker present (already cleared)."
}

# -----------------------------------------------------------------------------
# Step 2: figure out what is missing
# -----------------------------------------------------------------------------
$Pairs = @(
    @{Zst = 'rootfs.vhdx.zst';  Out = 'rootfs.vhdx'},
    @{Zst = 'vmlinuz.zst';      Out = 'vmlinuz'},
    @{Zst = 'initrd.zst';       Out = 'initrd'}
)

$ToDecompress = @()
foreach ($p in $Pairs) {
    $zstPath = Join-Path $BundleDir $p.Zst
    $outPath = Join-Path $BundleDir $p.Out
    if ((Test-Path $zstPath) -and -not (Test-Path $outPath)) {
        $ToDecompress += @{Zst = $zstPath; Out = $outPath; Name = $p.Zst}
    }
}

if ($ToDecompress.Count -eq 0) {
    Write-Host ''
    Write-Host 'Nothing needs to be decompressed — all VM files are present.' -ForegroundColor Green
    Write-Host 'Restart the Claude desktop app and try Cowork again.'
    Pause
    exit 0
}

Write-Host ''
Write-Host "Files to decompress: $($ToDecompress.Count)" -ForegroundColor Cyan
$ToDecompress | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host ''

# -----------------------------------------------------------------------------
# Step 3: find or install a decompressor
# -----------------------------------------------------------------------------
$ZstdCmd = $null

# 3a. Already on PATH?
$cmd = Get-Command zstd.exe -ErrorAction SilentlyContinue
if ($cmd) {
    $ZstdCmd = $cmd.Source
    Write-Host "Using zstd already on PATH: $ZstdCmd" -ForegroundColor Green
}

# 3b. Try winget install
if (-not $ZstdCmd) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host 'Trying: winget install Facebook.Zstd ...' -ForegroundColor Cyan
        try {
            & winget install --id Facebook.Zstd --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Out-Null
            # Reload PATH for current session
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
            $cmd = Get-Command zstd.exe -ErrorAction SilentlyContinue
            if ($cmd) { $ZstdCmd = $cmd.Source }
        } catch { }
        if ($ZstdCmd) { Write-Host "Installed zstd via winget: $ZstdCmd" -ForegroundColor Green }
    }
}

# 3c. Download portable zstd binary from GitHub
if (-not $ZstdCmd) {
    Write-Host 'Downloading portable zstd binary from GitHub...' -ForegroundColor Cyan
    $tempDir = Join-Path $env:TEMP 'cowork_repair_zstd'
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $url = 'https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-v1.5.6-win64.zip'
    $zipFile = Join-Path $tempDir 'zstd.zip'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $zipFile -UseBasicParsing
        Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force
        $found = Get-ChildItem -Path $tempDir -Filter 'zstd.exe' -Recurse | Select-Object -First 1
        if ($found) {
            $ZstdCmd = $found.FullName
            Write-Host "Using downloaded portable zstd: $ZstdCmd" -ForegroundColor Green
        }
    } catch {
        Write-Host "  Download failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 3d. Try Python + zstandard
$PyDecompress = $false
if (-not $ZstdCmd) {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
    if ($py) {
        Write-Host 'Trying Python + zstandard...' -ForegroundColor Cyan
        try {
            & $py.Source -m pip install --quiet zstandard 2>&1 | Out-Null
            & $py.Source -c "import zstandard" 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $PyDecompress = $true
                $PyPath = $py.Source
                Write-Host "Python + zstandard ready: $PyPath" -ForegroundColor Green
            }
        } catch { }
    }
}

if (-not $ZstdCmd -and -not $PyDecompress) {
    Write-Host ''
    Write-Host 'No decompressor available. Manual options:' -ForegroundColor Red
    Write-Host '  1) Install Python from https://www.python.org/downloads/'
    Write-Host '     then re-run this script.'
    Write-Host '  2) Install 7-Zip from https://www.7-zip.org/ (it supports .zst)'
    Write-Host '     then right-click rootfs.vhdx.zst -> 7-Zip -> Extract here.'
    Write-Host '     The other files (vmlinuz.zst, initrd.zst) need the same.'
    Pause
    exit 1
}

# -----------------------------------------------------------------------------
# Step 4: decompress each file
# -----------------------------------------------------------------------------
Write-Host ''
foreach ($f in $ToDecompress) {
    Write-Host "Decompressing $($f.Name) ..." -ForegroundColor Cyan
    try {
        if ($ZstdCmd) {
            & $ZstdCmd -d -f -o $f.Out $f.Zst
        } else {
            $script = @"
import sys, zstandard
with open(r'$($f.Zst)', 'rb') as fi, open(r'$($f.Out)', 'wb') as fo:
    d = zstandard.ZstdDecompressor()
    d.copy_stream(fi, fo)
print('OK')
"@
            $script | & $PyPath -
        }
        if (Test-Path $f.Out) {
            $sizeMb = [math]::Round((Get-Item $f.Out).Length / 1MB, 1)
            Write-Host "  $($f.Out)  ->  $sizeMb MB" -ForegroundColor Green
        } else {
            Write-Host "  FAILED — output file not created" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# -----------------------------------------------------------------------------
# Step 5: done
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '== Repair complete ==' -ForegroundColor Green
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1) Quit the Claude desktop app completely (system tray too).'
Write-Host '  2) Re-launch Claude.'
Write-Host '  3) In your Cowork session, ask Claude to "add the specialty sheets" again.'
Write-Host '     The sandbox should boot, and Claude will append all 27 sheets to your XLSX.'
Write-Host ''
Pause
