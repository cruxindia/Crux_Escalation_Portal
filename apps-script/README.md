# Crux — Client Escalation Matrix

A small, production-ready internal tool for **Crux Risk Management Pvt Ltd** that automates the monthly distribution of the Client Escalation Matrix.

- **Frontend**: HTML/CSS/JavaScript SPA (served by Apps Script)
- **Backend**: Google Apps Script (server-side JavaScript, V8)
- **Datastore**: One Google Sheet, auto-created on first run
- **Email**: Gmail / Google Workspace on the authorised deployer account
- **Scheduler**: One 5-minute time-driven trigger + idempotent job keys
- **Auth**: Google Workspace domain sign-in + role table (`ADMIN / MANAGER / LOCATION_HEAD / VIEWER`)
- **Timezone**: `Asia/Kolkata` (configurable)

## Deployment in 5 steps

1. Create a new Apps Script project at <https://script.google.com/>.
2. Add every file from this folder (paste content into matching `.gs` and `.html` files; replace `appsscript.json`).
3. Run the `setup` function once — this creates the datastore spreadsheet, seeds you as ADMIN, and installs the tick trigger.
4. **Deploy → New deployment → Web app**. Execute as *Me*, access *Only your Crux domain*.
5. Open the URL, go to *Admin → Setup → Seed demo data* (optional) → *Admin → Settings* → send a **Test email**.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the detailed guide and [`USER_MANUAL.md`](./USER_MANUAL.md) for role-based journeys.

## What this tool does (mapped to the spec)

| Spec section | Where it lives                                                             |
|--------------|----------------------------------------------------------------------------|
| §4–5  Client hierarchy + master     | `CLIENTS` sheet, `Clients.gs`, *Clients* view                       |
| §6    Branch master                 | `BRANCHES` sheet, *Client → Branches* tab                           |
| §7–8  Escalation matrix (5 levels)  | `ESCALATION_MATRIX`, *Client → Escalation Matrix* tab                |
| §9    Location Head ownership       | `USERS.LocationHead`, `CLIENTS.DefaultLocationHead`, server-side scoping |
| §10   Bulk upload                   | `Import.gs`, *Clients → Bulk import*                                |
| §11   Validation                    | `validateClientMatrix_`, `Import.gs`                                |
| §12–13 Reminders (25th + LWD)       | `Scheduler.gs → runReminder_`                                       |
| §14   Idempotency                   | `REMINDER_LOG.JobKey` + `EMAIL_LOG.IdempotencyKey` + `LockService` |
| §15–17 Dispatch + incomplete rule   | `Scheduler.gs → runDispatch_`, `Email.gs`                           |
| §18   Retries & failures            | `EMAIL_LOG.Attempt/Status/Error`, *Admin → retry*                    |
| §19   Email configuration           | `SETTINGS` + `EMAIL_TEMPLATES`, *Admin → Templates*                  |
| §20   Admin console                 | *Admin* view                                                        |
| §21   Login + role UX               | Native Google auth, `Auth.gs`                                       |
| §22   Onboarding                    | Pending-approval flow in `whoAmI_` + login screen                    |
| §23–25 Escalation module            | `Escalation.gs`, *Escalations* view                                 |
| §26   Email log                     | `EMAIL_LOG` sheet, *Logs → Email*                                   |
| §27   Audit log                     | `AUDIT_LOG` sheet, *Logs → Audit*                                   |
| §28–31 UI/UX + dashboard + search   | `App.html` + `Styles.html`                                          |
| §32   Security                      | Server-side role checks, no secrets in browser, scope filters       |
| §33   Import UX                     | Validate → Preview → Commit                                         |
| §34   Sheet design                  | `SCHEMA` in `Sheets.gs`                                             |
| §35   Central configuration         | `SETTINGS` sheet                                                    |
| §36   Preflight & safe restart      | Idempotent JobKey design                                            |
| §37   Admin *Run Now*               | *Admin → Automation* actions                                        |
| §38   Dry-run mode                  | `DRY_RUN` + `TEST_EMAIL_OVERRIDE`                                   |
| §39   Error handling                | Friendly errors, technical detail in `AUDIT_LOG`                    |
| §40   Email content                 | HTML templates in `EMAIL_TEMPLATES`                                 |
| §41   Client → N branches           | `BRANCHES.ClientID` FK                                              |
| §42   Reports                       | `Logs` view (email/audit/reminder)                                  |
| §43–47 Order, tests, principles     | Documented in `ARCHITECTURE.md`                                     |

## Files

```
apps-script/
├── appsscript.json         Manifest, scopes, timezone
├── Code.gs                 doGet router + RPC dispatcher
├── Sheets.gs               Schema + generic table CRUD + defaults
├── Utils.gs                Helpers (id, date, holiday, dedupe, validators, template renderer)
├── Auth.gs                 Role table + Google identity + scoping filters
├── Clients.gs              Client / Branch / Matrix domain logic + dashboard summary + seed
├── Email.gs                Send engine, templates, dedupe, dry-run, retry, logging
├── Scheduler.gs            5-min tick + reminders (25th + LWD) + monthly dispatch
├── Escalation.gs           Log escalation + Raise escalation with email send
├── Import.gs               Bulk import (validate → preview → commit) for Clients/Branches/Matrix
├── Index.html              Web-app HTML shell
├── Styles.html             CSS (distinctive ink + amber palette, calm density)
├── App.html                SPA JavaScript (views, forms, tables, modals)
├── templates/
│   ├── clients-template.csv
│   ├── branches-template.csv
│   └── matrix-template.csv
├── DEPLOYMENT.md
├── USER_MANUAL.md
├── ARCHITECTURE.md
├── ACCEPTANCE_TESTS.md
├── CHANGE_REGISTER.md
└── README.md
```
