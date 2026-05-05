#!/usr/bin/env bash
# Gera binário para Ubuntu/Debian x86_64 sem precisar de Go no servidor Unbound.
# Uso (na raiz do repositório ou em qualquer sítio): bash apps/worker/scripts/build-linux-amd64.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p dist
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64
go build -trimpath -ldflags="-s -w" -o dist/dnsblock-worker-linux-amd64 ./cmd/worker
ls -la dist/dnsblock-worker-linux-amd64
echo "OK: copie dist/dnsblock-worker-linux-amd64 para o servidor Unbound (ex.: /opt/dns-block-portal/bin/)"
