# Pending — inputs needed from you (management / owner)

> This is the running list of everything the build needs **from you**, so we can work in parallel.
> I keep building everything that runs on sensible **defaults**; you supply these when convenient.
> **Nothing here blocks current development** — each item has a working default until you provide the real value.
> When you provide something, tell me and I'll wire it in and tick the box.

Legend: 🟢 not blocking anything yet · 🟡 needed before that phase ships · 🔴 blocks go-live.

---

## A. Provide anytime (parallel, no rush)

- [ ] **§15 Assumption sign-off (one pass).** 🟢 Confirm or correct these defaults. All are editable later in Admin Settings, so this never blocks — but confirming early avoids rework.
  - Working days **Mon–Sat**, hours **9:00–18:00 IST**, late after **9:15**, half-day **<4h**, overtime **>9h**, **3 lates = ½-day** deduction.
  - Leave quotas: **Casual 12**, **Sick 6**, **Earned 15** (1.25/mo accrual, carry-forward cap 30).
  - Invoice numbering **`RAD-{YYYY}-####`**, **GST 18%**, **INR only**.
  - Monitoring-data retention **12 months**; in-app notification retention **90 days**.
  - AI per-user limit **50 calls/day**.
  - The **Role & Permission Matrix seed** (Spec §3) as written — this is the big one; a wrong grant here is a security decision.
- [ ] **Brand assets.** 🟡 (needed to make the UI look "official"; placeholders used until then)
  - Official **logo** (SVG or high-res PNG, ideally a light + dark variant).
  - Brand **hex codes** (primary, accent). *Currently using placeholders: navy `#1B2A4A`, accent blue `#2563EB`, gold `#C9A227`.*
  - Any **favicon** / wordmark.
- [ ] **Company details for invoices (Spec §23 Company settings).** 🟡 Legal company name, address, **GSTIN**, financial-year start month. *(Needed before Finance/Phase 8; harmless to provide now.)*

---

## B. Needed before specific phases

- [ ] **SMTP provider credentials** (host, port, user, password, from-address). 🟡 *Needed before real email in staging/prod (Phase 8 / launch). Dev uses Mailhog — no action needed to build.*
- [ ] **AI provider API keys** — Claude / OpenAI / Gemini / Groq (whichever you want enabled), and which provider+model per feature. 🟡 *Needed for Phase 9 AI features to return real output. The gateway is built to work without keys and degrade gracefully, so it doesn't block building.*
- [ ] **Per-role hourly cost rates** (for P&L labor-cost estimates, Spec §5.8, Assumption #9). 🟡 *Needed for accurate Finance P&L (Phase 8). Confirm these rates exist / provide them.*
- [ ] **Payroll export target format** — generic CSV vs. specific **Tally / Zoho** import layout (Assumption #8). 🟡 *Phase 8. Default: documented generic CSV.*
- [ ] **Holiday calendar** — the actual company holiday list for the year (Tamil Nadu list seeded as a placeholder). 🟡 *Phase 3/7.*

---

## C. Needed for deployment / go-live (Phase 10)

- [ ] **Linux VPS** (host + SSH access) for staging + production (Spec §12, Assumption #12). 🔴
- [ ] **Domains**: main app domain + the **client-portal subdomain** (e.g. `app.rademics.com` + `portal.rademics.com`) and DNS access (Cloudflare per §12). 🔴
- [ ] **Sentry DSN** (error tracking, Spec §11) — free tier is fine. 🟡
- [ ] **GitHub repo settings** (optional): branch protection on `main`, and any CI **secrets** (e.g. deploy keys) when we reach CD. 🟢

---

## D. Decisions I've made on your behalf (flag if you disagree)

These are implementer choices the spec delegates to me (Spec §0/§12). All reversible; listed for transparency.

- Monorepo tooling: **pnpm workspaces + Turborepo**.
- Password hashing: **argon2** (`@node-rs/argon2`, prebuilt — no native build).
- Refresh tokens: **opaque, rotated, stored hashed** (more secure than JWT refresh).
- API style: **REST** with a global fail-closed RBAC guard.
- Dev email: **Mailhog**; dev object storage: **MinIO** (both via Docker Compose).

---

## Status snapshot

- ✅ **Phase 1 (Foundation) COMPLETE**: backend (verified 10/10 e2e), internal app + client portal + shared UI (both build clean), GitHub Actions CI. 34 unit tests + full-workspace typecheck green.
- ⬜ **Phase 2 (People & Org)**: next up.
- ⬜ Phases 3–10: queued per [`phase.md`](phase.md).

*Last updated by the build. See [`phase.md`](phase.md) for the full plan and [`RADEMICS_ERP_SPEC.md`](RADEMICS_ERP_SPEC.md) for the spec.*
