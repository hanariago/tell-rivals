$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 이상을 설치해 주세요.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '의존성 설치에 실패했습니다.' } }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '앱 빌드에 실패했습니다.' }
Write-Host '브라우저에서 http://127.0.0.1:4317 을 여세요. 종료: Ctrl+C'
& npm.cmd start
