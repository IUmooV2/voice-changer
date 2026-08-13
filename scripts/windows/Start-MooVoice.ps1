# MooVoice Windows development launcher
[CmdletBinding()]
param(
    [string]$EngineDirectory = "",
    [int]$EnginePort = 18888,
    [int]$InterfacePort = 8080,
    [switch]$SkipEngine,
    [switch]$SkipInterface,
    [switch]$NoBrowser,
    [switch]$ShowServiceWindows
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DemoDirectory = Join-Path $RepoRoot "client\demo"
$LogDirectory = Join-Path $RepoRoot "logs\moovoice"
$StartupLog = Join-Path $LogDirectory "startup.log"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-Step([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Magenta) {
    $line = "[MooVoice] $Message"
    Write-Host $line -ForegroundColor $Color
    Add-Content -LiteralPath $StartupLog -Value "$((Get-Date).ToString("s")) $line" -Encoding UTF8
}

function Test-TcpPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(700)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-ForPort([string]$Name, [int]$Port, [int]$TimeoutSeconds, [System.Diagnostics.Process]$Process = $null) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $nextUpdate = 10
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) {
            throw "$Name exited before becoming ready (exit code $($Process.ExitCode))."
        }
        if (Test-TcpPort $Port) {
            Write-Step "$Name is ready on port $Port." Green
            return
        }
        $elapsed = $TimeoutSeconds - [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
        if ($elapsed -ge $nextUpdate) {
            Write-Step "Still waiting for $Name..." DarkGray
            $nextUpdate += 10
        }
        Start-Sleep -Milliseconds 750
    }
    throw "$Name did not become ready on port $Port within $TimeoutSeconds seconds."
}

function Resolve-EngineDirectory([string]$RequestedDirectory) {
    $candidates = @()
    if ($RequestedDirectory) { $candidates += $RequestedDirectory }
    $candidates += @(
        (Join-Path $RepoRoot "engine"),
        (Join-Path $RepoRoot "runtime\engine"),
        (Join-Path $RepoRoot "MMVCServerSIO")
    )

    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate -PathType Container)) { continue }
        foreach ($launcher in @("start_http.bat", "start_https.bat", "start.bat", "MMVCServerSIO.exe")) {
            $match = Get-ChildItem -LiteralPath $candidate -Filter $launcher -File -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($match) {
                return $match.DirectoryName
            }
        }
    }
    return $null
}

function Start-Engine([string]$Directory) {
    $choices = @(
        @{ Name = "start_https.bat"; Args = "" },
        @{ Name = "start_http.bat"; Args = "" },
        @{ Name = "start.bat"; Args = "" },
        @{ Name = "MMVCServerSIO.exe"; Args = "-p $EnginePort --https true" }
    )

    foreach ($choice in $choices) {
        $path = Join-Path $Directory $choice.Name
        if (-not (Test-Path $path -PathType Leaf)) { continue }
        Write-Step "Starting conversion engine with $($choice.Name)..."
        if ($path.EndsWith(".bat")) {
            $windowStyle = if ($ShowServiceWindows) { "Normal" } else { "Minimized" }
            return Start-Process -FilePath "cmd.exe" -ArgumentList "/k", ('title MooVoice Engine && "' + $path + '"') -WorkingDirectory $Directory -WindowStyle $windowStyle -PassThru
        } else {
            $windowStyle = if ($ShowServiceWindows) { "Normal" } else { "Minimized" }
            return Start-Process -FilePath $path -ArgumentList $choice.Args -WorkingDirectory $Directory -WindowStyle $windowStyle -PassThru
        }
        return
    }
    throw "No supported engine launcher was found in $Directory."
}

Set-Content -LiteralPath $StartupLog -Value "$((Get-Date).ToString("s")) [MooVoice] Startup requested." -Encoding UTF8
Write-Step "Checking Windows, engine, and interface dependencies..."

if (-not $SkipEngine) {
    if (Test-TcpPort $EnginePort) {
        Write-Step "Conversion engine is already running. Reusing it." Green
    } else {
        $resolvedEngineDirectory = Resolve-EngineDirectory $EngineDirectory
        if (-not $resolvedEngineDirectory) {
            Write-Host ""
            Write-Host "MooVoice could not find a conversion engine." -ForegroundColor Yellow
            Write-Host "Extract a compatible engine into:" -ForegroundColor Yellow
            Write-Host "  $RepoRoot\engine" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Expected launcher: start_https.bat, start_http.bat, start.bat, or MMVCServerSIO.exe"
            Write-Host "Then run this script again."
            exit 2
        }
        $engineProcess = Start-Engine $resolvedEngineDirectory
        Wait-ForPort "Conversion engine" $EnginePort 120 $engineProcess
    }
}

if (-not $SkipInterface) {
    if (-not (Test-Path (Join-Path $DemoDirectory "package.json"))) {
        throw "MooVoice frontend was not found at $DemoDirectory."
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is not available in PATH. Install Node.js LTS and reopen PowerShell."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is not available in PATH. Repair Node.js and reopen PowerShell."
    }
    Write-Step "Node $(& node --version) and npm $(& npm --version) detected." Green
    if (Test-TcpPort $InterfacePort) {
        Write-Step "Interface is already running. Reusing it." Green
    } else {
        Write-Step "Starting the MooVoice interface..."
        $engineProtocol = if ((Test-Path (Join-Path $resolvedEngineDirectory "start_https.bat")) -or (-not $resolvedEngineDirectory)) { "https" } else { "http" }
        $env:MOOVOICE_ENGINE_URL = "${engineProtocol}://127.0.0.1:$EnginePort"
        $escapedDemoDirectory = $DemoDirectory.Replace("'", "''")
        $escapedLogDirectory = $LogDirectory.Replace("'", "''")
        $command = "$host.UI.RawUI.WindowTitle='MooVoice Interface'; Set-Location -LiteralPath '$escapedDemoDirectory'; npm start 2>&1 | Tee-Object -FilePath (Join-Path '$escapedLogDirectory' 'interface.log')"
        $windowStyle = if ($ShowServiceWindows) { "Normal" } else { "Minimized" }
        $interfaceProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command -WorkingDirectory $DemoDirectory -WindowStyle $windowStyle -PassThru
        Wait-ForPort "MooVoice interface" $InterfacePort 120 $interfaceProcess
    }
}

if (-not $NoBrowser) {
    Write-Step "Opening MooVoice..."
    Start-Process "https://localhost:$InterfacePort"
}

Write-Host ""
Write-Host "MooVoice is ready." -ForegroundColor Green
Write-Host "Interface: https://localhost:$InterfacePort"
Write-Host "Engine port: $EnginePort"
Write-Host "Logs: $LogDirectory"
Write-Host "Tip: add -ShowServiceWindows when troubleshooting." -ForegroundColor DarkGray
