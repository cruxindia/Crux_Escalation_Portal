# Architecture Summary

## Runtime shape

```
+------------------------------------------------------------+
|                     Google Apps Script                     |
|                                                            |
|   doGet(e)  →  HtmlService (Index.html + Styles + App)     |
|                                                            |
|   RPC dispatcher (single entrypoint: rpc(action, payload)) |
|      ├── Auth.gs          role check on every call         |
|      ├── Clients.gs       clients/branches/matrix          |
|      ├── Import.gs        bulk import                      |
|      ├── Email.gs         Gmail send + logging + retry     |
|      ├── Scheduler.gs     tick / reminders / dispatch      |
|      ├── Escalation.gs    log & raise escalations          |
|      └── Sheets.gs        low-level table CRUD             |
|                                                            |
|   Time trigger: tick() every 5 minutes                     |
+------------------------------------------------------------+
                        |
                        v
+------------------------------------------------------------+
|                Google Spreadsheet (datastore)              |
|                                                            |
|  SETTINGS · USERS · CLIENTS · BRANCHES · ESCALATION_MATRIX |
|  HOLIDAYS · EMAIL_TEMPLATES · EMAIL_LOG · REMINDER_LOG     |
|  ESCALATIONS · ESCALATION_HISTORY · AUDIT_LOG              |
+------------------------------------------------------------+
                        |
                        v
+------------------------------------------------------------+
|                  Gmail (deployer account)                   |
|   used for every automated + manual send                    |
+------------------------------------------------------------+
```

## Data model (Google Sheet tables)

Each table has a header row and stable IDs (prefix + 5-digit sequence). Row numbers are **never** used as record IDs.

- `SETTINGS(Key, Value, Description, UpdatedAt, UpdatedBy)`
- `USERS(UserID, Name, Email, Mobile, Designation, Role, LocationHead, Manager, Status, CreatedAt, UpdatedAt, UpdatedBy)`
- `CLIENTS(ClientID, ClientName, ClientCode, ClientEmail, ClientCC, DefaultLocationHead, Status, EffectiveFrom, EffectiveTo, Notes, CreatedAt, UpdatedAt, UpdatedBy)`
- `BRANCHES(BranchID, ClientID, BranchName, BranchCode, Address, CruxPOCName, CruxPOCEmpID, CruxPOCMobile, CruxPOCEmail, BranchManagerName, BranchManagerMobile, BranchManagerEmail, LocationHead, Location, Zone, Status, EffectiveFrom, EffectiveTo, Notes, CreatedAt, UpdatedAt, UpdatedBy)`
- `ESCALATION_MATRIX(MatrixID, ClientID, Level 1–5, LevelName, ContactName, Mobile, Email, UpdatedAt, UpdatedBy)`
- `HOLIDAYS(HolidayID, Date, Name, Status, CreatedAt)`
- `EMAIL_TEMPLATES(Key, Subject, Body, UpdatedAt, UpdatedBy)` — one row per template Key
- `EMAIL_LOG(LogID, Timestamp, Type, ClientID, BranchID, ToAddr, CcAddr, Subject, Trigger, SentBy, Status, Attempt, Error, MessageRef, IdempotencyKey)`
- `REMINDER_LOG(JobKey, Type, Month, ExecutedAt, ExecutedBy, Result, Notes)` — one row per (month × job type)
- `ESCALATIONS(EscalationID, Type=LOGGED|RAISED, Date, Time, ClientID, BranchID, BranchCode, ContactName, ContactPhone, Category, Severity, EscalatedAgainst, Description, AssignedOwner, RequiredAction, TargetDate, Status, ClosureDate, ClosureRemarks, CreatedBy, CreatedAt, UpdatedAt)`
- `ESCALATION_HISTORY(HistoryID, EscalationID, Timestamp, User, Field, OldValue, NewValue, Note)`
- `AUDIT_LOG(LogID, Timestamp, User, Action, Entity, EntityID, OldValue, NewValue)`

## Role model & access control

Roles: `ADMIN`, `MANAGER`, `LOCATION_HEAD`, `VIEWER`.

- Identity = `Session.getActiveUser().getEmail()`. Not trusted from the browser; resolved server-side on every RPC.
- New sign-ins are created as `PENDING` (except when the USERS sheet is empty — then the first user becomes `ADMIN` to bootstrap).
- `LOCATION_HEAD` is scoped to clients where `DefaultLocationHead == user's email` or `== user's LocationHead code`. `scopeClientsForUser_` / `scopeBranchesForUser_` / `assertClientAccess_` enforce this on the server.
- `VIEWER` gets read-only endpoints (`clients.list`, `clients.get`, `dashboard.summary`, `escalations.list`, log queries).
- The RPC dispatcher checks `handler.roles` for every action; `ADMIN` always passes. Route-level checks + record-level scope checks give defense-in-depth.

## Scheduler design

Google's time-driven triggers can drift a few minutes and are not reliable at a precise time-of-day. We install exactly **one** trigger (`tick`) that runs every 5 minutes and:

1. Reads current date/time in the app timezone.
2. Checks if today matches `REMINDER_DAY_1` at ≥ `REMINDER_TIME` → run 25th reminder.
3. Checks if today is the computed **last working day** (Sat/Sun/HOLIDAYS-active skipped) at ≥ `REMINDER_TIME` → run LWD reminder.
4. Checks if today matches `MONTHLY_DISPATCH_DAY` at ≥ `MONTHLY_DISPATCH_TIME` → run monthly dispatch.

Each job:

- Acquires `LockService.getScriptLock()` before executing.
- Checks `REMINDER_LOG.JobKey = YYYY-MM-<TYPE>` for `Result = OK`; if present, returns immediately.
- On completion, writes a single row to `REMINDER_LOG` with the summary.
- Each per-recipient email also carries its own `IdempotencyKey` (e.g. `2026-08-DISPATCH-CLI-00042`); `sendEmail_` refuses to send if a `SENT` row already exists with the same key.

Result: even if the tick runs several times around the job hour, or the admin manually triggers a job, no email is sent twice.

## Email pipeline

Every send flows through `sendEmail_({ type, to, cc, bcc, subject, htmlBody, clientId, branchId, idempotencyKey, trigger })`:

1. Resolve `DRY_RUN` and `TEST_EMAIL_OVERRIDE`; if in test mode, rewrite recipients and inject a TEST-mode banner in the body.
2. Deduplicate `CC` against `To`, deduplicate `BCC` against `To + CC`.
3. Deduplicate case-insensitively; drop malformed addresses.
4. Look up the `IdempotencyKey` in `EMAIL_LOG`; if a SENT row exists, skip.
5. Call `GmailApp.sendEmail(...)` with signature appended.
6. Write a row to `EMAIL_LOG` with status (`SENT` / `FAILED`), attempt count, error message, message ref.

Retries: admin can retry a `FAILED` row from *Logs → Email*. The retry uses the same idempotency key + `-retry-N` suffix so a partially-succeeded month cannot double-send.

## Validation & incomplete-matrix rule

Before sending the client email, we call `validateClientMatrix_(client, matrixRows)` which returns `{ complete, missing:[...] }`. `complete` requires:

- `ClientEmail` present and RFC-basic-valid
- For **each of the 5 levels**: `ContactName` non-empty, `Mobile` matches `/^[0-9+\-\s()]{7,}$/`, `Email` valid.

If `complete === false`, the client email is **never** sent. Instead, an *"Incomplete matrix"* internal email is sent to the client's Location Head (CC: default CC + `ESCALATION_MANAGER`).

## UI/UX rules

- **Progressive disclosure**: clients list → client detail (Overview / Branches / Escalation Matrix tabs). No mega-form.
- **Left-aligned, calm density, distinctive palette**: ink `#0e1116` background for the sidebar, paper `#fbfaf7` main area, amber `#d97706` accents. Fraunces serif for headings, IBM Plex/Söhne stack for body, JetBrains Mono for labels — deliberately not the default system stack.
- **Responsive**: sidebar collapses into a scrolling top-bar under 900px so Location Heads can update matrices on mobile.
- **`data-testid`** on every interactive control and every critical status element.

## Security summary

- No passwords, OAuth tokens, or service credentials in the browser.
- Deployment identity = *Me* (the deploying user); scheduler + email send run as that user.
- Web app access = *Only your Crux domain*.
- Role and record ownership checks on every RPC, not just in the UI.
- `AUDIT_LOG` receives a row for every mutation and every RPC error.
- Emails are dedup'd to prevent client email leakage in CC.
- Idempotent scheduler prevents accidental double-sends after restart/failure.

## Configuration register

All operational knobs live in `SETTINGS` (defaults in `Sheets.gs → DEFAULT_SETTINGS`):

| Key                    | Default                        | Notes                                     |
|------------------------|--------------------------------|-------------------------------------------|
| APP_NAME               | Crux Escalation Matrix         | Header title                              |
| COMPANY_NAME           | Crux Risk Management Pvt Ltd   |                                           |
| APP_TIMEZONE           | Asia/Kolkata                   |                                           |
| DATE_FORMAT            | dd-MMM-yyyy                    |                                           |
| REMINDER_DAY_1         | 25                             | Day of first reminder                     |
| REMINDER_TIME          | 12:00                          | HH:mm 24h, TZ = APP_TIMEZONE              |
| MONTHLY_DISPATCH_DAY   | 1                              |                                           |
| MONTHLY_DISPATCH_TIME  | 10:00                          |                                           |
| FROM_NAME              | Crux Risk Management           | Email display name                        |
| REPLY_TO               | (blank)                        |                                           |
| DEFAULT_CC             | (blank)                        | Comma-separated                           |
| DEFAULT_BCC            | (blank)                        |                                           |
| ESCALATION_MANAGER     | (blank)                        | Receives incomplete-matrix escalations    |
| RETRY_LIMIT            | 3                              |                                           |
| DRY_RUN                | false                          |                                           |
| TEST_EMAIL_OVERRIDE    | (blank)                        | Required if DRY_RUN=true                  |
| SIGNATURE              | HTML block                     | Appended to every email                   |

## What was intentionally kept simple

- One spreadsheet, not one per module — data volume is small.
- One tick trigger, not three — cheaper on quota and easier to reason about.
- No separate cron server — Apps Script is enough.
- No SMTP wiring — Gmail through OAuth is more secure and needs no shared password.
- No client-side routing library — vanilla JS keeps the app one file and fast.
