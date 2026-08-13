# Crux Client Escalation Matrix — Deployment Guide

This is a Google Apps Script Web App. It runs on Google's infrastructure, stores data in a Google Sheet, and sends email through your authorised Google Workspace / Gmail account. **No SMTP passwords, no separate database, no external hosting is required.**

## 1. What you get

- One Apps Script project (all `.gs` and `.html` files in this folder)
- One Google Spreadsheet, auto-created on first run, that acts as the datastore
- One time-driven trigger (`tick`) running every 5 minutes
- A domain-restricted web-app URL you can share with your Crux team

## 2. Prerequisites

- A Crux Google Workspace account (`you@crux…`) with Gmail enabled
- Rights to create Apps Script projects and Google Sheets on that account
- (Optional) Ability to configure domain-restricted web-app access

## 3. Create the Apps Script project (once)

1. Go to <https://script.google.com/> → **New project**.
2. Rename the project to *Crux Escalation Matrix*.
3. In the editor, delete the default `Code.gs`.
4. Create the following files (`+` icon → **Script** or **HTML**):

    | File name            | Type    | Paste content from                |
    |----------------------|---------|-----------------------------------|
    | `Code.gs`            | Script  | `Code.gs`                         |
    | `Sheets.gs`          | Script  | `Sheets.gs`                       |
    | `Utils.gs`           | Script  | `Utils.gs`                        |
    | `Auth.gs`            | Script  | `Auth.gs`                         |
    | `Clients.gs`         | Script  | `Clients.gs`                      |
    | `Email.gs`           | Script  | `Email.gs`                        |
    | `Scheduler.gs`       | Script  | `Scheduler.gs`                    |
    | `Escalation.gs`      | Script  | `Escalation.gs`                   |
    | `Import.gs`          | Script  | `Import.gs`                       |
    | `Index.html`         | HTML    | `Index.html`                      |
    | `Styles.html`        | HTML    | `Styles.html`                     |
    | `App.html`           | HTML    | `App.html`                        |

5. Show the manifest: **Project Settings → Show "appsscript.json" in editor**.
   Replace its contents with the `appsscript.json` from this folder.

## 4. First-time bootstrap

1. In the editor, select the function **`setup`** from the dropdown next to the ▶ Run button.
2. Click **Run**. Google will prompt for authorisation — approve all requested scopes with your Crux account.
3. The `setup` function creates the datastore spreadsheet, seeds settings and templates, marks the deploying user as ADMIN, and installs the `tick` trigger.
4. Check the execution log — it prints the URL of the newly-created spreadsheet. Bookmark that URL.

## 5. Deploy as a web app

1. In the top-right of the editor, click **Deploy → New deployment**.
2. Type: **Web app**.
3. Description: *Crux Escalation Matrix v1*.
4. Execute as: **Me** *(your Crux service account — this is required so scheduler + email quotas belong to a single identity)*.
5. Who has access:
   - **Only people in your Crux domain** *(recommended)*, or
   - **Anyone with the link** *(if you must expose it externally)*
6. Click **Deploy**. Copy the web-app URL — this is what your users open.

> To update after code changes: **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**.

## 6. Sanity checks

- Open the web-app URL in an incognito window signed in with your Crux account. You should see the dashboard.
- Go to **Admin → Setup** and click **Seed demo data** to populate 3 sample clients.
- Go to **Admin → Settings**:
  - Set `FROM_NAME`, `REPLY_TO`, `DEFAULT_CC`, `ESCALATION_MANAGER`.
  - Set `DRY_RUN = true` and `TEST_EMAIL_OVERRIDE = your.email@crux…` for the first few days.
- Click **Send test email** to confirm Gmail sending works.
- Go to **Admin → Automation** and click **Run 25th reminder**, **Run LWD reminder**, **Run monthly dispatch** to verify end-to-end flows *(all going to your override in test mode)*.

## 7. Going live

1. In **Admin → Settings**, set `DRY_RUN = false`.
2. Confirm the `tick` trigger is installed (**Admin → Setup → Install tick trigger** is idempotent).
3. Make sure at least one Location Head is mapped on every client (`DefaultLocationHead`).
4. Bulk-upload your live clients + branches + matrix under **Clients → Bulk import**.

## 8. Operations

### Automated jobs (Asia/Kolkata)

| Job                         | When                                             | What it sends                                                     |
|-----------------------------|--------------------------------------------------|-------------------------------------------------------------------|
| 25th reminder               | Day = `REMINDER_DAY_1` (25) at ≥ `REMINDER_TIME` | Reminder to each Location Head grouped by their assigned clients  |
| Last-working-day reminder   | Last working day (skips Sat/Sun/holidays)        | Same as above                                                     |
| Monthly dispatch            | Day = `MONTHLY_DISPATCH_DAY` (1) at ≥ time       | Complete → matrix to client, Incomplete → internal escalation     |

Every job records itself in `REMINDER_LOG` with a `JobKey = YYYY-MM-<TYPE>`. Duplicate execution is refused via LockService + JobKey lookup + per-recipient IdempotencyKey.

### Email quotas

Gmail (Workspace) allows ~1,500 recipients / day per account. If you exceed this the send throws — the failure is captured in `EMAIL_LOG.Status = FAILED`. Admin can **Retry** failed emails from the Logs view.

### Emergency controls

- Set `DRY_RUN = true` at any time — automation continues to *plan* sends but routes them all to `TEST_EMAIL_OVERRIDE`.
- Deactivate a client (Status = INACTIVE) — it is skipped in all jobs.
- Deactivate a user (Status = INACTIVE) — the app rejects their requests.

## 9. Backup

The spreadsheet lives in Drive; enable Drive backups and version history. To restore, revert the version in Drive.

## 10. Where things live

- **Datastore spreadsheet**: `Script Properties → CRUX_SS_ID` (printed on setup)
- **Users**: `USERS` sheet — first-time users self-register as PENDING; admin approves
- **Config**: `SETTINGS` sheet — editable from *Admin → Settings*
- **Email templates**: `EMAIL_TEMPLATES` sheet — editable from *Admin → Templates*
- **Idempotency**: `REMINDER_LOG` + `EMAIL_LOG.IdempotencyKey`
- **Audit**: `AUDIT_LOG` sheet — every mutation writes a row

## 11. Publishing on GitHub

Only the source files in `/app/apps-script/` need to live in GitHub. Deployment happens in Google Apps Script — GitHub does not host the running app.

If you want to sync GitHub → Apps Script automatically, install `clasp` (`npm i -g @google/clasp`), run `clasp login`, `clasp clone <SCRIPT_ID>` inside a local copy, and set up a GitHub Action that runs `clasp push` on merges to `main`.
