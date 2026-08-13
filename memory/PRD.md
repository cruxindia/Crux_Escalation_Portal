# PRD — Crux Client Escalation Matrix

## Problem Statement
Crux Risk Management Pvt Ltd needs a small, production-ready internal tool to automate the monthly distribution of the Client Escalation Matrix. See original problem statement in the initial user turn (48 sections). The user chose **Google Apps Script + Google Sheets**, GitHub for source hosting, Google Workspace Gmail for automated sending, seed data on.

## Architecture Decision
- **Stack**: Google Apps Script Web App (HTML/CSS/JS SPA) + Google Sheets datastore + Gmail (deployer identity).
- **Auth**: Native Google Workspace SSO + role table.
- **Scheduler**: One 5-min tick trigger + idempotent JobKey per (month × job type) + per-recipient IdempotencyKey; LockService protects against concurrency.
- **Timezone**: Asia/Kolkata (configurable).

## Personas
- **Admin** — manages the whole system: users, settings, templates, holidays, runs jobs manually, retries emails.
- **Manager** — reads everything, can update matrices, can raise escalations.
- **Location Head** — sees only their assigned clients, keeps their matrix current, logs/raises escalations.
- **Viewer** — read-only access to dashboard, matrix and escalations.

## Core Requirements (implemented)
1. Client master with client-level escalation matrix; branch master with per-branch Crux POC & branch-manager contacts.
2. One client → many branches; unique branch code per client; no client duplication.
3. Five-level matrix (SPOC, Team Leader, Branch Manager, Zonal Manager, Head Office) with Name / Mobile / Email each.
4. Location Head ownership; server-side scope enforcement (LH sees only their records).
5. Bulk upload (Clients / Branches / Matrix) with validate-preview-commit flow.
6. Reminders on the 25th at 12:00 IST and on the last working day of the month (Sat/Sun/HOLIDAYS aware).
7. 1st-of-month validation and dispatch. Complete matrices → client email with escalation contacts CC'd (deduped, client never in CC). Incomplete → NEVER sent; internal escalation to Location Head instead.
8. Test mode / dry-run (`DRY_RUN` + `TEST_EMAIL_OVERRIDE`), Admin **Run Now** actions.
9. Full email log with retry; audit log for every mutation.
10. Escalation module with LOG and RAISE actions; RAISE sends the email and logs it automatically.
11. Admin console for users, settings, templates, holidays, automation status.
12. Progressive-disclosure UI, responsive down to mobile widths, distinctive ink+amber palette, calm density.

## What's Implemented
- **v1.0.0** — full spec coverage per problem statement.
- **v1.1.0** — CSV export, escalation attachments, monthly summary digest, CI auto-push.
- **v1.2.0** — Attachment size bar, digest extra recipients, log filters, client portal, Gemini AI (draft, classify, monthly insight, chat).
- **v1.3.0** — **Weekly Snapshot** — three pinned AI-anomaly cards on the Dashboard (ADMIN/MANAGER), server-cached 6h, refreshable, fail-soft.

See `apps-script/CHANGE_REGISTER.md` for the detailed register and `apps-script/ACCEPTANCE_TESTS.md` for the 50-test acceptance matrix.

## Deliverables
Located in `/app/apps-script/`:
- `appsscript.json`, 9 `.gs` files, 3 HTML files
- 3 CSV templates
- `README.md`, `DEPLOYMENT.md`, `USER_MANUAL.md`, `ARCHITECTURE.md`, `ACCEPTANCE_TESTS.md`, `CHANGE_REGISTER.md`
- ZIP bundle at `/app/crux-escalation-matrix.zip`

## Backlog (deferred)
- P1: CSV/Excel export for logs and reports pages.
- P1: Attachments on "Raise escalation" (needs Drive integration).
- P2: Per-branch matrix override (spec is client-level).
- P2: Monthly summary digest to admin.
- P2: `clasp` + GitHub Action CI to push source → Apps Script on merge.

## Known Limitations
- Apps Script trigger drift up to ~5 min (fine for a 12:00 policy).
- Gmail 1500 recipients/day per account; scale via delegated account or fan out days.
- Domain-restricted web app; only Crux domain users can open the UI (external vendors still receive automated emails).

## Not Tested Automatically (by design)
- This is a Google-Apps-Script deployable; the local emergent preview (React/FastAPI/MongoDB) cannot host it. The user must run the 30-test acceptance matrix on their own Google Workspace deployment (see ACCEPTANCE_TESTS.md).
