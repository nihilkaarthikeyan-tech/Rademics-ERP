# Rademics ERP — Deployment & Operations Runbook

> Go-live and day-2 operations for Rademics ERP V1 (Spec §10, §11, §12; phase.md Phase 10).
> Three deployables: **API** (NestJS), **internal** app (Next.js), **portal** app (Next.js),
> plus stateful infra (Postgres, Redis, MinIO/S3, ClamAV, SMTP).

Items marked **[needs VPS/domains]** are blocked on the one hard external dependency
(a Linux VPS + DNS, Spec §12 / Assumption #12). Everything else is runnable today.

---

## 1. Architecture at deploy time

```
              Cloudflare (DNS, TLS, WAF, caching)
                        │
                  Nginx reverse proxy (TLS termination)
        ┌───────────────┼─────────────────────┐
   app.rademics.*   portal.rademics.*     api.rademics.*
   (internal Next)  (portal Next)         (NestJS API)
                                              │
        ┌──────────────┬───────────┬──────────┴────────┐
     Postgres        Redis       MinIO/S3            ClamAV
     (primary)     (BullMQ +    (files, §5.6)     (virus scan)
                   presence)
                                              │
                                        SMTP relay (§5.1 email)
```

- The API is the only service that touches Postgres/Redis/MinIO/ClamAV. The two Next
  apps talk **only** to the API over HTTPS (`NEXT_PUBLIC_API_URL`).
- Client portal is a **separate origin** (own subdomain) so client and internal
  sessions can never cross (Spec §5.1, §5.5).

---

## 2. Environment configuration

Copy `.env.example` → `.env` and set real values. Secrets live **server-side only**
(Spec §10) — never in the Next public bundle except the two `NEXT_PUBLIC_*` values.

Required per deployable:

| Var | Where | Notes |
|---|---|---|
| `DATABASE_URL` | API | Postgres connection string |
| `REDIS_URL` | API | BullMQ + presence |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | API | ≥16 chars, unique per env |
| `FIELD_ENCRYPTION_KEY` | API | salary/PII encryption (§10) — **rotating it makes existing ciphertext unreadable** |
| `S3_*` | API | MinIO/S3 endpoint + creds |
| `CLAMAV_HOST` / `CLAMAV_PORT` | API | virus scan (§5.6) |
| `SMTP_*` | API | outbound email |
| `SENTRY_DSN` | API + both Next (server) | empty = disabled (no-op) |
| `NEXT_PUBLIC_SENTRY_DSN` | both Next (browser) | empty = disabled |
| `NEXT_PUBLIC_API_URL` | both Next | e.g. `https://api.rademics.example/api` |
| `INTERNAL_APP_URL` / `PORTAL_APP_URL` | API | CORS allow-list origins |

> ClamAV `StreamMaxLength` must be raised above the largest allowed upload
> (`fileUploadLimitMb`, default 100 MB) or scans of large files fail (Spec §5.6 note).

---

## 3. First deploy

1. **Provision** the VPS; install Docker + Docker Compose. **[needs VPS/domains]**
2. **Infra**: bring up Postgres, Redis, MinIO, ClamAV via compose (see `docker-compose.yml`).
   Use managed Postgres if available; otherwise ensure nightly backups (§6).
3. **Build**: `pnpm install --frozen-lockfile && pnpm -r build`.
4. **Migrate**: `pnpm --filter @rademics/api exec prisma migrate deploy`.
5. **Seed baseline**: `pnpm --filter @rademics/api db:seed`
   (roles/capability matrix §3, business-rule defaults §4, one Super Admin).
6. **(Staging/demo only) rich dataset**: `pnpm --filter @rademics/api demo:seed`
   (all roles, 2 depts/3 teams/~15 users, 1 client org + 3 client users, 2 projects +
   1 stream, tasks across every status, sample invoices + leave).
7. **Start** the three services (systemd units / compose / PM2). The API schedules its
   repeatable jobs on boot (overdue sweep, leave accrual + escalation, retention purge).
8. **Reverse proxy + TLS**: Nginx per subdomain, certs via Cloudflare/Let's Encrypt. **[needs VPS/domains]**
9. **Smoke check**: `GET https://api.…/api/health` → `{status:"ok",db:"up"}`; log in as
   Super Admin; change the seeded password immediately.

---

## 4. CI/CD (GitHub Actions, Spec §12)

- **On PR / push**: lint, typecheck, test, build — [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- **On merge to main**: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the
  same verify gate, then rsyncs the commit to the VPS and rebuilds **staging** in place
  (`docker compose build && up -d`), `prisma migrate deploy` runs in the api container's
  start command, then a `GET /api/health` gate — rolls back to the `:rollback`-tagged
  image on failure. This replaces the old manual SFTP push (which let the VPS and git drift).
- **Deploy to prod**: same workflow, **manual** "Run workflow" → target `production`
  (so §11's staging-first policy is a deliberate act, not an accident of merging).
- **Release policy (§11)**: any change touching **Attendance or Payroll** ships to
  **staging first** and is validated there before production.

**Activation (one-time), all [needs VPS/domains]:**
1. Add repo secrets `DEPLOY_SSH_KEY` (private half of the `claude-ops` ed25519 key),
   `DEPLOY_HOST`, `DEPLOY_USER`. The public half must be in the VPS's
   `/root/.ssh/authorized_keys`.
2. On the VPS: `cp .env.staging.example .env.staging` and fill fresh staging-only
   secrets (never copy prod's — see the file header).
3. Bring staging up once manually (see `docker-compose.staging.yml` header), seed it with
   `demo:seed` (anonymized data, never prod PII).
4. nginx: point `staging.52digit.com` / `staging-clientportal.52digit.com` /
   `staging-api.52digit.com` / `staging-storage.52digit.com` at `127.0.0.1:3100/3101/3102/9100`.

---

## 5. Observability (Spec §11)

### 5.1 Error reporting — Sentry

- Set `SENTRY_DSN` (+ `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_PORTAL_SENTRY_DSN`). Confirm
  each deployable reports:
  - API — `GET /api/health/debug-sentry` as Super Admin (throws a 500 → captured).
  - internal / portal — open `/debug-sentry`, click "Throw unhandled error".
- Only **5xx** reaches Sentry. 4xx (401/403/404/validation) is expected traffic and is
  never reported, so the issue stream stays signal.
- Every event carries `request_id`, `release`, and — once authenticated — the user id
  plus `user_role` / `resource_type` tags. No email or name is sent (`sendDefaultPii:false`);
  the audit log stays the system of record for who-did-what.

### 5.2 Getting told — email alert rules **[ops task, Sentry dashboard]**

Capture without delivery is just a log nobody reads. In **each** of the two Sentry
projects (internal and portal) plus the API project: **Alerts → Create Alert → Issues**.

| Rule | Condition | Action |
| --- | --- | --- |
| New issue | A new issue is created | Email your address |
| Regression | An issue changes state from resolved to unresolved | Email |
| Spike | An issue is seen more than 20 times in 1 hour | Email |

Set **Alerts → Settings → personal notifications** to "on" for these, and verify delivery
by triggering `/api/health/debug-sentry` — if no mail arrives, the rest of this section is
decorative. Check spam once, then allowlist `noreply@md.getsentry.com`.

### 5.3 Knowing it's down — uptime monitoring **[ops task, external]**

Critical: if a container is down, Sentry receives **nothing**. Silence looks identical to
"no errors", so an external poller is the only thing that catches a total outage.

`GET /api/health` is the probe. **The status code is the contract**: `200` healthy,
`503` degraded (DB unreachable). The body carries `{status, db, release, time}` — `release`
is useful to confirm which build is actually live.

Point any external monitor (Better Stack, UptimeRobot, or Sentry's own Uptime Monitors)
at `https://api.<domain>/api/health` every 1–5 min, alerting to the same email after 2
consecutive failures. It **must** run off-VPS — a monitor on the box it watches dies with it.

### 5.4 Releases + source maps

`SENTRY_RELEASE` (the deployed git SHA) tags every event and keys the source map upload.
Without a matching release the browser stack traces stay minified and unreadable.

Export it **before building** so it reaches both the build args and the runtime env:

```sh
export SENTRY_RELEASE=$(git rev-parse --short HEAD)
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api internal portal
```

Source map upload additionally needs `SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_PORTAL_PROJECT` and `SENTRY_AUTH_TOKEN` at **build** time. Scope the token to
`project:releases` only. It is passed inline to the build step, never as an `ENV`, because
the build stage is also the runtime image — an `ENV` would bake the token into every
running container. If any of the four is unset the build still succeeds and errors still
report; only the un-minifying is lost.

### 5.5 Correlating a user report

Every response carries an `X-Request-Id` header, and 5xx bodies include `requestId`. When a
user reports a failure, search Sentry for `request_id:<value>` to land on the exact event.
An inbound `X-Request-Id` is reused when it's well-formed, so one id survives a
portal → API hop.

### 5.6 Metrics + logs

- **Prometheus**: scrape `GET /api/metrics` (Node process metrics + `http_requests_total`
  + `http_request_duration_seconds`). Firewall this path to the monitoring network in prod.
  Nothing scrapes it yet — no Prometheus service is in `docker-compose.prod.yml`. **[ops task]**
- **Grafana**: point at Prometheus; build request-rate / p99-latency / error-rate panels. **[ops task]**
- **Structured logs**: NestJS logger to stdout; ship to your log stack.

---

## 6. Backup & restore drill (Spec §10)

- **Postgres**: nightly `pg_dump` (or managed snapshots) retained ≥30 days, off-box.
- **Object storage**: MinIO/S3 bucket replication or versioning for file assets.
- **Restore drill (do at least once before go-live, then quarterly)** **[needs VPS/domains]**:
  1. Spin up a scratch DB; `pg_restore` the latest dump.
  2. Restore an object-storage snapshot to a scratch bucket.
  3. Boot the API against both; run `GET /api/health` + `verify:phase8` (finance is the
     most integrity-sensitive path). Record RTO/RPO in the ops log.

---

## 7. Scheduled jobs (run automatically by the API)

| Job | Schedule | Effect |
|---|---|---|
| Finance overdue sweep | 00:20 daily | past-due unpaid invoices → Overdue (§5.8) |
| **Data-retention purge** | 00:40 daily | notifications > 90d + monitoring sessions > 12mo hard-deleted, **audit-logged** (§4, §10, §25) |
| Leave monthly accrual | 01:10 on the 1st | idempotent per period (§5.7) |
| Leave 48h escalation | hourly | unactioned requests bump a level (§5.7) |
| Attendance nightly compute | nightly | late/half-day/overtime + auto-close (§5.3) |

Retention windows are **config-driven** in Admin Settings (`inAppNotificationRetentionDays`,
`monitoringRetentionMonths`) — never hardcoded. On-demand run (Super Admin):
`POST /api/admin/retention/run`.

---

## 8. Security posture (Spec §10, verified by `verify:phase10`)

- Every business endpoint declares a capability; missing/insufficient → **fail closed**
  (401/403). Verified across the surface by `verify:phase10`.
- Client ↔ internal **session isolation**; client-facing identifiers are **UUIDs** (no
  enumeration).
- Auth **rate limit / lockout** (5 failures → 15-min lock); **AI per-user daily limit** → 429.
- **CSP + security headers** on all three apps (strict `default-src 'none'` on the API;
  locked policy + HSTS + `X-Frame-Options: DENY` on the Next apps).
- Presigned upload/download URLs expire in minutes; secrets stay server-side.

---

## 9. Performance / load

- Local smoke test: `pnpm --filter @rademics/api loadtest` — 100 concurrent connections,
  asserts 0 errors and p99 ≤ 750 ms on a public and an authenticated path.
- **[needs VPS/domains]** Full staged 100-user load test on production-like hardware and
  the "< 2s interactive on mid-range phone / 4G" target (Spec §11) are validated on
  staging before go-live.

---

## 10. Rollback

- **App**: redeploy the previous image/tag (services are stateless).
- **DB**: migrations are additive; prefer a forward-fix migration. Restore from backup
  only as a last resort (§6) — never hand-edit the audit log (append-only, §5.10).
