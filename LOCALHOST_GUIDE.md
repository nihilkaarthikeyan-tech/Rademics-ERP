# Rademics ERP — Localhost Walkthrough

Everything runs locally on your machine. Nothing here touches the internet except the AI calls.

## 1. The three apps (already running)

| App | URL | Who logs in here |
|---|---|---|
| **Internal app** | http://localhost:3000 | Your staff (all roles except Client) |
| **Client portal** | http://localhost:3001 | Client users only |
| **API** | http://localhost:4000/api | (backend — no UI; `/api/health` should say `ok`) |

Supporting services (Postgres, Redis, MinIO, ClamAV, Mailhog) run in Docker and are already up.

## 2. Login credentials

### Internal app → http://localhost:3000

**Your real owner account (Super Admin — sees everything):**
- **Email:** `editor.publicationmart@gmail.com`
- **Password:** `Pz79xXUqLpHMsdWwpW#7`

**Demo staff accounts** (explore role-by-role) — **password for all: `Demo1234!`**

| Role | Email |
|---|---|
| Super Admin | `admin.demo@rademics.local` |
| HR | `hr.demo@rademics.local` |
| Finance | `finance.demo@rademics.local` |
| Project Manager | `pm.demo@rademics.local` |
| Team Lead | `tl.frontend@rademics.local` |
| Employee | `emp.rohan@rademics.local` |
| Freelancer | `freelancer.demo@rademics.local` |

### Client portal → http://localhost:3001

**Password for all: `Demo1234!`**

| Access | Email |
|---|---|
| Approver (can approve deliverables) | `client.owner@northwind.example` |
| Viewer (read-only) | `client.viewer1@northwind.example` |

> The portal only accepts CLIENT accounts; the internal app rejects them — that's the isolation working.

## 3. What to try

**As Super Admin (internal, :3000):**
- Dashboard → your role's landing view.
- People → the seeded org (Publications + Engineering depts, 3 teams, ~15 people).
- Projects → "Journal Platform Revamp" has tasks in **every** status; open the board/list.
- Finance → invoices (one partially paid, one paid), P&L, payroll.
- Reports → attendance / productivity / project-status, export CSV/PDF.
- Assistant → the AI chat (see §4).
- Settings → every business rule you confirmed (working hours, leave quotas, GST, etc.). **Add your invoice GSTIN here.**

**As different roles:** log out, log in as `pm.demo` / `hr.demo` / `emp.rohan` etc. to see how the screens and permissions change.

**As a client (portal, :3001):** log in as `client.owner@northwind.example` → you see only Northwind's scoped projects, shared files, and invoices — no internal data.

## 4. Turn ON live AI (one restart)

Your Anthropic + OpenAI keys are verified working, but the running API loaded its environment **before** you added them, so AI is currently on the safe rule-based fallback. To switch to live Claude:

1. Go to the terminal running the API (`pnpm dev` / the API dev server).
2. Press **Ctrl+C**, then start it again (same command).
3. Wait for `Rademics API listening on http://localhost:4000/api`.

Now the Assistant, daily summaries, and forecasts use **Claude Haiku 4.5**. (Every AI answer is labeled "AI-generated".)

## 5. If something isn't running

From the repo root (`d:\Rademics ERP`):

```bash
pnpm docker:up      # start Postgres/Redis/MinIO/ClamAV/Mailhog (if down)
pnpm dev            # start all three apps (internal + portal + API)
```

- Emails (invites, resets, notifications) are caught locally by **Mailhog** → http://localhost:8025
- Reset your data anytime: `pnpm --filter @rademics/api db:seed` (baseline) + `pnpm --filter @rademics/api demo:seed` (demo data).

## 6. Security reminder
🔒 Rotate your Anthropic + OpenAI keys before real go-live — they appeared in screenshots during setup, so treat them as exposed.
