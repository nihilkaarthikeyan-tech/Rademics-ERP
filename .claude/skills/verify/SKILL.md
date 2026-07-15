---
name: verify
description: Build/launch/drive recipe for verifying Rademics ERP changes locally (API + internal app + portal).
---

# Verifying Rademics ERP locally

## Services
Postgres/Redis/MinIO/ClamAV/Mailhog run in Docker: `pnpm docker:up` (usually already up — check `docker ps`).

## Launch
- API: `pnpm --filter @rademics/api dev` → http://localhost:4000/api (health: `/api/health`).
- Internal app: `pnpm --filter @rademics/internal dev` → http://localhost:3000.
- Portal: `pnpm --filter @rademics/portal dev` → http://localhost:3001.
- Gotcha: stale dev servers often hold ports 3000/4000 — find with `Get-NetTCPConnection -LocalPort <port> -State Listen`, kill, restart, so you know which code is serving.

## Logins
Demo accounts and passwords live in `DEMO_LOGINS.md` (git-ignored on purpose — never copy credentials into committed files). One demo account exists per role.
Turnstile no-ops when `TURNSTILE_SECRET_KEY` is unset, so scripted login works locally.

## Drive the API
`POST /api/auth/login {email,password}` → `{accessToken}`; pass `authorization: Bearer <token>`.

## Drive the UI (no playwright installed)
Headless Chrome + raw CDP works — see the pattern in a scratchpad `drive.mjs`:
launch `chrome.exe --remote-debugging-port=9777 --user-data-dir=<tmp> --headless=new`,
fetch `/json/list`, connect native WebSocket (Node ≥21), `Page.navigate` / `Runtime.evaluate` /
`Page.captureScreenshot`. React-controlled inputs need the native-setter trick
(`Object.getOwnPropertyDescriptor(proto,'value').set.call(el, v)` + `input` event) before `.click()` on submit.
Access token lives in `localStorage['rademics_at']`.

## Gotchas
- Dev mode shows the Next.js "N" badge bottom-left — not present in prod builds.
- Reset demo data: `pnpm --filter @rademics/api db:seed` then `demo:seed`.
