# Session handoff — 25 July 2026

Everything below reflects the state of the repo and the live system as of the end of
this session. Written so a fresh assistant (or a future you) can pick up without
re-deriving anything.

---

## 1. The one-line status

Two big pieces of work happened today. **The desktop-app work is live in production.
The ERP work is not — it exists only as uncommitted changes on this machine and in the
local dev database.**

| Thing | Code | Local DB | Production |
|---|---|---|---|
| Desktop app 0.2.6 | committed + pushed | — | ✅ live, published 25 Jul 11:51 IST |
| Idle threshold = 10 min | code default aligned | ✅ | ✅ already 10 (set 15 Jul) |
| PM role removed | uncommitted | ✅ migrated | ❌ untouched |
| Project "type" removed | uncommitted | ✅ migrated | ❌ untouched |
| Project/task UI rework | uncommitted | n/a | ❌ untouched |

**Nothing is committed. Nothing is deployed.** Production still has the PM role and the
old forms.

---

## 2. Part one — desktop app (already live, closed out)

- Current version **0.2.6**, published to the live update feed at
  `https://api.52digit.com/desktop-updates/` on 25 Jul 06:21 UTC (11:51 IST).
- Installed locally at `%LOCALAPPDATA%\Programs\Rademics Work Monitoring App`.
- **Release process** (memory: `desktop-app-release-process`):
  1. bump `version` in `apps/desktop/package.json`
  2. commit + push to `main`
  3. GitHub → Actions → **Desktop Installer** → Run workflow → `publish: true`
  4. website download updates immediately; installed apps self-update within ~4h
- **Gotchas:** always bump the version; `publish:false` is a test build only;
  publishing starts a 24h clock after which older apps are blocked from login;
  **never rename the installer file** (the website hardcodes
  `Rademics-Work-Monitoring-Setup.exe`).
- **Resolved incident:** a Download 404 on 25 Jul ~08:37 IST. Cause: the website was
  deployed pointing at the renamed installer several hours before that installer was
  uploaded. Fixed when the file went live at 11:51 IST. Prevention: publish the
  installer *before* deploying the website, or read the filename from `version.json`
  instead of hardcoding it (`apps/api/src/desktop/desktop.controller.ts:34`).

### How idle time works (verified in code)
- Desktop app polls Windows every **20 s** for keyboard/mouse activity across the whole
  PC; sends a heartbeat only if there was activity (`apps/desktop/src/main/idle-tracker.ts`).
- Server decides what counts as idle (`apps/api/src/attendance/attendance.service.ts:253-257`):
  gap ≤ threshold → 0; gap > threshold → **the whole gap counts**, not just the excess.
- Idle is clipped to the shift window **09:00–18:00**.
- Idle does **not** reduce worked hours and does **not** sign anyone out.
- Threshold lives in Admin Settings (DB), **not** in the app — changing it needs no
  release. Production has had `idleMinutes: 10` since 15 Jul.

---

## 3. Part two — the PM role is gone (main work, NOT deployed)

### The decision
PM stopped being a role. Running a project is now an **appointment**: HR or Super Admin
put someone in a project's `pmId`, and that person gets project powers **for that project
only**. Anyone can be appointed regardless of role; removing them removes the powers.

Roles are now **six**: `SUPER_ADMIN, HR, TEAM_LEAD, EMPLOYEE, CLIENT, FINANCE`.

### What the appointed manager can do (on their project only)
create tasks · assign/reassign · approve or send back submitted work · close/cancel
tasks · edit and close the project · see its budget · assign a freelancer.

### Deliberately NOT given to the appointment
- `leave.approve_team`, `attendance.team.view`, `attendance.regularization.approve` —
  these follow **reporting lines**, not projects. Managing a project must never grant HR
  powers over people you don't manage.
- **Creating** projects (company-level; HR/SA only — an appointee edits/closes their own).
- Freelancer contracts/NDAs (company legal documents).

### How it's enforced
- `TasksService.assertProjectAuthority()` — passes if the role holds the capability
  outright (HR/SA) **or** the caller is the project's `pmId`.
- `TransitionActor` `'PM'` → **`'PROJECT_MANAGER'`** in `packages/types/src/task-status.ts`;
  resolved against the task's project in `assertActor()`.
- Several task/project routes **dropped their `@RequireCapability` decorator** because a
  fixed capability key cannot express "appointed to this project" — the guard would 403
  an appointed Employee before the service could check. The service now checks. Affected:
  `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/assign`, `POST /tasks/:id/checklist`,
  `PATCH /projects/:id`, and `GET /projects/assignable-users` (auth-only now).
- New endpoint: `GET /projects/appointable-managers` (HR/SA) → who can be appointed.

### Knock-on changes
- **Leave chain** was `TEAM_LEAD → PM → HR`, now **`TEAM_LEAD → HR`**. A project
  appointment cannot stand in as a leave approver (someone may run several projects or
  none). `LeaveApprovalLevel` enum lost its `PM` value.
- Matrix went from 7-char to **6-char** seed strings (44 rows) in
  `packages/permissions/src/matrix.ts`. HR gained the project/task capabilities.
- `hourlyCostRates.PM` removed from business rules.
- Budget visibility: `SUPER_ADMIN, HR, FINANCE` + the project's appointed manager.
- `assertRefs()` now requires the appointee to be an **active internal** user — it
  previously accepted any user id, which was harmless as a label but is a privilege hole
  now the field carries authority.

### Migration
`apps/api/prisma/migrations/20260725093000_drop_pm_role/migration.sql`
- **Refuses to run if any user still holds PM** (raises an exception). Reassign first.
- Deletes PM rows from `role_capabilities`, rebuilds the `Role` and
  `LeaveApprovalLevel` enums (Postgres can't drop enum values in place).
- Production check before writing it: **0 PM users, 0 projects with a manager set, 0
  leave requests** — so nothing is silently reassigned there.
- The local dev DB *did* have 45 PM users; they were reassigned to EMPLOYEE by hand
  before the migration would run.

---

## 4. Part three — project "type" removed

`PROJECT` vs `STREAM` ("fixed scope" / "continuous") decided exactly one thing: whether
an end date was allowed. That's already expressed by the end date itself.

- Dropped the `type` column, the `cadence` column and the `ProjectType` enum
  (`migrations/20260725120000_drop_project_type/`).
- Removed from the create form, the DTOs, the service and the badges.
- The project status report's "Type" column became **"Ends"** — shows the date or
  **"Ongoing"**.
- ⚠️ The API now **rejects** requests containing `type` (`property type should not exist`)
  because validation is whitelist-based. Nothing sends it any more.

---

## 5. Part four — project & task UX

**New project form** is now just: Name · Description · **Project manager (optional)**.
The manager dropdown explains what the appointee gets.

**New task form** — was Title/Priority/Module/Estimate/Deadline with **no assignee at all**
(the API accepted `assigneeId` on create; the service silently dropped it, which is why
creating and assigning were two steps).
Now: *What needs doing?* · Details · **Assign to** · Priority + Deadline · client checkbox.
Button reads **"Create & assign"** or **"Create draft"**. Module only appears if the
project has modules; Estimate is behind an "Add a time estimate" link (both are
**read-only in the task drawer**, so they can't be removed outright without losing the
ability to set them).

**Project page** — empty state with a "Create the first task" action instead of ten empty
columns; progress strip (% done · finished · in progress · unassigned · overdue); board
shows only the five working columns plus any later stage that holds a task; "No project
manager" reads as an amber prompt.

**Task drawer** —
- the red **Cancel** button sat below the ✕ and destroyed the task on one click; it is now
  a quiet **"Cancel task"** with a confirm panel ("Keep it" / "Cancel the task")
- `window.prompt()` for send-back/cancel reasons replaced with an inline panel
- empty MODULE/ESTIMATE rows hidden; Priority is now a badge; deadline shows
  "3 days late"; unassigned shows amber "Nobody yet"

---

## 6. Files changed (32 modified, 4 new — all uncommitted)

**Permissions/types:** `packages/permissions/src/{roles,matrix,matrix.test}.ts`,
`packages/types/src/{task-status,business-rules}.ts`

**API:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/demo-seed.ts`,
`apps/api/scripts/verify-phase{4,5,6,7,8}.ts`,
`apps/api/src/projects/{dto,projects.controller,projects.service,tasks.controller,tasks.service}.ts`,
`apps/api/src/leave/leave.service.ts`, `apps/api/src/reports/reports.service.ts`,
`apps/api/src/attendance/attendance.service.ts`,
`apps/api/src/portal/client-onboarding.flow.test.ts`

**Internal app:** `apps/internal/src/app/(app)/projects/{page,[id]/page}.tsx`,
`apps/internal/src/components/projects/{task-detail-drawer,task-files}.tsx`,
`apps/internal/src/components/dashboard-overview.tsx`, `apps/internal/src/lib/nav.ts`,
plus `(app)/{attendance,dashboard,layout,leave,people/new}`

**New:** two migration folders, `apps/api/src/projects/project-authority.test.ts`

---

## 7. Tests

`pnpm typecheck` → clean. `pnpm test` → **97 passing** (types 6, permissions 31, api 60).

New suite `project-authority.test.ts` covers the security boundary specifically:
role-holder allowed · appointed manager allowed on their project · **appointed manager
refused on a different project** · unappointed employee refused · SCOPED grant alone is
not permission.

Verified against the running server too:

| Attempt (as an ordinary Employee) | Result |
|---|---|
| create task before being appointed | 403 |
| appointed by Super Admin, then create on that project | 201 |
| create on a different project | 403 |
| create task with `assigneeId` | returns status **ASSIGNED**, not DRAFT |

---

## 8. Running it locally

```bash
pnpm docker:up                              # postgres, redis, minio, mailhog
pnpm --filter @rademics/api dev             # :4000  (health /api/health)
pnpm --filter @rademics/internal dev        # :3000
```

- Prisma CLI needs `DATABASE_URL` exported, or use the package scripts which load
  `../../.env`:
  `export DATABASE_URL='postgresql://rademics:rademics_dev_pw@localhost:5432/rademics?schema=public'`
- **Do not run two Next dev servers from the same app folder** — they share
  `apps/internal/.next` and corrupt each other's routes (symptom: server returns 200 but
  the browser shows "Nothing lives at this address"). Fix: kill both, `rm -rf
  apps/internal/.next`, start one. For a second logged-in user use an **incognito window**,
  not a second port.
- CORS only allows `http://localhost:3000` and `:3001` (`apps/api/src/main.ts:34-40`).
  A different port fails with a generic "Invalid email or password".
- `prisma generate` fails with EPERM while the API is running — stop it first (including
  the `nest`/`dotenv-cli` watcher processes, not just the port listener).

### Local test data
The dev DB was wiped of demo content this session and reseeded:
**0 projects/tasks/invoices/attendance, 9 users.**

- Super Admin: `editor.publicationmart@gmail.com` — password is in **`DEMO_LOGINS.md`**
  (git-ignored; deliberately not repeated here).
- Test accounts, all password `Test1234!`: `hr@test.local`, `lead@test.local`,
  `devi@test.local`, `arjun@test.local`, `meera@test.local`, `finance@test.local`,
  `freelancer@test.local`, `client@test.local`.
- A full pre-wipe backup exists at
  `<scratchpad>/backup-before-wipe.sql` (~1.3 MB) if the old demo data is ever wanted.
  ⚠️ Caution learned the hard way: `TRUNCATE ... CASCADE` on `client_orgs` cascades into
  `users` and deletes every account. Use targeted `DELETE`s.

---

## 9. What's still open

1. **Three routes not yet project-scoped** — an appointed manager still cannot
   `files.mark_client_visible`, `files.delete_version`, or `finance.expenses.log`.
   `apps/api/src/files/files.controller.ts:41,52` are still role-gated. This matters:
   the manager can approve a client-facing task but **cannot release the file to the
   client**, so the client handover is half-built.
2. **Commit, push, deploy.** Nothing has left this machine. Deploy = GitHub → Actions →
   **Deploy** workflow (manual, prod). Migrations run on API boot.
3. **Board still scrolls sideways** slightly at 5 columns.
4. **"0% done"** renders as a flat grey bar; might read better as "Not started".
5. **"Acknowledge" shows for Super Admin** though acknowledging is the assignee's action.
6. Pre-existing, unrelated to this work: **no way to change a user's role after creation**
   (the edit-employee form has no role field, and `people.roles.assign` is defined in the
   matrix but wired to no endpoint — so HR can also mint any role at creation, including
   Super Admin).
7. **Website attendance card shows stale "Checked out"** after checking in on the desktop
   app until the page is refreshed (`attendance-context.tsx:80-91` only polls when it
   already believes you're checked in).

---

## 10. Useful context about the live system

- VPS `187.127.145.132`, `/opt/rademics-erp`, keyless SSH with `~/.ssh/id_ed25519`.
- Staff app **rademics.52digit.com** · client portal **clientportal.52digit.com** ·
  API **api.52digit.com** · `52digit.com` itself is a placeholder page.
- Postgres runs in `rademics-erp-postgres-1`; DB user is `rademics`, database `rademics`.
- Business rules live in the `settings` table under key `business_rules` (JSON) and
  override the code defaults in `packages/types/src/business-rules.ts`.
