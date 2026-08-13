# MooVoice Windows development launcher
[CmdletBinding()]
param(
    [string]$EngineDirectory = "",
    [int]$EnginePort = 18888,
    [int]$InterfacePort = 8080,
    [switch]$SkipEngine,
    [switch]$SkipInterface,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DemoDirectory = Join-Path $RepoRoot "client\demo"

function Write-Step([string]$Message) {
    Write-Host "[MooVoice] $Message" -ForegroundColor Magenta
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

function Wait-ForPort([string]$Name, [int]$Port, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort $Port) {
            Write-Host "[MooVoice] $Name is ready on port $Port." -ForegroundColor Green
            return
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
        @{ Name = "start_http.bat"; Args = "" },
        @{ Name = "start_https.bat"; Args = "" },
        @{ Name = "start.bat"; Args = "" },
        @{ Name = "MMVCServerSIO.exe"; Args = "-p $EnginePort --https true" }
    )

    foreach ($choice in $choices) {
        $path = Join-Path $Directory $choice.Name
        if (-not (Test-Path $path -PathType Leaf)) { continue }
        Write-Step "Starting conversion engine with $($choice.Name)..."
        if ($path.EndsWith(".bat")) {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/k", ('"' + $path + '"') -WorkingDirectory $Directory | Out-Null
        } else {
            Start-Process -FilePath $path -ArgumentList $choice.Args -WorkingDirectory $Directory | Out-Null
        }
        return
    }
    throw "No supported engine launcher was found in $Directory."
}

Write-Step "Checking your setup..."

if (-not $SkipEngine) {
    if (Test-TcpPort $EnginePort) {
        Write-Host "[MooVoice] Conversion engine is already running." -ForegroundColor Green
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
        Start-Engine $resolvedEngineDirectory
        Wait-ForPort "Conversion engine" $EnginePort 120
    }
}

if (-not $SkipInterface) {
    if (-not (Test-Path (Join-Path $DemoDirectory "package.json"))) {
        throw "MooVoice frontend was not found at $DemoDirectory."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is not available in PATH. Install Node.js and reopen PowerShell."
    }
    if (Test-TcpPort $InterfacePort) {
        Write-Host "[MooVoice] Interface is already running." -ForegroundColor Green
    } else {
        Write-Step "Starting the MooVoice interface..."
        $env:MOOVOICE_ENGINE_URL = "http://127.0.0.1:$EnginePort"
        $escapedDemoDirectory = $DemoDirectory.Replace("'", "''")
        $command = "Set-Location -LiteralPath '$escapedDemoDirectory'; npm start"
        Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command -WorkingDirectory $DemoDirectory | Out-Null
        Wait-ForPort "MooVoice interface" $InterfacePort 120
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
