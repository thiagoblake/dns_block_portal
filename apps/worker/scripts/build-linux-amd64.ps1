# Cross-compile worker para Linux amd64 (Ubuntu x86_64), sem CGO.
# Executar em apps/worker: .\scripts\build-linux-amd64.ps1
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
New-Item -ItemType Directory -Force -Path dist | Out-Null
$env:CGO_ENABLED = "0"
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -trimpath -ldflags="-s -w" -o dist/dnsblock-worker-linux-amd64 ./cmd/worker
Get-Item dist/dnsblock-worker-linux-amd64 | Format-List FullName, Length, LastWriteTime
Write-Host "OK: copie dist/dnsblock-worker-linux-amd64 para o servidor Unbound."
