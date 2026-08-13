# Crux Escalation Matrix — User Manual

## Who uses what

| Role           | Sees                                    | Can do                                                          |
|----------------|-----------------------------------------|-----------------------------------------------------------------|
| Admin          | Everything                              | Manage clients, branches, matrix, users, settings, templates, holidays, run/retry jobs |
| Manager        | Dashboard, all clients (read+edit), escalations, logs | Update matrices, raise escalations, view logs                   |
| Location Head  | Dashboard, only their assigned clients  | Update matrix for their clients, log/raise escalations           |
| Viewer         | Read-only Dashboard, Matrix, Escalations| Read only                                                        |

Access is granted by **Google Workspace sign-in**. New sign-ins are auto-created as `PENDING` (except the very first user, who becomes `ADMIN`). Ask an admin to activate you.

## Daily journey

### For a Location Head

1. **Dashboard** — see your incomplete matrices, open escalations, monthly emails.
2. **My Clients** — pick a client, open **Escalation Matrix** tab, fill Name/Mobile/Email for all 5 levels, click **Save matrix**.
3. Add or edit branches from the **Branches** tab. Branch Code must be unique per client.
4. If a banker calls with a complaint → **Escalations → + Log escalation**.
5. If you need to formally escalate something on behalf of Crux → **Escalations → + Raise escalation** — this immediately sends an email and logs it.

### For an Admin

1. Once, from the Apps Script editor, run `setup` (creates spreadsheet, seeds admin, installs trigger).
2. In the web app, go to **Admin → Setup → Seed demo data** (optional; only for first-run testing) and **Install tick trigger** (already done by `setup` but idempotent).
3. **Admin → Settings** — fill sender name, reply-to, default CC, escalation manager. Optionally turn on `DRY_RUN` while you're validating.
4. **Admin → Templates** — refine subject and body for `REMINDER`, `DISPATCH`, `INCOMPLETE`, `RAISE_ESCALATION`, `TEST` templates. Placeholders in `{{DOUBLE_BRACES}}` are auto-substituted.
5. **Admin → Holidays** — enter all fixed and declared holidays for the current + next year (used for last-working-day calc).
6. **Admin → Users** — approve any pending sign-ins, assign role and Location Head code.
7. **Admin → Automation** — sanity-check the next scheduled jobs. Use **Run …** buttons to manually fire jobs (respects idempotency by month/type; use *Force* if you truly need to re-send within the same month).

## The 5-level matrix

Each client has exactly five escalation levels:

1. **SPOC**
2. **Team Leader**
3. **Branch Manager**
4. **Zonal Manager**
5. **Head Office**

For every level you must record **Name, Mobile, Email**. A client with even one missing field is treated as **Incomplete**.

- **Complete** clients → on the 1st, receive the finalised matrix in the body of an email, with all 5 escalation emails as CC (deduped, and never duplicating the client's own To address).
- **Incomplete** clients → the client is **not** emailed. Instead the Location Head receives an *"Incomplete matrix"* notice listing the missing fields.

The client email address on the client record is separate and never counts as one of the 5 levels.

## Bulk import

**Clients → Bulk import** supports Clients, Branches and Matrix.

Flow: pick a kind → download the template → fill offline → paste back → **Validate** (shows counts of Valid / Invalid / Update / Create / Duplicates in file) → **Commit valid rows**.

- Only rows marked `CREATE` or `UPDATE` are written.
- Invalid rows are rejected with a per-row error list.
- Duplicates within your file are flagged so you don't accidentally overwrite the first one with the second.
- Matching key:
  - Clients → by `ClientName`
  - Branches → by (`ClientName`, `BranchCode`) — this is what makes multiple branches under one client possible without recreating the client.
  - Matrix → by (`ClientName`, `Level`)

## Escalation module

### Log escalation

Use when a banker/client calls in about an issue. Captures date/time, contact, category, severity, description, required action, target date. Owner defaults to the client's Location Head. Status starts at `OPEN`; you can update to `ASSIGNED / IN_PROGRESS / RESOLVED / CLOSED` from the row.

### Raise escalation

Use when Crux wants to formally escalate. In addition to logging, this composes an HTML email (from the `RAISE_ESCALATION` template), sends it to the recipients you enter, and logs the send in `EMAIL_LOG`.

## Automated schedule

All times are in `Asia/Kolkata`.

- **25th at 12:00 PM** — reminder to Location Heads with assigned clients.
- **Last working day at 12:00 PM** — reminder again. Sat, Sun and any entry in the `HOLIDAYS` sheet with `Status = ACTIVE` are skipped.
- **1st of the month at 10:00 AM** — validate + dispatch. Complete matrices go to the client; incomplete ones raise an internal escalation to the Location Head.

Each job records `REMINDER_LOG.JobKey = YYYY-MM-<TYPE>`. Once `Result = OK`, that job is refused for the same month unless the admin ticks *Force*.

## Email log & retries

**Logs → Email** shows every send:

- `SENT` — Gmail accepted delivery.
- `FAILED` — the send raised an exception (see `Error`). Admin can click **Retry** on a row (uses a new idempotency suffix so successful sends aren't duplicated).
- Retries stop at `RETRY_LIMIT` (default 3, editable in Settings).

## Test mode / dry run

Set **Settings → `DRY_RUN = true`** and **`TEST_EMAIL_OVERRIDE = your.email@…`**. All automation and manual sends will:

- rewrite `To` to the override,
- clear `CC / BCC`,
- prepend a *TEST MODE* banner to the body showing the original recipients.

Turn `DRY_RUN` back to `false` before go-live.

## Troubleshooting

| Symptom                              | Try this                                                                 |
|--------------------------------------|--------------------------------------------------------------------------|
| Automation never runs                | *Admin → Automation* — check the `tick` trigger is installed. If not, click **Install tick trigger**. |
| An email says FAILED                 | Open *Logs → Email*. Look at `Error`. Common: recipient bounced, quota exceeded, address invalid. |
| Client received nothing on the 1st   | Check `REMINDER_LOG` — is there a `YYYY-MM-MONTHLY_DISPATCH` row? If Result is PARTIAL, look at `EMAIL_LOG` for that client. Most likely the matrix was incomplete → an INCOMPLETE_ESCALATION was sent internally instead. |
| Location Head can see other clients  | Check their `LocationHead` and the client's `DefaultLocationHead` — the scoping filter matches on the email or the LocationHead code. |
| Sender name is wrong                 | *Admin → Settings → `FROM_NAME`*.                                        |
| Matrix email is too plain            | *Admin → Templates → DISPATCH → Body* — HTML is allowed.                 |

## Known limitations

- Gmail 1500 recipients/day quota applies. For huge tenant lists, switch to Google Workspace with a higher quota or fan out over multiple days.
- Apps Script triggers have ~5-minute granularity; scheduled jobs may fire up to 5 minutes after their nominal time. This is fine for a 12:00 PM policy.
- The web app is domain-restricted (recommended). External vendors cannot use the app directly, but they still receive the automated emails.
- The datastore is a single Google Sheet. If it grows beyond ~5 million cells (unlikely for this use-case), migrate to a database.
