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

### Redeploying updates (very important)

Every time you change any `.gs` or `.html` file (whether by pasting new code from GitHub into `script.google.com` or by using `clasp push`), you MUST cut a **new deployment version** — Apps Script does NOT auto-publish edits. Otherwise your live URL keeps serving the OLD code.

Two ways:

**Option A — Manual (once every change)**

1. In the Apps Script editor, paste in the updated file contents. Save (Ctrl/⌘+S).
2. Top-right → **Deploy → Manage deployments**.
3. Find your existing deployment (the one whose URL you already gave people). Click the **pencil / edit** icon.
4. Under **Version**, open the dropdown → **New version**. Optionally add a description ("v1.3.2 — Date fix").
5. Click **Deploy**. The URL stays the same; the code behind it updates within ~30 seconds.

> If you accidentally click *"New deployment"* instead of editing the existing one, you'll create a **second, different URL**. Your old URL will keep serving the old code. To fix: go to Manage deployments → Archive the new one → edit the original one instead.

**Option B — Automatic via GitHub (recommended long-term)**

Set up `clasp` + the workflow in `CI_CD.md` — once configured, `git push origin main` pushes source into Apps Script within a minute. Cutting a new deployment version still requires *Actions → Run workflow → deploy = true* (a one-click step).

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

If you want to sync GitHub → Apps Script automatically, install `clasp` (`npm i -g @google/clasp`), run `clasp login`, `clasp clone <SCRIPT_ID>` inside a local copy, and set up a GitHub Action that runs `clasp push` on merges to `main`. See `CI_CD.md` for the ready-made workflow.

> **Note on GitHub vs Google Sheets** — GitHub is only used to keep the *source code* (`.gs` and `.html` files) under version control. It is **not** part of the running app. At runtime, all data lives in the Google Spreadsheet the app creates on first run — clients, branches, matrix, users, logs, settings and templates. Nothing your team enters ever leaves Google.

## 14. The "This app was created by another user" warning

The first time any user opens the deployed URL, Google shows a screen that reads roughly:

> *"This application, created by <you>, is requesting permission to access your data. This application is not verified by Google."*

This is Google's **standard warning for all unverified Apps Script Web Apps** — verification is only granted after paid OAuth verification, which is disproportionate for an internal tool. What you can do:

- **Domain-restricted deployment** (recommended) — deploying with access = *Only people in cruxindia.co.in* keeps the warning as a one-time acceptance per user. After they click *"Advanced → Go to Crux Escalation Matrix (unsafe)"* → *Allow*, subsequent opens are smooth.
- **Google Workspace admin trust** — a Google Workspace super-admin can pre-approve the script for the domain in *Admin Console → Security → API Controls → Domain-wide delegation*, or by publishing it as an internal app in the Workspace Marketplace. Either removes the warning for everyone in the domain.

The warning is cosmetic; it does not indicate anything wrong with your build.

## 12. Client Portal (read-only, tokenised)

The tool includes a **read-only client-facing portal**. Any admin/manager/location-head can click **🔗 Client portal link** on a client's detail page to get a signed URL of the form:

```
<WEB_APP_URL>?view=portal&c=<ClientID>&t=<HMAC>
```

Send this to your client — they open it in a browser and see their **current escalation matrix + branch contacts**, without needing a Crux login. The token is an HMAC-SHA256 of the client id keyed with a secret stored in Script Properties. If a link ever leaks, run *Admin → Setup → 🔒 **Rotate portal secret*** to invalidate **every** existing link at once.

### Access mode considerations

Apps Script has one *Access* setting per deployment. The portal behaves differently depending on it:

| Deployment access                       | Behaviour                                                                                                |
|-----------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Only people in your Crux domain**     | Portal works, but only Crux users can open it — safest choice for a first roll-out; useful internally.   |
| **Anyone with the link**                | Any recipient of the signed URL can view the matrix (still gated by token). Best for actual client-share.|
| **Anyone (anonymous)**                  | Same as above; also removes Google login prompt. Best for the smoothest client experience.               |

Choose the one that fits your risk appetite. You can maintain **two separate deployments** — a domain-only one for the internal SPA and an anyone-with-link one dedicated to the portal — and share only the portal URL externally.

## 13. Gemini AI

See `AI.md` for the full Gemini integration guide (setup, features, safety, and troubleshooting).
