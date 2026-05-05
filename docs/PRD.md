# PRD — DNS Block Portal

Documento de requisitos de produto para portal administrativo de bloqueio DNS com Unbound.

## Objetivo
- Permitir cadastro, importacao, aprovacao e aplicacao auditavel de listas de dominios bloqueados.
- Reduzir erros manuais na configuracao do Unbound.

## Stack
- Frontend: Next.js + TypeScript + Tailwind + shadcn/ui
- API: Go + Gin + GORM + JWT + bcrypt
- Worker: Go para gerar/validar/aplicar configuracao
- Banco: PostgreSQL
- Infra: Docker Compose

## Fluxo principal
1. Operador cria lista e adiciona dominios.
2. Lista segue para aprovacao.
3. Admin aprova.
4. Worker gera arquivo `.conf`, valida e aplica reload (ou simula em MOCK).
5. Sistema registra auditoria.
