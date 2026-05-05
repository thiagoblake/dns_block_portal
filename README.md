# DNS Block Portal

Portal administrativo para cadastro, importacao, aprovacao, auditoria e aplicacao de listas de dominios bloqueados em DNS Unbound.

## Stack
- Frontend: Next.js + TypeScript + Tailwind + componentes no padrao shadcn/ui
- API: Go + Gin + GORM + JWT + bcrypt
- Worker: Go (gera `.conf`, valida/aplica Unbound ou simula em mock)
- Banco: PostgreSQL
- Infra: Docker Compose

## Estrutura
```text
dns-block-portal/
  apps/
    web/
    api/
    worker/
  infra/
    docker-compose.yml
    postgres/init.sql
  docs/PRD.md
  .env.example
  README.md
```

## Como rodar localmente
1. Na raiz do projeto:
   ```bash
   docker compose up -d --build
   ```
2. Acesse:
   - Web: `http://localhost:3000`
   - API: `http://localhost:8080`
3. Login inicial:
   - E-mail: `admin@local.test`
   - Senha: `admin123`

## Fluxo de aprovacao (MVP)
1. OPERADOR cria lista e adiciona dominios (manual, bulk ou upload `.txt/.csv`).
2. OPERADOR envia para aprovacao (`DRAFT -> PENDING_APPROVAL`).
3. ADMIN aprova (`PENDING_APPROVAL -> APPROVED`).
4. ADMIN aplica (`APPROVED -> APPLIED`) e o worker executa ciclo de geracao/aplicacao.
5. ADMIN pode revogar (`APPLIED -> REVOKED`).

## Endpoints principais
- Auth:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- Users:
  - `GET /api/users`
  - `POST /api/users`
  - `GET /api/users/:id`
  - `PUT /api/users/:id`
  - `PATCH /api/users/:id/status`
  - `PATCH /api/users/:id/password`
- Block Lists:
  - `GET /api/block-lists`
  - `POST /api/block-lists`
  - `GET /api/block-lists/:id`
  - `PUT /api/block-lists/:id`
  - `DELETE /api/block-lists/:id`
  - `POST /api/block-lists/:id/submit`
  - `POST /api/block-lists/:id/approve`
  - `POST /api/block-lists/:id/revoke`
  - `POST /api/block-lists/:id/apply`
- Domains:
  - `GET /api/block-lists/:id/domains`
  - `POST /api/block-lists/:id/domains`
  - `POST /api/block-lists/:id/domains/bulk`
  - `DELETE /api/domains/:id`
- Upload/Preview:
  - `POST /api/block-lists/:id/upload`
  - `POST /api/domains/normalize-preview`
- Operacao:
  - `GET /api/apply-runs`
  - `GET /api/apply-runs/:id`
  - `POST /api/unbound/apply`
  - `POST /api/unbound/validate`
- Auditoria e dashboard:
  - `GET /api/audit-logs`
  - `GET /api/dashboard`

## Modo MOCK (desenvolvimento)
Variavel:
```env
UNBOUND_MOCK=true
```
Com mock ativo, o worker:
- Gera arquivo temporario
- Faz swap para arquivo final
- Simula validacao e reload sem exigir Unbound instalado

## Integracao real com Unbound
Defina no ambiente de producao:
```env
UNBOUND_CONFIG_PATH=/etc/unbound/unbound.conf
UNBOUND_GENERATED_DIR=/etc/unbound/blocklists/generated
UNBOUND_CURRENT_FILE=dns-block-portal.conf
UNBOUND_CHECKCONF_BIN=/usr/sbin/unbound-checkconf
UNBOUND_CONTROL_BIN=/usr/sbin/unbound-control
UNBOUND_MOCK=false
```

No `unbound.conf` principal:
```conf
include: "/etc/unbound/blocklists/generated/*.conf"
```

## Arquivo de configuracao gerado
Exemplos:
```conf
local-zone: "dominio.com." always_nxdomain
local-zone: "dominio.com." always_null
local-zone: "dominio.com." refuse
local-zone: "dominio.com." redirect
local-data: "dominio.com. A 10.10.10.10"
```

## Variaveis de ambiente
Use `.env.example` como base:
- `APP_ENV`
- `APP_PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `UNBOUND_CONFIG_PATH`
- `UNBOUND_GENERATED_DIR`
- `UNBOUND_CURRENT_FILE`
- `UNBOUND_CHECKCONF_BIN`
- `UNBOUND_CONTROL_BIN`
- `UNBOUND_MOCK`
- `FRONTEND_URL`
- `NEXT_PUBLIC_API_URL`

## Comandos uteis (desenvolvimento local sem Docker)
- API:
  ```bash
  cd apps/api
  go run ./cmd/api
  ```
- Worker:
  ```bash
  cd apps/worker
  go run ./cmd/worker
  ```
- Web:
  ```bash
  cd apps/web
  npm install
  npm run dev
  ```

## Checklist de aceite (MVP)
- [x] Login com usuario ADMIN inicial
- [x] CRUD de usuarios (ADMIN)
- [x] CRUD de listas e workflow de aprovacao
- [x] Cadastro manual, bulk e upload `.txt/.csv` para dominios
- [x] Normalizacao e validacao basica de dominio
- [x] Geração de `.conf` e aplicacao em modo mock
- [x] Registro de auditoria
- [x] Dashboard e historico de aplicacoes
