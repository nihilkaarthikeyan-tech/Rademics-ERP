# RADEMICS ERP — Production Build Plan v2.1 (Reference)

> **Internal reference file.** Faithful markdown transcription of `Rademics_ERP_Production_Build_Plan_v2.1.docx`
> (Work Management & Employee Monitoring Platform · July 2026 · Supersedes Proposal v1, Draft 1.0, Build Plan v2.0).
> This is the **single source of truth** for building the Rademics ERP. Where this doc conflicts with the original proposal, **this doc wins**.

---

## 0. How to Use This Document

- Single source of truth, written to be handed to an AI coding assistant (Claude Code) or a dev team.
- Defines **what to build, for whom, under which rules** — **deliberately contains no source code, no DB schema, no architecture diagrams.** All implementation decisions (schema, folder structure, API shape, component structure) are delegated to the implementer, constrained only by **Technology Constraints (Sec 12)**.

**Reading rules for the implementer:**
- Every requirement is a **testable statement**. Acceptance criteria per module are in **Sec 13**.
- Any value marked **`[ASSUMED]`** is a sensible default awaiting management confirmation. Build with the stated default and make it configurable in Admin Settings wherever the text says "configurable".
- The **Role & Permission Matrix (Sec 3)** is authoritative. **Enforce at the API layer, never only in the UI.**
- Where this document conflicts with the original proposal, **this document wins**.
- **Phase plan (Sec 14)** defines build order. Do not start a later phase before the acceptance criteria of its dependencies are met.

---

## 1. Product Overview & Scope

### 1.1 What this product is
Web-based ERP for **RADemics** — an agency across **research writing, publication support, design, web development, customer support** — connecting employees, managers, and clients in one platform. Covers the full operating loop: people & roles, attendance & productivity, project & task execution, client collaboration & approvals, leave, finance & invoicing, reporting, and an AI assistance layer.

### 1.2 Primary business objectives
- One place to see **who is working on what, right now**, across all verticals.
- Attendance & productivity data **trustworthy enough to drive payroll without disputes**.
- Clients see progress and approve deliverables **without email chains**.
- Managers stop being bottlenecks: **Team Leads** handle day-to-day allocation, **PMs** handle projects, **HR & Finance** have their own lanes.
- **Audit trail** on every sensitive action, sufficient for future ISO/SOC2-style requirements.

### 1.3 Scope split — V1 and V2
**V1 (this build, target 13–15 weeks):** Authentication & RBAC, Employee/HR management, Departments, Attendance & Productivity, Projects/Work Streams/Tasks with full status state machine, Client Portal (multi-user orgs, file sharing, approvals), Leave Management, Finance (invoices, payments, expenses) with payroll CSV export, Skills & Capacity, Freelancer support, Audit Log, Reports, Notifications (in-app + email), AI features (all four via provider-agnostic gateway), Admin Settings.

**V2 (out of scope for this build):** native mobile app (**V1 must be fully responsive instead — Sec 10**), Meilisearch global search (V1 uses **PostgreSQL full-text search**), WhatsApp notifications, deep payroll integration beyond CSV/API export (Tally/Zoho), multi-currency, multi-language/Tamil UI, SSO/Google login, client self-registration.

**Deliberate changes from original proposal** (management approved "alter accordingly"):
- Flutter mobile app **deferred to V2** — management wants a user-friendly web app; responsive web must make **mobile-browser attendance check-in first-class**.
- Meilisearch **deferred**; Postgres full-text search sufficient at V1 scale.
- **Virus scanning (ClamAV) restored to scope** — dropped in Draft 1.0, now non-negotiable once clients upload files.

---

## 2. Users & Roles

**Seven roles. A user has exactly one role.** Employees and freelancers are the same user type distinguished by a **resource type flag (internal / freelance)**; freelancers are **excluded from attendance and leave** flows and are **paid per deliverable**.

| Role | Who they are | What they primarily do |
|---|---|---|
| **Super Admin** | Founders / top management | Everything. Configures the system, sees all data including salaries, manages roles & permissions, views audit logs. |
| **HR** | HR staff | Creates/manages employees, attendance rules & corrections, leave policy & approvals, payroll export. |
| **Project Manager** | Vertical heads (Publications, Design, Web, Support) | Creates projects & work streams, assigns Team Leads, approves task submissions, owns client relationships & deadlines. |
| **Team Lead** | Senior member over 3–8 people | Day-to-day task assignment within team, first-line review of submissions, approves team leave, monitors team attendance. |
| **Employee** | Internal staff | Checks in/out, works assigned tasks, submits for review, requests leave & attendance corrections. |
| **Freelancer** | External resources (Employee role, resource type = freelance) | Works assigned tasks, submits deliverables. **No attendance, no leave.** Contract/NDA files attached to profile. |
| **Client** | Client organization users | Views scoped project progress, downloads shared files, approves/requests revision on deliverables, views invoices. |
| **Accounts / Finance** | Finance staff | Invoices, payment tracking, outstanding dues, expense logging per project, P&L per vertical, payroll export. |

**Client organizations:** a client is an **organization with many users** (e.g. a college with Placement Officer, HOD, Principal). Each client user has an **individual login** and an **individual visibility scope** (which projects, and whether they can approve or only view). **One login per organization is not acceptable.**

---

## 3. Role & Permission Matrix (AUTHORITATIVE)

**Y** = allowed, **–** = denied, **S** = scoped (own team / own projects / own record). **Enforce at API layer.** Store as **capability keys against roles** so Super Admin can adjust grants without a code change; the matrix below is the **seed state**. `[ASSUMED — management to approve; blank in original proposal.]`

Columns: **SA** = Super Admin · **HR** · **PM** · **TL** = Team Lead · **Emp** = Employee · **Cli** = Client · **Fin** = Finance.

### — People & Organization —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Create / edit employee | Y | Y | – | – | – | – | – |
| Deactivate / offboard user | Y | Y | – | – | – | – | – |
| Assign / change roles | Y | – | – | – | – | – | – |
| Manage departments & teams | Y | Y | – | – | – | – | – |
| View employee directory | Y | Y | Y | Y | Y | – | Y |
| View / edit salary data | Y | Y | – | – | – | – | S |
| Manage freelancer contracts/NDA files | Y | Y | S | – | – | – | – |

### — Attendance —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Check in / check out (self) | – | Y | Y | Y | Y | – | Y |
| View own attendance & productivity | Y | Y | Y | Y | Y | – | Y |
| View team attendance | Y | Y | S | S | – | – | – |
| View all attendance | Y | Y | – | – | – | – | – |
| Configure attendance rules | Y | Y | – | – | – | – | – |
| Request attendance regularization | – | Y | Y | Y | Y | – | Y |
| Approve regularization | Y | Y | S | S | – | – | – |

### — Projects & Tasks —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Create / edit project or work stream | Y | – | Y | – | – | – | – |
| Archive / close project | Y | – | S | – | – | – | – |
| Create tasks & subtasks | Y | – | Y | S | – | – | – |
| Assign / reassign tasks | Y | – | Y | S | – | – | – |
| Update status of own tasks | Y | – | Y | Y | Y | – | – |
| Review: approve / send back submissions | Y | – | Y | S | – | – | – |
| Comment on tasks | Y | Y | Y | Y | Y | S | Y |
| View all projects | Y | Y | Y | – | – | – | Y |
| View own / team projects only | – | – | – | S | S | S | – |

### — Files —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Upload files to tasks | Y | – | Y | Y | Y | S | – |
| Mark file visible to client | Y | – | Y | S | – | – | – |
| Delete file version | Y | – | S | – | – | – | – |

### — Client Portal —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View shared project progress | – | – | – | – | – | Y | – |
| Download client-visible files | – | – | – | – | – | Y | – |
| Approve / request revision on deliverable | – | – | – | – | – | S | – |
| View own invoices & payment status | – | – | – | – | – | Y | – |
| Manage client users & scopes | Y | – | S | – | – | – | – |

### — Leave —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Request leave (self) | – | Y | Y | Y | Y | – | Y |
| Approve team leave | Y | Y | S | S | – | – | – |
| Configure leave policy & quotas | Y | Y | – | – | – | – | – |
| View leave calendar | Y | Y | Y | Y | Y | – | Y |

### — Finance —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Create / edit invoices | Y | – | – | – | – | – | Y |
| Record payments & view dues | Y | – | – | – | – | – | Y |
| Log expenses against projects | Y | – | S | – | – | – | Y |
| View P&L per vertical | Y | – | – | – | – | – | Y |
| Run payroll export | Y | Y | – | – | – | – | Y |

### — Reports, AI & Admin —
| Capability | SA | HR | PM | TL | Emp | Cli | Fin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View reports dashboard | Y | Y | Y | S | S | – | Y |
| Use AI assistant (scoped to own access) | Y | Y | Y | Y | Y | – | Y |
| View audit log | Y | – | – | – | – | – | – |
| Manage system settings & integrations | Y | – | – | – | – | – | – |

**Scoped (S) definitions:**
- **PM** — only projects they manage.
- **Team Lead** — only members of their team / tasks within their team.
- **Client** — only if their user scope grants "approver" for that project; and only comment threads on client-visible items.
- **Finance salary view** — payroll-relevant fields only, **not** salary editing.
- **Employee/TL "view own projects"** — projects containing tasks assigned to them or their team.

**Freelancers inherit the Employee column minus every Attendance and Leave capability.**

---

## 4. Global Business Rules & Default Values

Every value below must be **editable by Super Admin (and HR where noted) in Admin Settings, without a code change.** Build with these defaults.

| Rule | Default | Configurable by |
|---|---|---|
| Working days | Monday–Saturday, Sunday off `[ASSUMED]` | Super Admin |
| Official work hours | 9:00 AM – 6:00 PM IST `[ASSUMED]` | Super Admin |
| Late threshold | Check-in after 9:15 AM = Late `[ASSUMED]` | HR |
| Half-day threshold | Total worked < 4 hours = Half day `[ASSUMED]` | HR |
| Overtime flag | Total worked > 9 hours = Overtime flagged `[ASSUMED]` | HR |
| Idle definition | No activity heartbeat for 5 minutes = idle; per-role override allowed | HR |
| 3 lates rule | 3 late marks in a month = 1 half-day deduction `[ASSUMED]` | HR |
| Leave: Casual | 12 days/year, accrued 1/month, no carry-forward `[ASSUMED]` | HR |
| Leave: Sick | 6 days/year, no accrual, no carry-forward `[ASSUMED]` | HR |
| Leave: Earned | 15 days/year, accrued 1.25/month, carry-forward max 30 `[ASSUMED]` | HR |
| Leave: Unpaid | Unlimited, always requires approval | — |
| Leave approval escalation | Unactioned 48h → escalates one level up the chain | HR |
| Session timeout (Admin/Finance) | 30 minutes inactivity → forced re-login `[ASSUMED]` | Super Admin |
| Session timeout (other roles) | 8 hours `[ASSUMED]` | Super Admin |
| Monitoring data retention | Idle/activity logs kept 12 months, then purged `[ASSUMED]` | Super Admin |
| Invoice numbering | `RAD-{YYYY}-{sequential 4 digits}` `[ASSUMED]` | Finance |
| Currency | INR only in V1 | — |
| Tax on invoices | GST 18%, editable per invoice line `[ASSUMED]` | Finance |
| Client digest default | Weekly email digest; real-time opt-in | Client (self) |
| File upload limit | 100 MB per file `[ASSUMED]` | Super Admin |
| Holiday calendar | Admin-maintained list (Tamil Nadu list seeded) | HR |

---

## 5. Module Specifications

### 5.1 Authentication & Access
- Email + password login. **JWT access tokens with refresh tokens.** Logout invalidates the refresh token.
- Password rules: **min 10 chars, must include a number** `[ASSUMED]`. Forgot-password via emailed reset link **valid 30 minutes**.
- Accounts created by **HR/Super Admin only** — no self-registration for staff or clients. New users get an **invite email with set-password link**.
- Failed logins: **lock account 15 min after 5 consecutive failures**; notify user by email.
- Client portal auth is the same mechanism but **client users can never obtain a session on internal app routes, and vice versa**.

### 5.2 Employee & HR Management
- Profile: name, photo, contact, department, team, role, reporting manager, join date, employment status (active / on notice / exited), resource type (internal / freelance), skill tags, documents (offer letter, ID proof, contracts).
- Salary info **visible only per permission matrix** and **encrypted at rest**.
- Freelancer profiles additionally carry: **payment-per-deliverable terms**, contract/NDA attachments, active-engagement flag. **Never appear in attendance/leave screens.**
- **Offboarding:** deactivation immediately **revokes sessions**, **unassigns open tasks back to the Team Lead** with notification, **retains all historical records**.
- Org structure: **Department → Team → Member**. A team has **exactly one Team Lead**. A department maps to a **business vertical** (Publications, Design, Web, Support) for P&L reporting.

### 5.3 Attendance & Productivity
- **Multiple sessions per day are first-class**: each check-in/out pair is one session; daily total = sum of sessions. **A single in/out pair per day is not acceptable.**
- Check-in/out capture **timestamp, IP address, device/user-agent**. Both must work smoothly on **mobile browser**.
- **Idle tracking:** while checked in and using the web app, client sends an **activity heartbeat**; gap beyond idle threshold (default 5 min) accrues idle minutes. **Idle time shown to the employee immediately — nothing tracked invisibly.**
- Late / half-day / overtime marks **computed nightly** from Sec 4 rules; shown on employee record + HR views.
- **Regularization:** employee requests a correction (missed check-in/out, wrong time) with reason → routes to **Team Lead (or HR if no TL)**. Approval updates the record and **logs correction in audit trail; original value never silently overwritten**.
- **Forgotten open session auto-closes at day end (11:59 PM)** flagged "auto-closed", prompting regularization next login.
- **Live "who is online now"** view for HR/managers via real-time layer.

### 5.4 Projects, Work Streams & Tasks
- Hierarchy: **Project → Module → Task → Subtask.** Modules = simple named groupings (e.g. "Frontend", "Chapter 3 papers"). **Subtasks one level deep only.**
- **Work Streams** = second container type for continuous work (support, moderation, training-deck production): **no end date**, tasks generated on a **cadence** (e.g. weekly), reported by **throughput per week** rather than percent complete.
- Project carries: name, client, PM, type (project/stream), status, start/end dates, description, **budget amount (visible to PM/Finance/Admin only)**.
- Task carries: title, description, module, assignee, priority (High/Medium/Low), estimated hours, actual hours, deadline, watchers, comments, files, checklist, and the **status per Sec 6**.
- **Every status transition records who, when, optional comment** — powers reports + AI deadline-risk; **must never be editable**.
- Comment threads support **@mentions** (notification) and distinguish **internal vs client-visible** comments; client-visible requires the file/task itself to be shared.
- **Board (kanban), list, and calendar views.** Filters by assignee, status, priority, deadline, module.

### 5.5 Client Portal (separate app)
- Deployed **separately** on its own subdomain (e.g. `portal.rademics.com`). Smaller surface: dashboard, project progress, deliverables, invoices, notifications, profile.
- **Scoping:** each client user sees only granted projects, and within those only client-visible items. **Two levels per project: Viewer** (see progress, download shared files) and **Approver** (additionally approve / request revision).
- **Progress view:** milestone-level status, % complete, recent shared updates. **Internal task details, assignee names, internal comments, internal files never visible.**
- **Deliverable approval flow:** task reaches **Client Review** → designated Approvers notified → **Approve** or **Request Revision (mandatory comment)**. Either action moves the task per the state machine and **notifies the PM**.
- **All client-facing record identifiers must be non-guessable (UUIDs)** — one client can never enumerate another's data.
- Notification preference per client user: real-time email, daily digest, or **weekly digest (default)**.

### 5.6 File Management
- Files attach to tasks (and to employee/freelancer profiles for documents). **Every upload creates a new version — never overwrite**; full version history with uploader & timestamp.
- **Visibility flag per file version:** Internal (default) or Client-visible. Flipping to client-visible requires the Sec 3 permission and is **audit-logged**.
- Uploads/downloads go **directly to object storage via presigned URLs**; **files never stream through the app server**.
- **Every upload is virus-scanned before availability.** Infected files quarantined, uploader notified.
- **Preview in-browser for images and PDF**; everything else downloads.

### 5.7 Leave Management
- Types & quotas per Sec 4; accrual runs monthly; balances visible to employee at all times, **including projected accrual**.
- **Request flow:** employee selects type, dates (supports half-day), reason → **Team Lead → (if TL absent or requester is TL) PM → (if requester is PM) HR**. HR & Super Admin can approve anything.
- **Auto-escalation:** unactioned 48h → escalates one level, notifies both parties.
- **Team leave calendar** shows approved + pending leave for whole team; **warning when approving overlapping leave** in the same team.
- **Excess leave beyond balance auto-converts to Unpaid** and is flagged into payroll export.

### 5.8 Finance & Invoicing
- **Invoices:** against a client & project; line items with description, quantity, rate, GST %; statuses **Draft → Sent → Partially Paid → Paid → Overdue (auto after due date)**. PDF generation with RADemics branding; email to client contacts; visible in client portal.
- **Payments** recorded against invoices (date, mode, reference, amount); **partial payments supported**; outstanding-dues view per client.
- **Expenses** logged against a project (freelancer payouts, tool subscriptions, other) with category & receipt attachment.
- **P&L per business vertical:** invoiced revenue − logged expenses, filterable by date range. **Estimated labor cost per project** = actual hours × per-role hourly cost rate maintained by Finance `[ASSUMED — confirm rates exist]`.
- **Payroll export, not payroll processing:** monthly export computing **payable days** per employee from attendance + approved leave, applying loss-of-pay for excess/unpaid leave and the 3-lates rule, output as **CSV compatible with Tally/Zoho Payroll import** `[ASSUMED — target format TBC; default generic CSV with documented columns]`. **Payslip generation is out of scope for V1.**

### 5.9 Skills & Capacity
- **Skill tags** on user profiles from an admin-managed tag list (e.g. Scopus formatting, React, AutoCAD, voice cloning); multiple per person.
- **Capacity view** for PMs/TLs: per person — open task count, sum of estimated hours vs. **weekly capacity** (default **40h internal**, freelancers per engagement), traffic-light availability. Assignment screens surface this so allocation happens against real bandwidth.

### 5.10 Audit Log
- Every sensitive action logged: logins & failures, role/permission changes, salary edits, user deactivation, attendance regularization approvals, file visibility changes, file deletions, invoice edits after Sent, leave approvals, setting changes, data exports.
- Each entry: **actor, action, entity, before/after values, timestamp, IP**. **Append-only — no edit or delete capability for anyone, including Super Admin.**
- Super Admin view with filters (actor, entity, action type, date range); export to CSV.

### 5.11 Reports & Analytics
- **Attendance report:** per person/team/company — days present, lates, half-days, overtime, idle %, any date range; export CSV/PDF.
- **Productivity report:** hours by project/task vs. estimates; per person & team.
- **Project status report:** tasks by status, overdue list, upcoming deadlines, throughput/week for work streams.
- **Finance reports:** invoiced vs. collected, outstanding dues aging, expense by category, P&L per vertical.
- **Role-scoped:** everyone sees only what the matrix allows (TL sees their team, PM their projects).

### 5.12 Notifications
- **Channels in V1: in-app (real-time) and email.** WhatsApp deferred to V2.
- **Events that must notify:** task assigned/reassigned, status moved to review (notifies reviewer), sent back (notifies assignee), client approval requested/decided, @mention, leave requested/decided/escalated, regularization requested/decided, invoice sent/paid/overdue, **deadline approaching (24h before) and missed**, file shared to client.
- **Per-user notification preferences:** per event group choose in-app only / in-app + email / mute. Clients additionally have digest mode (Sec 5.5).
- **Email sending is asynchronous via the queue**; failed send **retries 3 times then logs**.

### 5.13 Admin Settings
One settings area for Super Admin (HR sees HR subset): all Sec 4 values, holiday calendar, departments/teams, skill tag list, leave types, role-permission grants, integration credentials (SMTP, AI providers, storage), branding (logo, colors on invoices & portal), data-retention values.

---

## 6. Task Status State Machine (the spine)

Statuses and legal transitions are **exhaustive — no other transitions may be possible from UI or API.**

| From | Action (who) | To |
|---|---|---|
| Draft | Assign (PM / TL) | Assigned |
| Assigned | Acknowledge (Assignee) | Acknowledged |
| Assigned | Reassign (PM / TL) | Assigned |
| Acknowledged | Start work (Assignee) | In Progress |
| In Progress | Submit (Assignee) | Submitted for Review |
| Submitted for Review | Approve (PM / TL) | **Client Review** if task is client-facing; otherwise **Completed** |
| Submitted for Review | Send back with comment (PM / TL) | In Progress |
| Client Review | Approve (Client Approver) | Completed |
| Client Review | Request revision with comment (Client Approver) | In Progress |
| Completed | Mark invoiced (Finance) | Invoiced |
| Invoiced | Close (PM) | Closed |
| Completed | Close without invoicing (PM) — internal tasks | Closed |
| Any except Closed | Cancel with reason (PM) | Cancelled |

- **Client-facing** is a **flag on the task**, settable by PM/TL.
- Every transition writes an **immutable history record**: from, to, actor, timestamp, comment. **Send-back and revision-request comments are mandatory.**
- **Deadline-overdue is a computed flag, not a status.**

---

## 7. AI Features

All AI calls go through a **single provider-agnostic gateway** inside the backend: one internal interface, **adapters per provider (Claude, OpenAI, Gemini, Groq)**, provider & model chosen **per feature in Admin Settings**, keys stored **server-side**, all calls **asynchronous via the queue**, **per-user daily rate limit (default 50 calls `[ASSUMED]`)**. Every AI response is **labeled AI-generated**. **AI access respects the permission matrix — the AI can never reveal data the asking user could not open themselves.**

| Feature | What it does | What it needs to work |
|---|---|---|
| **Daily summary** | One-click end-of-day summary for a manager: what each member completed / in progress / blocked; attendance anomalies. | Task status history + attendance sessions for the day, scoped to requester's team/projects. Output: short structured text, stored so it's **generated once per team per day**. |
| **Completion forecast** | Per project: predicted completion date + deadline-risk level with reasons (e.g. "review stage is the bottleneck"). | Historical status-transition timestamps (velocity per stage), open task estimates, team capacity. **Rule-based baseline first; AI narrative on top.** |
| **Assignment suggestion** | When creating a task, suggests best assignees ranked by skill match + current load. | Skill tags, capacity data (Sec 5.9), past completion history on similar task titles. **Always a suggestion — the human picks.** |
| **Scoped chat assistant** | Chat panel where any internal user asks about their own scope ("what is overdue on Project X?", "who is free this week?"). | Retrieval over projects, tasks, status history, attendance, leave the user is permitted to see, plus client-visible files only when permitted. **Cite which records the answer came from. No write actions in V1 — read-only.** |

---

## 8. Screen Inventory

Two applications: **Internal App** and **Client Portal**. **Every screen must have a designed empty state, loading state, and error state — no blank whitescreens.**

### 8.1 Internal App
| Area | Screens |
|---|---|
| **Auth** | Login · Forgot password · Set password (invite) · Locked-account notice |
| **Dashboard (per role)** | Employee: my tasks, attendance today, leave balance, notifications. TL/PM: team board, who is online, pending reviews, deadline risks. HR: attendance overview, pending regularizations & leave. Finance: dues, overdue invoices, monthly collections. Super Admin: company-wide overview + system health. |
| **People** | Employee directory · Employee profile (tabs: overview, documents, attendance, leave, tasks, salary [permission-gated]) · Add/edit employee · Departments & teams · Freelancer list & profile · Skill tags admin |
| **Attendance** | My attendance (check-in/out button, today's sessions, idle) · Team attendance (TL/PM) · All attendance (HR) · Regularization requests (mine / to approve) · Attendance rules settings (HR) |
| **Projects & Tasks** | Projects list (+ work streams) · Project detail (overview, modules, board, list, calendar, files, client-sharing, activity) · Task detail (description, checklist, comments, files, history, subtasks) · Create/edit project · Create/edit task · My tasks |
| **Leave** | My leave (balance, history, request form) · Approvals queue · Team leave calendar · Leave policy settings (HR) |
| **Finance** | Invoices list · Invoice create/edit · Invoice detail + payments · Expenses per project · P&L per vertical · Payroll export |
| **Reports** | Attendance · Productivity · Project status · Finance — each with filters and CSV/PDF export |
| **AI** | Chat assistant panel (persistent drawer) · Daily summary view · Forecast panel inside project detail |
| **Admin** | Settings (all Sec 4 + integrations + branding) · Role & permission editor · Audit log viewer · Notification preferences (per user, in profile) |

### 8.2 Client Portal
| Area | Screens |
|---|---|
| **Auth** | Login · Forgot password · Set password (invite) |
| **Dashboard** | My projects with progress, recent updates, pending approvals badge |
| **Project** | Progress view (milestones, % complete, shared updates) · Shared files (versioned, download/preview) · Deliverables awaiting my approval (approve / request revision with comment) |
| **Billing** | Invoices list with status · Invoice PDF view |
| **Account** | Profile · Notification preference (real-time / daily / weekly digest) |

---

## 9. UX & Design Requirements

- **Management directive:** a user-friendly web app is the core requirement. The bar: an employee checks in and sees their tasks **within 5 seconds of login**; a client understands project status **without training**.
- **Fully responsive.** Every screen usable on a phone browser; **attendance check-in/out and task status updates must be excellent on mobile** (no native app in V1).
- **Design system: Tailwind CSS + shadcn/ui**; one consistent component set across both apps. RADemics branding — primary navy/blue palette with exact tokens defined once and reused `[ASSUMED — replace with official brand hex/logo when provided; use navy #1B2A4A, accent blue #2563EB, gold #C9A227 until then]`.
- **Light mode default; dark mode V1-optional** toggle, implement only if it does not cost schedule.
- **Navigation:** persistent left sidebar (collapsible, icon-only on mobile) grouped by Sec 8 areas; global top bar with search, notifications bell, profile menu.
- **Tables:** server-side pagination, column sort, filter chips, sticky header, CSV export where spec says export.
- **Forms:** inline validation with clear messages, never silent failure; destructive actions require confirm dialog stating exactly what will happen.
- Every list has a designed **empty state**; every async action a **loading indicator**; errors **human-readable with retry path**.
- **Real-time where it matters:** notification bell, who-is-online, kanban updates, pending-approval badges — all update without refresh.
- **Accessibility:** keyboard-navigable forms/dialogs, visible focus states, **WCAG AA contrast**.
- **English-only UI in V1;** write all user-facing strings in one place so future Tamil translation is a content task, not a refactor.

---

## 10. Security & Compliance Requirements

- **RBAC enforced at the API layer on every endpoint;** UI hiding is cosmetic. Any endpoint without an explicit permission check must **fail closed**.
- **JWT + refresh tokens; refresh rotation; server-side revocation** on logout, password change, deactivation.
- **Field-level encryption at rest** for salary and PII (salary, bank details, government IDs) — not merely full-disk encryption.
- **Session timeout** with forced re-auth per Sec 4 for Super Admin & Finance.
- **All client-facing identifiers are UUIDs;** client data isolation **explicitly tested** (one client attempting another's resource IDs must get **404, and a test proves it**).
- **Rate limiting** on auth endpoints and AI endpoints.
- **Uploads virus-scanned before availability** (Sec 5.6). **Presigned URLs expire within minutes.**
- **Data-retention behavior implemented:** monitoring data auto-purged after configured retention; deletion logged.
- **Audit log append-only** (Sec 5.10). **Nightly DB backup + object-storage replication; at least one documented restore drill before go-live.**
- **Secrets only in server-side env config;** never in frontend bundle or repository.
- **HTTPS everywhere;** secure/httpOnly cookies if cookies used; **sensible CSP on both apps**.

---

## 11. Performance & Quality Bar

- **Target load: 100 concurrent users without degradation;** load-tested before go-live.
- Interactive pages render meaningful content in **under 2 seconds** on a mid-range phone over 4G.
- **Long work** (AI calls, PDF/report generation, email, exports, virus scans) **always runs on the queue** — an HTTP request never blocks on it.
- **Error tracking (Sentry)** wired in both apps + backend from day one; **uptime & metrics dashboards (Prometheus/Grafana)** on the server.
- **Staging environment** with anonymized seed data; every release touching Attendance or Payroll ships to staging first.
- **Seed script** for local/staging: all roles, 2 departments, 3 teams, ~15 users, 1 client org with 3 client users, 2 projects + 1 work stream, tasks across every status, sample invoices & leave — so every screen has data on first run.

---

## 12. Technology Constraints

The implementer owns all design decisions **within these constraints** (constraint list, not architecture).

| Layer | Choice |
|---|---|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | NestJS (TypeScript) |
| **Database** | PostgreSQL (single instance in V1); full-text search via Postgres in V1 |
| **ORM** | Prisma |
| **Cache / sessions** | Redis |
| **Background jobs** | BullMQ (Redis-backed) |
| **Real-time** | Socket.IO with per-user and per-team channel authorization |
| **File storage** | MinIO (S3-compatible, self-hosted), presigned URLs |
| **Virus scanning** | ClamAV container in the upload pipeline |
| **Auth** | JWT + refresh tokens + RBAC (Sec 3) |
| **AI** | Provider-agnostic gateway; adapters for Claude, OpenAI, Gemini, Groq (Sec 7) |
| **Email** | SMTP via configurable provider `[ASSUMED — provider TBD; build against generic SMTP]` |
| **Deployment** | Docker Compose on a Linux VPS; Nginx reverse proxy with TLS; Cloudflare in front; GitHub Actions CI/CD |
| **Monitoring** | Sentry (errors), Prometheus + Grafana (metrics) |
| **Repository** | Single monorepo: internal app, client portal, backend, shared packages |

**Deferred to V2:** native mobile app, Meilisearch, WhatsApp notifications, SSO, multi-currency, Tamil localization.

---

## 13. Acceptance Criteria (Definition of Done per Module)

| Module | Done means |
|---|---|
| **Auth & RBAC** | All 7 roles log in and see role-correct dashboards. Every permission-matrix denial verified at the API (not just hidden in UI). Invite, reset, lockout, session-timeout flows all work. |
| **Employee/HR** | Create → invite → activate → edit → deactivate lifecycle works; deactivation revokes access and reassigns open tasks; salary fields invisible to unauthorized roles at the API. |
| **Attendance** | Two sessions in one day sum correctly. Late/half-day/overtime marks computed per configured rules. Idle accrues and is visible to the employee. Regularization round-trips with approval + audit entry. Check-in/out works on a phone browser. |
| **Projects & Tasks** | Full hierarchy creatable. Every legal state transition works and every illegal one is rejected by the API. History complete & immutable. Board, list, calendar views filter correctly. |
| **Client Portal** | A client user sees exactly their scoped projects and nothing else — proven by an isolation test with two client orgs. Approve/request-revision flows move the task and notify the PM. Internal data never leaks into portal responses. |
| **Files** | Versioning never overwrites. An **EICAR test file** is caught by the scanner and quarantined. Client-visible flag controls portal visibility exactly. Presigned upload/download works for 100 MB files. |
| **Leave** | Accrual runs monthly and matches policy. Approval chain routes per rules incl. escalation at 48h. Overlap warning appears. Excess leave converts to unpaid and appears in payroll export. |
| **Finance** | Invoice lifecycle Draft→Paid with partial payments; PDF renders with branding; overdue auto-flags; P&L numbers reconcile with entered invoices & expenses; payroll CSV matches attendance + leave for a test month. |
| **Audit** | Every action listed in 5.10 produces an entry with before/after values; no role can modify/delete entries. |
| **Notifications** | Every event in 5.12 fires in-app and (per preference) email; digests batch correctly; mute works. |
| **AI** | All four features return useful output on seed data; a user asking about a project outside their scope gets a refusal; rate limit enforced. |
| **Reports** | Each report matches manually-computed values on seed data; exports open correctly. |
| **Non-functional** | 100-concurrent-user load test passes; Sentry receives a test error from all three deployables; staging deploy + backup restore drill documented. |

---

## 14. Phase Plan

Sequenced so each phase ships something testable. Durations assume **one experienced developer working with an AI coding assistant**. **Total: 13–15 weeks to V1 go-live.**

| # | Phase | Weeks | Contents |
|---|---|---|---|
| 1 | **Foundation** | 1.5 | Monorepo, CI/CD, Docker environment, database + Redis + MinIO up, Auth (JWT/refresh/invite/reset), RBAC middleware, audit-log hook wired from day one, seed script v1. |
| 2 | **People & Org** | 1 | Employees, departments, teams, freelancer profiles, documents, role editor, Admin Settings shell with Sec 4 values. |
| 3 | **Attendance** | 1.5 | Sessions, check-in/out (mobile-friendly), idle heartbeat, nightly rule computation, regularization flow, HR views, who-is-online (real-time layer bootstrap). |
| 4 | **Projects & Tasks** | 2.5 | Projects, work streams, modules, tasks/subtasks, full state machine + immutable history, board/list/calendar, comments with @mentions, notifications core (in-app + email via queue). |
| 5 | **Files** | 1 | MinIO presigned pipeline, versioning, ClamAV scan, visibility flags, previews. |
| 6 | **Client Portal** | 1.5 | Separate app, scoped auth, progress view, shared files, approval flow, digest preferences, isolation tests. |
| 7 | **Leave** | 1 | Types, accrual job, request/approval chain, escalation, team calendar, overlap warning. |
| 8 | **Finance** | 1.5 | Invoices + PDF + email, payments, dues, expenses, P&L per vertical, payroll CSV export. |
| 9 | **Skills, Reports, AI** | 2 | Skill tags + capacity view, all reports with exports, AI gateway + all four features (assistant read-only). |
| 10 | **Hardening & Launch** | 1.5 | Load test to 100 concurrent, security pass (isolation, rate limits, fail-closed check on every endpoint), Sentry/metrics, staging drill, backup + restore drill, seed final demo data, go-live. |

**Buffer:** 13-week path assumes no scope changes; 15 weeks includes normal slippage. If management reinstates the native mobile app, **add 4 weeks after Phase 10**.

---

## 15. Assumption Log — Items for Management Sign-off

Everything below is built as a default. Each can be changed in Admin Settings after launch **unless marked (build-time)**. None block the start of Phases 1–2.

| # | Assumption | Where |
|---|---|---|
| 1 | Permission matrix seed grants as written | Sec 3 |
| 2 | Work hours 9–6 IST, Mon–Sat; late 9:15; half-day <4h; overtime >9h; 3 lates = half-day deduction | Sec 4 |
| 3 | Leave quotas: casual 12, sick 6, earned 15 (1.25/mo accrual, CF max 30) | Sec 4 |
| 4 | Monitoring-data retention 12 months | Sec 4 |
| 5 | Invoice numbering `RAD-YYYY-####`; GST 18% default; INR only | Sec 4 |
| 6 | Native mobile app deferred; responsive web replaces it in V1 **(build-time)** | Sec 1.3 |
| 7 | Brand tokens navy/blue/gold placeholders until official assets provided | Sec 9 |
| 8 | Payroll export = generic documented CSV; Tally/Zoho exact format on confirmation | Sec 5.8 |
| 9 | Per-role hourly cost rates exist for P&L labor estimates | Sec 5.8 |
| 10 | Email provider generic SMTP until named | Sec 12 |
| 11 | AI per-user limit 50 calls/day; providers keyed by management | Sec 7 |
| 12 | Hosting: single Linux VPS with Docker Compose acceptable for V1 **(build-time)** | Sec 12 |

---

## 16. Navigation Hierarchy

Exact sidebar structure. **Items appear only if the user's role has the relevant permission (Sec 3).** Active section highlighted; sidebar collapses to icons on mobile.

### 16.1 Internal App sidebar
| Top-level | Children | Visible to |
|---|---|---|
| Dashboard | — | All internal roles |
| My Work | My Tasks · My Attendance · My Leave | All except Super Admin (optional for SA) |
| People | Directory · Departments & Teams · Freelancers · Skill Tags | SA, HR (Directory: all internal) |
| Attendance | Team Attendance · All Attendance · Regularizations · Rules | TL/PM (Team), HR/SA (All, Rules) |
| Projects | All Projects · Work Streams · My Projects | Per matrix |
| Leave | Approvals · Team Calendar · Policy | Approvers; Policy: HR/SA |
| Finance | Invoices · Payments & Dues · Expenses · P&L · Payroll Export | Finance, SA (Payroll also HR) |
| Reports | Attendance · Productivity · Project Status · Finance | Per matrix, scoped |
| AI Assistant | Opens chat drawer (also floating button on all pages) | All internal roles |
| Admin | Settings · Roles & Permissions · Audit Log | SA (HR sees HR subset of Settings) |

**Top bar (all pages):** global search · notification bell with unread badge · profile menu (My Profile, Notification Preferences, Logout).

### 16.2 Client Portal navigation
**Top-nav only, no sidebar:** Dashboard · Projects · Approvals (with pending badge) · Invoices · Profile.

---

## 17. Dashboard Specifications (per role)

Cards in order of layout priority (top-left first). "Card" = stat number or small list; "Chart" as stated. **Every number is clickable** and navigates to the filtered underlying list. All data scoped per the permission matrix.

### 17.1 Employee dashboard
1. **Check-in / Check-out card** — big primary button toggling by current state; today's sessions listed with per-session duration; today's total worked + idle minutes. **Sticky at top on mobile.**
2. **My Tasks Today** — list (max 7): due today/overdue first, then by priority. Row: title, project, status chip, deadline. Quick action: move status (legal transitions only).
3. **My Stats (4 tiles)** — Tasks in progress · Tasks awaiting my acknowledgment · Overdue · Completed this week.
4. **Leave Balance card** — Casual / Sick / Earned remaining; quick action Request Leave.
5. **This Week chart** — bar chart: worked hours per day this week vs. official hours line.
6. **Recent Notifications** — last 5, unread bold; link to full list.

### 17.2 Team Lead dashboard
1. **Pending Reviews** — tasks in Submitted for Review for my team; quick actions Approve / Send back (comment dialog).
2. **Team Now** — live list: each member — online/offline dot, checked-in since, current In Progress task, idle flag if idle > threshold.
3. **Team Stats (4 tiles)** — Open tasks · Due this week · Overdue · Submitted awaiting review.
4. **Pending Approvals** — leave + regularization awaiting me; inline Approve / Reject.
5. **Team Load chart** — horizontal bars: estimated open hours per member vs. weekly capacity; red when over.
6. **Deadline Risks** — AI forecast list: tasks/projects flagged at risk with reason (Sec 7).

### 17.3 Project Manager dashboard
1. **My Projects overview** — card per project: % complete, open/overdue counts, next milestone, client-approval pending badge. Click → project.
2. **Pending Reviews** — same as TL but across my projects.
3. **Client Actions Waiting** — deliverables in Client Review > 48h, with nudge (resend notification) action.
4. **Stats (4 tiles)** — Active projects · Tasks overdue · In client review · Completed this month.
5. **Throughput chart** — work streams: tasks completed per week, last 8 weeks.
6. **Deadline Risks** — AI forecast across my projects.

### 17.4 HR dashboard
1. **Today's Attendance** — tiles: Present · Late · On Leave · Absent (no session + no leave) · Currently online. Click → filtered list.
2. **Pending Queue** — regularizations + leave requiring HR; inline approve/reject.
3. **Attendance Trend chart** — line: present % per day, last 30 days.
4. **Alerts** — employees hitting 3-lates rule this month; leave requests escalated; contracts/NDAs expiring in 30 days (freelancers).
5. **Headcount tiles** — Active employees · Freelancers active · On notice · Joined this month.

### 17.5 Finance dashboard
1. **Money tiles** — Outstanding dues · Overdue invoices (count + amount) · Collected this month · Invoiced this month.
2. **Dues Aging chart** — stacked bars: 0–30 / 31–60 / 61–90 / 90+ days per client (top 10).
3. **Recent Payments** — last 10 with invoice link.
4. **Expense vs Revenue chart** — per vertical, current quarter.
5. **Payroll card** — current month status: locked/open, quick action Run Export (after month end).

### 17.6 Super Admin dashboard
HR tiles 1+3, Finance tile 1, PM risks widget, plus: **System card** — queue depth, failed jobs (24h), storage used, last backup time, Sentry errors (24h); **Audit ticker** — last 10 sensitive actions.

### 17.7 Client portal dashboard
Card per scoped project: name, % complete, current milestone, last shared update date, files shared count, "awaiting your approval" badge with count. Below: recent updates feed (client-visible events only). Approvals badge in nav mirrors pending count.

---

## 18. User Journeys (per role — happy paths, each step ≤ one click/tap away)

- **Employee: a working day** — Login → Dashboard → Check In → My Tasks Today → Acknowledge new task → Start (In Progress) → work; upload draft file → Submit for Review → (lunch) Check Out → Check In (session 2) → receive "sent back" notification → open comment → fix → resubmit → Check Out → auto day summary visible next morning.
- **Employee: correction & leave** — Forgot check-out yesterday → login prompt "auto-closed session" → Request regularization with reason → TL approves → record corrected. Separately: My Leave → Request (type, dates, reason) → sees pending → notification on approval → balance updates.
- **Team Lead: daily loop** — Login → Pending Reviews → open submission → view files/checklist → Approve (moves to Client Review, client notified) or Send back with comment → check Team Now for idle flags → approve 2 leave requests inline → create task from board, assignment suggestion shows ranked members with load → assign.
- **Project Manager: project lifecycle** — Create project (client, dates, budget) → add modules → create tasks, assign TL → monitor board → nudge stale Client Review items → task approved by client → Completed → notify Finance ("ready to invoice" appears in Finance queue) → after invoice, Close task → project hits 100% → Archive project.
- **HR: month cycle** — Daily: dashboard queue (regularizations, leave) → weekly: attendance report per team → month end: review 3-lates alerts → lock month → Payroll Export → download CSV → import to payroll tool.
- **Finance: invoice-to-cash** — Ready-to-invoice queue → create invoice from completed tasks (lines prefilled, editable) → PDF preview → Send (emails client, appears in portal) → client pays part → Record payment (Partially Paid) → due date passes → auto Overdue → reminder email → final payment → Paid → P&L reflects it.
- **Client Approver** — Email "deliverable ready" → login portal → Approvals → open deliverable → preview file, view versions → Approve or Request Revision with comment → confirmation → progress view updates → later views invoice and pays offline → sees invoice marked Paid.
- **Super Admin: setup & control** — First login → Settings: work hours, leave policy, holidays, branding, SMTP, AI keys → create departments/teams → invite HR → spot-check Roles & Permissions → weekly: audit log review, system card health check.
- **Freelancer** — Invite email → set password → dashboard shows only My Tasks (no attendance/leave) → Acknowledge → work → upload deliverable → Submit → approved → sees task history; payment handled by Finance as project expense.

---

## 19. Table, Filter & Search Standards

**Global standard for every data table:** server-side pagination (25/page default, 25/50/100 selector) · column-header sorting · filter bar with chips (active filters + one-click clear) · search box scoped to that table · **per-user saved filters** (name + save current set) · **CSV export of the current filtered view** wherever Sec 5/11 grants export · bulk selection with checkboxes where bulk actions defined · **column visibility toggle, remembered per user**.

| Table | Default sort | Filters | Search fields | Bulk actions |
|---|---|---|---|---|
| Employee directory | Name A→Z | Department, team, role, status, resource type, skill tag | Name, email, phone | Export |
| My Tasks / task lists | Deadline soonest | Status, priority, project, module, deadline range, client-facing | Title, description | Change status, reassign (if permitted) |
| Projects | Recently active | Type (project/stream), status, client, PM | Name, client name | Archive (SA/PM) |
| Attendance (HR/team) | Date newest | Person, team, date range, mark (late/half/OT/absent) | Person name | Export |
| Regularizations | Oldest pending | Status, team, date range | Person name, reason | Approve, Reject |
| Leave requests | Oldest pending | Status, type, team, date range | Person name | Approve, Reject |
| Invoices | Issue date newest | Status, client, project, date range, overdue-only | Invoice no., client | Export |
| Expenses | Date newest | Project, category, date range | Description, reference | Export |
| Files (project) | Uploaded newest | Visibility, uploader, type | Filename | Mark client-visible (permitted roles) |
| Audit log | Time newest | Actor, action type, entity, date range | Entity id, actor name | Export |
| Notifications | Time newest | Unread only, event group | — | Mark all read |

---

## 20. Global Search

- Top-bar search on every internal page; keyboard shortcut **"/"**. Results grouped by type with counts; **Enter opens the top result**; "view all" per group opens the filtered table.
- **Searchable in V1 (Postgres full-text):** Projects & work streams (name, description) · Tasks (title, description) · Comments · Files (filename) · Employees & freelancers (name, email, skill tags) · Clients & client users (org, name, email) · Invoices (number, client).
- **Not searchable:** attendance records, leave, audit log, settings, salary data — reached by navigation & their own table filters, never global search.
- **Every result permission-filtered before display** (server-side): a TL never sees another team's tasks in results.
- **Client portal search is portal-local:** scoped projects, shared files, own invoices only.

---

## 21. Report Column Definitions

All reports take a date range + the scope filters shown; all export **CSV and PDF**; all numbers derive from **immutable history (status log, sessions), never from editable current fields**.

| Report | Row = | Columns |
|---|---|---|
| **Attendance** | Person × period | Employee · Team · Working days · Present · Absent · Late count · Half-days · Overtime days · Leave days (by type) · Total worked hrs · Total idle hrs · Idle % · Regularizations applied |
| **Productivity** | Person × period | Employee · Team · Tasks completed · Estimated hrs (completed) · Actual hrs · Estimate accuracy % · Avg time in In Progress · Avg time in Review · Sent-back count · On-time completion % |
| **Project status** | Project | Project · Client · PM · Type · Tasks by status (one column per status) · Overdue count · % complete · Forecast completion (AI) · Risk level · For streams: throughput/week (last 4) |
| **Finance: invoicing** | Invoice | Invoice no. · Client · Project · Issue date · Due date · Amount · GST · Total · Paid · Balance · Status · Days overdue |
| **Finance: dues aging** | Client | Client · Total outstanding · 0–30 · 31–60 · 61–90 · 90+ · Oldest invoice no. |
| **Finance: P&L** | Vertical × period | Vertical · Invoiced revenue · Collected · Expenses (by category columns) · Estimated labor cost · Net |
| **Payroll export (CSV)** | Employee × month | Employee code · Name · Working days · Payable days · Leave (paid, by type) · Unpaid leave days · Half-day deductions (3-lates) · Overtime days · Remarks |

---

## 22. Notification Behavior

- **Priority levels:**
  - **Critical** (leave escalation, invoice overdue, security: new-device login, account lockout) — **email always sent regardless of preference**, in-app pinned to top until read.
  - **Normal** (assignments, reviews, approvals, mentions) — per user preference.
  - **Low** (digest content, FYI watch updates) — **never emailed individually, digest only**.
- **Read/unread:** unread bold with dot; opening the notification or its target marks it read; "Mark all read" available; bell badge = unread count, capped display at **99+**.
- **Grouping:** same event type + same target within 1 hour collapses ("5 comments on Task X"); expanding shows individuals.
- **Expiry & retention:** in-app notifications auto-delete after **90 days** `[ASSUMED]`. Deleting a notification never deletes the underlying record.
- **Delivery rule:** notify a user only if they **still have permission** to open the target at delivery time; if permission was lost, drop it.

---

## 23. Settings Catalogue (complete enumeration)

Editor role in brackets. **Every change here writes an audit entry.**

| Group | Settings |
|---|---|
| **Company [SA]** | Company name · Logo (app + invoice) · Brand colors (primary, accent) · Address & GSTIN for invoices · Financial year start month · Timezone (default Asia/Kolkata) |
| **Attendance [HR]** | Work start time · Work end time · Working days (per weekday toggle) · Grace period / late threshold time · Half-day hours threshold · Overtime hours threshold · Idle minutes threshold (global + per-role overrides) · 3-lates rule (count, deduction) toggle & values · Auto-close time for open sessions · Monitoring data retention months |
| **Holidays [HR]** | Holiday list (date, name), yearly; import from previous year |
| **Leave [HR]** | Per leave type: name · annual quota · accrual on/off, rate/month · carry-forward on/off, cap · requires approval · counts weekends toggle. Escalation hours (default 48) · Overlap warning on/off |
| **Org [HR/SA]** | Departments (map to P&L vertical) · Teams (department, Team Lead) · Skill tag list · Employee code format |
| **Roles & Permissions [SA]** | Grant/revoke each capability key per role (seed = Sec 3 matrix) |
| **Finance [Finance/SA]** | Invoice number format · Default GST % · Payment modes list · Expense categories · Per-role hourly cost rates (for P&L labor estimate) · Invoice PDF footer text · Payment terms days (default 15 `[ASSUMED]`) |
| **Notifications [SA]** | Enable/disable each event type globally · Digest send hour · Critical-event email override list |
| **Files [SA]** | Max upload size · Blocked extensions list (default: executables) · Presigned URL lifetime minutes |
| **Security [SA]** | Session timeout minutes per role group · Failed-login lockout count & minutes · Password minimum length & rules · Force password reset (per user action) |
| **Integrations [SA]** | SMTP (host, port, user, from-address) with "send test email" · AI providers: per-feature provider + model + API key, per-user daily limit · Object storage credentials · Sentry DSN |
| **Client portal [SA]** | Portal subdomain display name · Default digest frequency · Approval reminder days |
| **Data [SA]** | Backup status view (read-only) · Retention values summary · Manual export triggers |

---

## 24. Validation Rules

**Server-side always; mirrored client-side for instant feedback.** Anything not listed: required fields per module specs, trimmed whitespace, no leading/trailing spaces stored.

| Entity | Rules |
|---|---|
| **User / Employee** | Name: required, 2–150 chars, letters/spaces/.'- only. Email: required, valid, **unique system-wide (including deactivated)**. Phone: optional, 10–15 digits. Employee code: unique. Join date: not in future. Role: required, one of seven. Reporting manager: cannot be self; cannot create a cycle. |
| **Client org / user** | Org name: required, 2–200, unique. Client user email: **unique system-wide (an email cannot be both staff and client)**. Scope: at least one project with a level (Viewer/Approver) before invite is sent. |
| **Project / Stream** | Name: required, 3–200, unique within client. End date ≥ start date (projects); streams have no end date. Client: required for client-facing projects. Budget: ≥ 0. |
| **Task / Subtask** | Title: required, 3–255. Estimated hours: 0.25–999, **quarter-hour steps**. Deadline: required for client-facing tasks; warn (not block) if past. Assignee: must have task capability; **freelancer assignable only by PM**. Subtask cannot have subtasks. **Cannot close a task with open subtasks.** |
| **Attendance** | Check-in requires no open session (else prompt to close/regularize). Session end > start. Regularized time cannot overlap another session for that person. Regularization reason: required, ≥ 10 chars. **Cannot regularize dates in a locked payroll month.** |
| **Leave** | To ≥ from; half-day only on single-day requests. No overlap with own approved leave. Balance check at request **and again at approval** (excess → auto-convert to Unpaid with notice). Cannot request for dates in a locked payroll month. Reason: required for Unpaid and Sick > 2 days. |
| **Invoice** | At least one line item. Qty > 0; rate ≥ 0; GST % 0–28. Due date ≥ issue date. Number: unique, auto-assigned, **never reused (cancelled numbers stay burned)**. Editing after Sent: only status/payments; **content edits require cancel-and-reissue, audit-logged**. Payment amount > 0 and ≤ remaining balance. |
| **Files** | Size ≤ configured max. Extension not in blocked list. Filename sanitized for storage; original name preserved for display. Version note optional ≤ 500 chars. |
| **Comments** | 1–5000 chars. @mention must resolve to a user with access to the task. Client-visible comment allowed only on client-visible items. |
| **Settings** | Times valid & end > start. Thresholds within sane bounds (idle 1–60 min; late within work hours). Quotas 0–365. Every settings change validated **as a set** (e.g. half-day hours < full-day hours). |

---

## 25. Edge Cases & Failure Behavior (each a testable requirement)

| Situation | Required behavior |
|---|---|
| **Employee deactivated with active tasks** | Sessions revoked immediately; open tasks **auto-return to Assigned with assignee cleared** and TL notified per task; history preserved; person still appears (marked inactive) in past records/reports. |
| **Team Lead / PM deactivated** | **Block deactivation until a replacement is chosen in the same dialog**; approvals pending with them re-route to the replacement. |
| **Client org deactivated** | All its client users lose access immediately; projects remain internally; portal links show a friendly "access ended" page; invoices/dues remain visible to Finance. |
| **Client user removed while approval pending** | Approval re-routes to remaining Approvers on that project; if none, PM is alerted to appoint one. |
| **Invoice paid twice / overpaid** | Recording a payment exceeding balance is **blocked with exact remaining amount shown**; duplicate reference number warns and requires confirmation; every payment entry audit-logged and **reversible only by a compensating negative entry, never deletion**. |
| **Duplicate / overlapping attendance** | Second check-in with an open session is rejected with pointer to the open session; overlapping regularizations rejected at validation. |
| **Browser closed / power failure while checked in** | Session stays open (server-side); heartbeat gap accrues idle; auto-close at day end flags it; next login prompts regularization. **No data loss — check-in state lives server-side only.** |
| **Internet drops during check-in/out tap** | **Idempotent submission**: action carries a client-generated key; retry cannot create duplicates; UI shows pending state until server confirms. |
| **Two approvers act simultaneously** | **First write wins**; second receives "already actioned by {name} at {time}" and record refreshes. Applies to leave, regularization, reviews, client approvals. |
| **Task deadline passes mid-review** | Overdue flag appears (computed), no status change; reviewer sees it highlighted. |
| **File scan finds infection** | Version quarantined and never downloadable; uploader and PM notified; audit entry; other versions unaffected. |
| **Upload interrupted** | Incomplete objects invisible (version recorded only after scan passes); orphaned partial uploads cleaned by a daily job. |
| **Email provider down** | Queue retries 3× with backoff, then marks failed and surfaces on Super Admin system card; in-app delivery unaffected. |
| **AI provider down / rate-limited** | Degrades gracefully: cached last daily summary shown with timestamp; forecast falls back to rule-based; assistant replies "temporarily unavailable". **Never blocks any non-AI flow.** |
| **WebSocket unavailable** | App silently falls back to **30-second polling** for badges & boards; no user-facing error. |
| **Payroll month locked, correction needed** | HR unlocks month (SA-approved, audit-logged) → corrections → re-export marked "revision 2"; **exports are immutable snapshots stored with timestamp**. |
| **Leave approved, then dates gain a new company holiday** | Nightly job recomputes: holiday days refunded to balance automatically, employee notified. |
| **Deletion policy** | **Nothing user-facing is hard-deleted in V1**: users, clients, projects, tasks, files are deactivated/archived/cancelled. Hard deletion exists only via retention jobs (monitoring data, old notifications). |
| **Clock skew / timezone** | All times stored **UTC**, displayed in company timezone; **client-device time never trusted for attendance — server time only**. |

---

*End of reference. Source: `Rademics_ERP_Production_Build_Plan_v2.1.docx`.*
