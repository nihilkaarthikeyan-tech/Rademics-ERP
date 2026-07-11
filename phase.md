# RADEMICS ERP — Phase-by-Phase Build Plan

> Execution plan for building Rademics ERP V1, derived from **[RADEMICS_ERP_SPEC.md](RADEMICS_ERP_SPEC.md) Section 14** and expanded into concrete, buildable work items.
> **Rule:** Do not start a later phase before the "Done" criteria of the phases it depends on are met (Spec §0, §14).
> Total target: **13–15 weeks to V1 go-live** (one experienced dev + AI assistant).

---

## How to use this file

- Each phase has: **Goal · Depends on · Work breakdown · Deliverables · Done criteria (from Spec §13) · Spec refs**.
- Check items off as they complete. A phase is closed only when every "Done" box is ticked.
- "Cross-cutting" items (below) are wired in **Phase 1** and respected in **every** phase after — they are not optional add-ons.
- Spec references like `§5.3` point to sections in `RADEMICS_ERP_SPEC.md`.

---

## Proposed technical decisions (within Spec §12 constraints)

These are the implementer choices the spec delegates to us. Locking them now so every phase is consistent.

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo tooling | **pnpm workspaces + Turborepo** | Fits Next.js + NestJS + shared packages; fast caching for CI. |
| Repo layout | `apps/internal` (Next.js), `apps/portal` (Next.js), `apps/api` (NestJS), `packages/*` (shared) | Spec §12 requires single monorepo: internal app, client portal, backend, shared packages. |
| Shared packages | `packages/types` (shared DTOs/enums), `packages/config` (eslint/ts/tailwind), `packages/ui` (shadcn component set), `packages/permissions` (capability keys + matrix seed) | One component set across both apps (§9); one permission source (§3). |
| Local dev env | **Docker Compose**: Postgres, Redis, MinIO, ClamAV, Mailhog (dev SMTP) | Mirrors production stack (§12); Mailhog lets us test email without a real provider. |
| API style | REST + DTO validation (NestJS); OpenAPI generated | Spec is REST-shaped; keeps client portal + internal app on one contract. |
| Auth transport | JWT access (short-lived) + refresh (httpOnly cookie, rotated) | §5.1, §10. |
| Testing | Vitest/Jest unit + Supertest e2e (API), Playwright (critical UI flows) | Needed for isolation tests, state-machine tests, EICAR test (§13). |

> **Note:** These are defaults chosen to move fast; all are reversible until Phase 1 lands. The one hard external dependency is a Linux VPS for staging/prod (Spec §12, Assumption #12) — not needed until Phase 10 but provision early.

---

## Cross-cutting foundations (wired in Phase 1, enforced in ALL phases)

These are the non-negotiables that must be present from day one, not retrofitted:

1. **RBAC at the API layer** — every endpoint declares a required capability key; missing check = **fail closed** (§10). The permission matrix (§3) is seeded as capability-keys-per-role, editable by Super Admin.
2. **Audit-log hook** — a single interceptor that records actor, action, entity, before/after, timestamp, IP for every sensitive action (§5.10). Append-only, no delete path.
3. **Everything sensitive is scoped** — `S` (scoped) enforcement (own team / own projects / own record) lives in a reusable guard, not copy-pasted (§3 scoped definitions).
4. **UUIDs for all client-facing identifiers** — no sequential IDs exposed; isolation is testable (§10).
5. **Queue for all long work** — AI, PDF, email, exports, virus scans never block an HTTP request (§11). BullMQ from Phase 1.
6. **All times stored UTC**, displayed in company timezone; server time only for attendance (§25 clock skew).
7. **Soft-delete/deactivate only** — nothing user-facing is hard-deleted in V1 (§25 deletion policy).
8. **Every screen has empty/loading/error states** — no blank whitescreens (§8, §9).
9. **User-facing strings centralized** — future Tamil translation is a content task (§9).
10. **Field-level encryption at rest** for salary/PII (§10) — the encryption helper exists before any salary field is stored (Phase 2).
11. **Config-driven business rules** — Section 4 values live in Admin Settings, never hardcoded (§4).
12. **Sentry + structured logging** wired in all three deployables from Phase 1 (§11).

---

## Phase 0 — Prerequisites & Decisions (before Phase 1)

**Goal:** Remove every blocker so Phase 1 can run end-to-end locally.

**Work breakdown:**
- [ ] Confirm local tooling: Node LTS (≥20), pnpm, Docker Desktop, Git.
- [ ] Confirm/collect deferred inputs (all have safe defaults — none block start, per §15):
  - Brand hex codes + logo (default navy `#1B2A4A` / blue `#2563EB` / gold `#C9A227` until provided).
  - SMTP provider (default: Mailhog locally, generic SMTP config in prod).
  - AI provider keys (gateway works without keys; features degrade gracefully — §25).
  - VPS for staging (needed by Phase 10).
- [ ] `git init` + initial commit + `.gitignore` + branch strategy.
- [ ] Decide repo hosting (GitHub, for Actions CI/CD per §12).

**Done:** `docker compose up` brings Postgres+Redis+MinIO+ClamAV+Mailhog healthy locally; repo initialized and pushed.

---

## Phase 1 — Foundation · 1.5 weeks

**Goal:** A running monorepo where a user can log in, the API enforces RBAC, and every sensitive action is audited — the skeleton every later phase hangs off.

**Depends on:** Phase 0.

**Work breakdown:**
- [ ] Monorepo scaffold (pnpm + Turborepo): `apps/internal`, `apps/portal`, `apps/api`, `packages/*`.
- [ ] Docker Compose dev environment (Postgres, Redis, MinIO, ClamAV, Mailhog) + `.env` templates.
- [ ] GitHub Actions CI: lint, typecheck, test, build on every PR.
- [ ] Prisma init + initial migration (users, roles, capabilities, audit_log, sessions, settings tables).
- [ ] **Auth (§5.1):** email+password, JWT access + refresh (rotation, httpOnly cookie), logout revokes refresh, invite-email + set-password link, forgot-password (30-min link), failed-login lockout (5 → 15 min), account-lockout email.
- [ ] **RBAC middleware/guard (§3, §10):** capability keys seeded per role from the §3 matrix; `@RequireCapability()` decorator; fail-closed default; scoped-guard scaffold.
- [ ] **Audit-log interceptor (§5.10):** append-only, actor/action/entity/before-after/timestamp/IP.
- [ ] BullMQ queue bootstrap + a sample job (email send via Mailhog).
- [ ] Sentry wired in all three deployables; health-check endpoints.
- [ ] Shared `packages/permissions` (capability keys + matrix seed) and `packages/types`.
- [ ] `packages/ui` bootstrap: Tailwind + shadcn, brand tokens (§9), base layout (sidebar §16, top bar), light mode + empty/loading/error primitives.
- [ ] **Seed script v1 (§11):** all 7 roles + a Super Admin so the system is usable on first run.
- [ ] Session timeout config (§4): 30 min Admin/Finance, 8 h others.

**Deliverables:** Login works for a seeded Super Admin; a protected endpoint returns 403 when capability is missing; an audit row is written on a sensitive action; CI green.

**Done (Spec §13 Auth & RBAC, partial):**
- [ ] All 7 roles can log in and land on a role-correct shell dashboard.
- [ ] A permission-matrix denial is **verified at the API**, not just hidden in UI.
- [ ] Invite, reset, lockout, and session-timeout flows all work.
- [ ] Audit entries are written and cannot be edited/deleted by any role.

**Spec refs:** §0, §3, §4, §5.1, §5.10, §9, §10, §11, §12, §16.

---

## Phase 2 — People & Org · 1 week

**Goal:** HR/Super Admin can run the full employee lifecycle; org structure and Admin Settings shell exist.

**Depends on:** Phase 1 (auth, RBAC, audit, encryption helper).

**Work breakdown:**
- [ ] **Employee profile (§5.2):** name, photo, contact, department, team, role, reporting manager, join date, employment status (active/on notice/exited), resource type (internal/freelance), skill tags, documents.
- [ ] **Field-level encryption at rest** for salary/PII (§10); salary visibility gated per matrix (§3).
- [ ] **Freelancer profiles (§5.2):** payment-per-deliverable terms, contract/NDA attachments, active-engagement flag; excluded from attendance/leave screens.
- [ ] **Org structure (§5.2):** Department → Team → Member; one Team Lead per team; department → business vertical mapping for P&L.
- [ ] Create → invite → activate → edit → deactivate lifecycle; deactivation revokes sessions + (task reassignment stub until Phase 4).
- [ ] **Role & permission editor (§3, §23):** grant/revoke capability keys per role.
- [ ] **Admin Settings shell (§4, §13.13, §23):** all Section 4 values editable (SA, HR subset); validation as a set (§24 Settings).
- [ ] Employee directory table with standards (§19): pagination, sort, filters, search, CSV export, saved filters, column toggle.
- [ ] Validation rules (§24 User/Employee): name/email/phone/employee-code/join-date/reporting-manager-no-cycle.

**Done (Spec §13 Employee/HR):**
- [ ] Create → invite → activate → edit → deactivate lifecycle works.
- [ ] Deactivation revokes access (task reassignment completed in Phase 4).
- [ ] Salary fields invisible to unauthorized roles **at the API**.

**Spec refs:** §5.2, §5.9 (skill tags surface), §3, §4, §10, §19, §23, §24.

---

## Phase 3 — Attendance · 1.5 weeks

**Goal:** Trustworthy attendance: multi-session, mobile-first check-in, idle tracking, nightly rule computation, regularization, and the real-time "who's online" bootstrap.

**Depends on:** Phase 1 (queue, real-time bootstrap), Phase 2 (employees, teams, rules in settings).

**Work breakdown:**
- [ ] **Multi-session model (§5.3):** each check-in/out pair = one session; daily total = sum. Single pair/day is rejected as the only model.
- [ ] Check-in/out capture timestamp + IP + device/user-agent; **excellent on mobile browser** (§5.3, §9).
- [ ] **Idempotent check-in/out** with client-generated key (§25 internet-drop).
- [ ] **Idle tracking (§5.3):** activity heartbeat; gap > threshold (default 5 min) accrues idle; **shown to employee immediately**.
- [ ] **Nightly job (§5.3, §4):** compute Late / half-day / overtime marks from configured rules; 3-lates rule.
- [ ] **Regularization (§5.3):** request with reason → TL (or HR if no TL) → approval updates record, logs correction, never overwrites original. Validation (§24): reason ≥10 chars, no overlap, not in locked payroll month.
- [ ] **Auto-close open session at 11:59 PM** flagged "auto-closed"; prompt to regularize next login (§5.3, §25).
- [ ] **Socket.IO real-time layer (§12):** per-user/per-team channel auth; "who is online now" (§5.3); WebSocket-unavailable fallback to 30s polling (§25).
- [ ] HR views (all attendance), TL/PM views (team, scoped); attendance table standards (§19).
- [ ] Employee dashboard check-in card (§17.1 widget 1), sticky on mobile.

**Done (Spec §13 Attendance):**
- [ ] Two sessions in one day sum correctly.
- [ ] Late/half-day/overtime computed per configured rules.
- [ ] Idle accrues and is visible to the employee.
- [ ] Regularization round-trips with approval + audit entry.
- [ ] Check-in/out works on a phone browser.

**Spec refs:** §5.3, §4, §9, §12 (Socket.IO), §17.1, §19, §24, §25.

---

## Phase 4 — Projects & Tasks · 2.5 weeks (largest phase)

**Goal:** The core work engine — full hierarchy, the exhaustive state machine with immutable history, three board views, comments, and the notifications core.

**Depends on:** Phase 1 (queue, audit), Phase 2 (users/teams), Phase 3 (real-time layer).

**Work breakdown:**
- [ ] **Hierarchy (§5.4):** Project → Module → Task → Subtask (subtasks one level deep only).
- [ ] **Work Streams (§5.4):** no end date, cadence-generated tasks, throughput-per-week reporting.
- [ ] Project fields incl. budget (visible PM/Finance/Admin only); task fields incl. estimate/actual hours, watchers, checklist, client-facing flag.
- [ ] **State machine (§6):** implement the 13 legal transitions exhaustively; **every illegal transition rejected at the API**; client-facing branch on Approve; mandatory comments on send-back/revision.
- [ ] **Immutable history (§6, §5.4):** from/to/actor/timestamp/comment on every transition; never editable — powers reports + AI later.
- [ ] Board (kanban) + list + calendar views with filters (§5.4); real-time board updates (§9).
- [ ] **Comments (§5.4, §24):** @mentions (resolve to users with access) → notification; internal vs client-visible distinction.
- [ ] **Deactivation task-reassignment (§25):** completes the Phase 2 stub — open tasks auto-return to Assigned, assignee cleared, TL notified.
- [ ] **Notifications core (§5.12):** in-app (real-time) + email via queue; per-user preferences (in-app / +email / mute); events: assigned/reassigned, review, sent-back, @mention, deadline-approaching (24h)/missed; retries 3× then log.
- [ ] Overdue = computed flag, not a status (§6, §25).
- [ ] Validation (§24 Task/Subtask): title, estimate 0.25–999 quarter-hour, freelancer assignable only by PM, cannot close with open subtasks.

**Done (Spec §13 Projects & Tasks + Notifications-core):**
- [ ] Full hierarchy creatable.
- [ ] Every legal transition works; **every illegal one rejected by the API**.
- [ ] History complete and immutable.
- [ ] Board, list, calendar filter correctly.
- [ ] Assignment/review/mention events fire in-app + email per preference.

**Spec refs:** §5.4, §6, §5.12, §9, §17 (TL/PM widgets), §19, §24, §25.

---

## Phase 5 — Files · 1 week

**Goal:** Safe, versioned file handling through object storage with virus scanning.

**Depends on:** Phase 1 (MinIO, queue), Phase 4 (tasks to attach to).

**Work breakdown:**
- [ ] **Presigned upload/download (§5.6, §10):** files never stream through the app server; URLs expire in minutes.
- [ ] **Versioning (§5.6):** every upload = new version; never overwrite; full history with uploader/timestamp.
- [ ] **ClamAV scan pipeline (§5.6, §12):** file unavailable until scan passes; infected → quarantined + uploader/PM notified + audit entry; other versions unaffected (§25).
- [ ] **Visibility flag (§5.6):** Internal (default) / Client-visible; flipping requires §3 permission + audit log.
- [ ] In-browser preview for images + PDF; else download.
- [ ] Files attach to tasks and to employee/freelancer profiles.
- [ ] Interrupted-upload handling: version recorded only after scan; daily cleanup of orphaned partials (§25).
- [ ] Validation (§24 Files): size ≤ max, extension not blocked, filename sanitized, version note ≤500 chars.
- [ ] Files table standards (§19).

**Done (Spec §13 Files):**
- [ ] Versioning never overwrites.
- [ ] An **EICAR test file** is caught and quarantined.
- [ ] Client-visible flag controls portal visibility exactly (verified in Phase 6).
- [ ] Presigned upload/download works for 100 MB files.

**Spec refs:** §5.6, §10, §12, §19, §24, §25.

---

## Phase 6 — Client Portal · 1.5 weeks

**Goal:** A separately deployed, strictly scoped portal where clients see progress, download shared files, and approve deliverables — with proven data isolation.

**Depends on:** Phase 1 (auth), Phase 4 (tasks/state machine), Phase 5 (files/visibility).

**Work breakdown:**
- [ ] **Separate app on its own subdomain (§5.5):** `apps/portal`; client sessions can never reach internal routes and vice versa (§5.1).
- [ ] **Multi-user client orgs (§2):** individual logins + per-user scope; Viewer vs Approver levels per project.
- [ ] **Scoped progress view (§5.5):** milestone status, % complete, shared updates; internal task details/assignee names/internal comments/internal files never leak.
- [ ] **Deliverable approval flow (§5.5, §6):** Client Review → Approvers notified → Approve or Request Revision (mandatory comment) → moves task per state machine → notifies PM.
- [ ] **UUID-only identifiers (§5.5, §10):** enumeration impossible.
- [ ] Client notification preferences: real-time / daily / weekly digest (default weekly) (§5.5).
- [ ] Portal-local search (§20): scoped projects, shared files, own invoices only.
- [ ] Portal nav (§16.2) + dashboard (§17.7).
- [ ] Edge cases (§25): client org deactivated → "access ended" page; client user removed mid-approval → re-route to remaining Approvers or alert PM.

**Done (Spec §13 Client Portal):**
- [ ] A client user sees exactly their scoped projects and nothing else — **proven by an isolation test with two client orgs** (cross-org ID → 404).
- [ ] Approve / request-revision move the task and notify the PM.
- [ ] Internal data never leaks into portal responses.

**Spec refs:** §2, §5.5, §5.1, §6, §10, §16.2, §17.7, §20, §25.

---

## Phase 7 — Leave · 1 week

**Goal:** Policy-accurate leave with a routed approval chain, escalation, and overlap awareness.

**Depends on:** Phase 2 (employees/teams), Phase 4 (notifications).

**Work breakdown:**
- [ ] **Leave types & quotas (§4, §5.7):** Casual/Sick/Earned/Unpaid with configured accrual; balances + projected accrual visible always.
- [ ] **Monthly accrual job (§5.7).**
- [ ] **Approval chain (§5.7):** employee → TL → (TL absent/is TL) PM → (is PM) HR; HR/SA approve anything.
- [ ] **48h auto-escalation (§4, §5.7):** unactioned → up one level, notify both parties.
- [ ] **Team leave calendar (§5.7):** approved + pending; overlap warning within team.
- [ ] **Excess-leave → Unpaid auto-convert (§5.7):** flagged into payroll export.
- [ ] Two-approver race (§25): first write wins, second sees "already actioned".
- [ ] Leave-approved-then-new-holiday recompute job: refund + notify (§25).
- [ ] Validation (§24 Leave): to≥from, half-day single-day only, no self-overlap, balance check at request+approval, not in locked month, reason rules.

**Done (Spec §13 Leave):**
- [ ] Accrual runs monthly and matches policy.
- [ ] Chain routes per rules incl. 48h escalation.
- [ ] Overlap warning appears.
- [ ] Excess leave converts to unpaid and appears in payroll export.

**Spec refs:** §4, §5.7, §24, §25.

---

## Phase 8 — Finance · 1.5 weeks

**Goal:** Invoice-to-cash, expenses, P&L per vertical, and the payroll CSV export.

**Depends on:** Phase 2 (employees/rates), Phase 4 (completed tasks → invoiceable), Phase 7 (leave data for payroll).

**Work breakdown:**
- [ ] **Invoices (§5.8):** against client+project; line items (desc/qty/rate/GST%); statuses Draft → Sent → Partially Paid → Paid → Overdue (auto after due date); PDF with RADemics branding; email to client; visible in portal.
- [ ] **Payments (§5.8):** date/mode/reference/amount; partial payments; outstanding dues per client; overpay blocked with remaining shown; compensating-entry reversal only (§25).
- [ ] **Expenses (§5.8):** per project, category, receipt attachment.
- [ ] **P&L per vertical (§5.8):** invoiced revenue − expenses; estimated labor = actual hrs × per-role hourly rate (§4/settings).
- [ ] **Payroll CSV export (§5.8, §21):** payable days from attendance + approved leave, loss-of-pay for excess/unpaid + 3-lates; documented generic CSV columns; month lock/unlock (SA-approved, audited); immutable snapshots, "revision N" on re-export (§25). No payslip generation (out of scope).
- [ ] Task → Invoiced → Closed transitions (§6) wired to Finance.
- [ ] Validation (§24 Invoice): ≥1 line, qty>0, rate≥0, GST 0–28, due≥issue, number unique/never-reused, edit-after-Sent = cancel-and-reissue, payment ≤ balance.
- [ ] Finance dashboard (§17.5) + finance tables (§19).

**Done (Spec §13 Finance):**
- [ ] Invoice lifecycle Draft→Paid with partial payments.
- [ ] PDF renders with branding; overdue auto-flags.
- [ ] P&L reconciles with entered invoices + expenses.
- [ ] Payroll CSV matches attendance + leave for a test month.

**Spec refs:** §5.8, §4, §6, §17.5, §19, §21, §24, §25.

---

## Phase 9 — Skills, Reports & AI · 2 weeks

**Goal:** Capacity-aware allocation, all reports with exports, and the four AI features behind a provider-agnostic gateway.

**Depends on:** Phases 2–8 (data for reports + AI retrieval).

**Work breakdown:**
- [ ] **Skill tags + capacity view (§5.9):** admin tag list; per-person open tasks + estimated hrs vs weekly capacity (40h default); traffic-light; surfaced on assignment screens.
- [ ] **Reports (§5.11, §21):** Attendance, Productivity, Project status, Finance — exact columns per §21; CSV + PDF; role-scoped; numbers from immutable history only.
- [ ] **AI gateway (§7):** one internal interface, adapters for Claude/OpenAI/Gemini/Groq; provider+model per feature in settings; keys server-side; all calls async via queue; per-user daily limit (default 50); every response labeled AI-generated; **respects permission matrix** (never reveals data the user can't open).
- [ ] **AI feature 1 — Daily summary (§7):** per team/day, generated once, stored.
- [ ] **AI feature 2 — Completion forecast (§7):** rule-based baseline + AI narrative; risk level with reasons.
- [ ] **AI feature 3 — Assignment suggestion (§7):** ranked by skill + load; always a suggestion.
- [ ] **AI feature 4 — Scoped chat assistant (§7):** read-only retrieval over permitted data; cites records; refuses out-of-scope.
- [ ] Graceful degradation (§25): cached summary, rule-based forecast fallback, "temporarily unavailable" — never blocks non-AI flows.
- [ ] AI endpoint rate limiting (§10).

**Done (Spec §13 AI + Reports):**
- [ ] All four AI features return useful output on seed data.
- [ ] Out-of-scope question → refusal; rate limit enforced.
- [ ] Each report matches manually-computed values on seed data; exports open correctly.

**Spec refs:** §5.9, §5.11, §7, §10, §21, §25.

---

## Phase 10 — Hardening & Launch · 1.5 weeks

**Goal:** Prove the non-functional bar, close the security surface, and go live.

**Depends on:** Phases 1–9 complete.

**Work breakdown:**
- [ ] **Load test to 100 concurrent users** without degradation (§11).
- [ ] **Security pass (§10):** client-isolation tests, rate limits on auth + AI, **fail-closed check on every endpoint**, UUID enforcement, presigned URL expiry, secrets server-side only, CSP on both apps.
- [ ] **Data retention jobs (§4, §10, §25):** monitoring data auto-purge (12 mo), notification auto-delete (90 days), logged deletions.
- [ ] Sentry receives a test error from all three deployables; Prometheus + Grafana dashboards up (§11).
- [ ] **Staging environment** with anonymized seed data; releases touching Attendance/Payroll ship to staging first (§11).
- [ ] **Backup + restore drill** documented: nightly DB backup + object-storage replication; at least one restore drill before go-live (§10).
- [ ] Final demo seed data (§11): all roles, 2 depts, 3 teams, ~15 users, 1 client org + 3 client users, 2 projects + 1 stream, tasks across every status, sample invoices + leave.
- [ ] Accessibility pass: keyboard nav, focus states, WCAG AA contrast (§9).
- [ ] Performance: interactive pages < 2s on mid-range phone / 4G (§11).
- [ ] Go-live: Nginx + TLS + Cloudflare, GitHub Actions deploy (§12).

**Done (Spec §13 Non-functional):**
- [ ] 100-concurrent-user load test passes.
- [ ] Sentry receives a test error from all three deployables.
- [ ] Staging deploy + backup restore drill documented.
- [ ] Every §13 module's Done criteria remain green (full regression).

**Spec refs:** §9, §10, §11, §12, §25.

---

## Dependency graph (build order)

```
Phase 0  Prereqs
   │
Phase 1  Foundation ─────────────────────────────────┐
   │            │            │            │           │
Phase 2      Phase 3      (real-time)  (queue)     (audit/RBAC)
People/Org   Attendance
   │            │
   ├────────────┴──────► Phase 4  Projects & Tasks
   │                          │
   │                     Phase 5  Files
   │                          │
   │                     Phase 6  Client Portal
   │
   ├──────────────────► Phase 7  Leave
   │                          │
   └──────────────────► Phase 8  Finance  (needs Ph4 tasks + Ph7 leave)
                              │
                        Phase 9  Skills, Reports, AI  (needs Ph2–8 data)
                              │
                        Phase 10 Hardening & Launch
```

**Critical path:** 1 → 4 → 5 → 6 and 1 → 4 → 8 → 9 → 10 are the longest chains. Phases 3 and 7 can partly parallelize against the Projects/Files track if capacity allows, but §14 assumes a single developer, so treat the order above as sequential by default.

---

## Progress tracker

| Phase | Weeks | Status | Started | Done |
|---|---|---|---|---|
| 0 · Prereqs | — | ✅ Complete | 2026-07-10 | 2026-07-11 |
| 1 · Foundation | 1.5 | ✅ Complete | 2026-07-10 | 2026-07-11 |
| 2 · People & Org | 1 | ✅ Complete | 2026-07-11 | 2026-07-11 |
| 3 · Attendance | 1.5 | ⬜ Next | | |
| 4 · Projects & Tasks | 2.5 | ☐ Not started | | |
| 5 · Files | 1 | ☐ Not started | | |
| 6 · Client Portal | 1.5 | ☐ Not started | | |
| 7 · Leave | 1 | ☐ Not started | | |
| 8 · Finance | 1.5 | ☐ Not started | | |
| 9 · Skills, Reports, AI | 2 | ☐ Not started | | |
| 10 · Hardening & Launch | 1.5 | ☐ Not started | | |

**Total: 13–15 weeks** (13 = no scope changes; 15 = normal slippage). Reinstating native mobile adds 4 weeks after Phase 10 (§14).

---

*Plan derived from `RADEMICS_ERP_SPEC.md`. When spec and plan disagree, the spec wins (§0).*
