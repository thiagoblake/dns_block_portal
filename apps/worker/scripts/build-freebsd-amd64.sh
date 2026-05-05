#!/usr/bin/env bash
# Binário para FreeBSD/OPNsense amd64 (vtnet, unbound típico em /usr/local).
# Não usar o linux-amd64 nestes hosts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p dist
export CGO_ENABLED=0
export GOOS=freebsd
export GOARCH=amd64
go build -trimpath -ldflags="-s -w" -o dist/dnsblock-worker-freebsd-amd64 ./cmd/worker
ls -la dist/dnsblock-worker-freebsd-amd64
echo "OK: copie dist/dnsblock-worker-freebsd-amd64 para o DNS01"
