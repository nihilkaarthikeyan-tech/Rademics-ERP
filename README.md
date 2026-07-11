# Rademics ERP

Work Management & Employee Monitoring Platform (V1). Monorepo containing the internal app, the client portal, the backend API, and shared packages.

> **Specification:** [`RADEMICS_ERP_SPEC.md`](RADEMICS_ERP_SPEC.md) is the single source of truth.
> **Build plan:** [`phase.md`](phase.md) defines the phased build order.

## Repository layout

```
apps/
  api/        NestJS backend (REST, Prisma, BullMQ, Socket.IO)
  internal/   Next.js internal app (staff)
  portal/     Next.js client portal (separate deployable)
packages/
  config/       shared tsconfig / eslint / tailwind presets
  types/        shared DTOs, enums, contracts
  permissions/  capability keys + Role & Permission Matrix seed (Spec §3)
  ui/           shared shadcn/ui component set + brand tokens (Spec §9)
```

## Tech stack (Spec §12)

Next.js 15 · React 19 · TypeScript · Tailwind · shadcn/ui · NestJS · PostgreSQL · Prisma · Redis · BullMQ · Socket.IO · MinIO · ClamAV · JWT+refresh RBAC.

## Prerequisites

- Node ≥ 20 (repo tested on v24)
- pnpm 9 (`npm i -g pnpm@9` or via corepack)
- Docker + Docker Compose (for the local dev stack)

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template
cp .env.example .env

# 3. Bring up the dev stack (Postgres, Redis, MinIO, ClamAV, Mailhog)
pnpm docker:up

# 4. Run database migrations + seed
pnpm db:migrate
pnpm db:seed

# 5. Start everything
pnpm dev
```

| Service | URL |
|---|---|
| Internal app | http://localhost:3000 |
| Client portal | http://localhost:3001 |
| API | http://localhost:4000 |
| MinIO console | http://localhost:9001 |
| Mailhog (dev email) | http://localhost:8025 |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all apps in dev mode |
| `pnpm build` | Build all packages/apps |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm docker:up` / `pnpm docker:down` | Manage the local dev stack |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma migrate / seed |
