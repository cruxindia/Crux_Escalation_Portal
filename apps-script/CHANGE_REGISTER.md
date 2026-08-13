# Change / Implementation Register

Tracks what was built, what was intentionally deferred, and what remains open. Grows over time.

## v1.0.0 — Initial delivery

### Implemented

- **Datastore**: Auto-provisioned Google Sheet with 12 tables + stable ID sequences (Sheets.gs).
- **Auth & roles**: Google Workspace identity, USERS sheet, `ADMIN / MANAGER / LOCATION_HEAD / VIEWER`, pending-approval flow, server-side scoping (Auth.gs).
- **Client / branch / matrix**: Full CRUD, one client → many branches, five-level matrix editor, dashboard summary (Clients.gs, App.html).
- **Bulk import**: Validate → preview → commit for CLIENTS / BRANCHES / MATRIX with per-row status (Import.gs).
- **Email engine**: Gmail-based, template rendering, To/CC/BCC dedupe, dry-run override, retry with attempt count, comprehensive EMAIL_LOG (Email.gs).
- **Scheduler**: One `tick` trigger, three idempotent jobs (25th reminder, LWD reminder, monthly dispatch), holiday-aware last-working-day, LockService protection, JobKey + IdempotencyKey duplicate prevention (Scheduler.gs).
- **1st-of-month validation**: Complete matrices dispatched to client with escalation contacts in CC; incomplete matrices trigger an internal escalation only (never the client).
- **Escalation module**: LOG (from banker) and RAISE (formal) flows with history + audit; RAISE composes and sends an HTML email automatically (Escalation.gs).
- **Admin console**: Users, settings, templates, holidays, automation status, Run-Now actions (Force), seed demo data (App.html → renderAdmin\*).
- **Logs**: Email log, audit log, reminder log — searchable, sortable, retry from admin.
- **Test mode / dry run**: Global `DRY_RUN` + `TEST_EMAIL_OVERRIDE` with visible TEST banner.
- **UI**: Distinctive ink-and-amber palette, Fraunces serif headings, JetBrains Mono labels, responsive down to mobile widths, progressive disclosure across Overview / Branches / Matrix tabs.
- **Documentation**: `README.md`, `DEPLOYMENT.md`, `USER_MANUAL.md`, `ARCHITECTURE.md`, `ACCEPTANCE_TESTS.md`, this register, CSV templates.
- **Security**: No secrets in the browser, role checks on every RPC route, record-level scope enforcement on client/branch access, audit log on every mutation and every RPC error.

### Design decisions (documented, not deferred)

- **Google Apps Script + Sheet, not FastAPI+DB** — user must host on GitHub with Sheets as memory; Apps Script + Sheets is the only stack that satisfies both.
- **Native Google identity, not JWT** — leverages Google Workspace SSO; no password DB to secure.
- **`GmailApp.sendEmail`, not SMTP** — no app-password to store or rotate; the deploying user's OAuth grant is the sole credential.
- **One 5-minute tick, not three separate triggers** — cheaper, easier reasoning, and Apps Script triggers drift anyway.
- **Idempotency at two layers**: `REMINDER_LOG.JobKey` (job level) + `EMAIL_LOG.IdempotencyKey` (recipient level) — a `Force` re-run cannot double-send an already-successful client email.
- **Progressive-disclosure UI**: client list → detail → tabs. No mega-form. Bulk actions live behind the *Bulk import* button, not sprinkled on every screen.
- **First user becomes ADMIN**: makes the initial setup self-serve. All subsequent users are `PENDING` until admin approves.

### Intentionally deferred (backlog)

- **Reports export as CSV/Excel** — logs are already viewable; add a `.csv` download endpoint if the team requests it.
- **Per-branch escalation matrix override** — spec treats the matrix as client-level; if branches diverge in future, extend `ESCALATION_MATRIX` with an optional `BranchID` FK.
- **Attachment support in "Raise escalation"** — the RPC accepts a `Details` blob today; attachments would require Drive integration.
- **Scheduled reports emailed to the admin** — a monthly digest can be added as another job in `Scheduler.gs`.
- **`clasp` + GitHub Action** — the codebase is `clasp`-ready but the actual pipeline is out of scope for a Sheets-hosted app.

### Known open items

- The tick trigger requires Apps Script quota. Free accounts get ~6 hours/day of execution time — comfortably enough for this app.
- Gmail 1500 recipients/day limit applies. If Crux exceeds it, ask Google Workspace admin to raise the quota or fan out the dispatch across multiple days.

## Change log

| Date       | Version | Author  | Change                                                                              |
|------------|---------|---------|-------------------------------------------------------------------------------------|
| 2026-01-15 | 1.0.0   | Emergent| Initial build: full spec coverage, docs, templates.                                 |
