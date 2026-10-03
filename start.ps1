param(
    [switch]$Background,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 이상을 설치해 주세요.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '의존성 설치에 실패했습니다.' } }
if (-not $NoBuild -or -not (Test-Path -LiteralPath 'dist/index.html')) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw '앱 빌드에 실패했습니다.' }
}
$tellPort = if ($env:TELL_PORT) { [int]$env:TELL_PORT } else { 4317 }
$tellUrl = "http://127.0.0.1:$tellPort"
if ($Background) {
    $tellData = if ($env:TELL_DATA_DIR) { $env:TELL_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'TellRivals' }
    New-Item -ItemType Directory -Path $tellData -Force | Out-Null
    try {
        $tellExisting = Invoke-WebRequest -Uri $tellUrl -UseBasicParsing -TimeoutSec 2
        if ($tellExisting.Content -match 'TELL') {
            Write-Host "TELL is already running: $tellUrl"
            return
        }
        throw "Another application is using port $tellPort."
    } catch {
        if ($_.Exception.Message -like 'Another application*') { throw }
    }
    $tellNode = (Get-Command node).Source
    $tellEntry = '"' + (Join-Path $PSScriptRoot 'server/index.ts') + '"'
    $tellProcess = Start-Process -FilePath $tellNode -ArgumentList @('--import', 'tsx', $tellEntry, '--production') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $tellData 'runtime.stdout.log') -RedirectStandardError (Join-Path $tellData 'runtime.stderr.log')
    for ($tellAttempt = 0; $tellAttempt -lt 40; $tellAttempt++) {
        if ($tellProcess.HasExited) { throw "TELL failed to start. See $tellData\runtime.stderr.log" }
        try {
            $tellReady = Invoke-WebRequest -Uri $tellUrl -UseBasicParsing -TimeoutSec 1
            if ($tellReady.Content -match 'TELL') {
                Write-Host "TELL is running in the background: $tellUrl"
                return
            }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw "TELL did not become ready. See $tellData\runtime.stderr.log"
}
Write-Host "브라우저에서 $tellUrl 을 여세요. 종료: Ctrl+C"
& npm.cmd start
