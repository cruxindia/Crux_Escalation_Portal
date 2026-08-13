# CI Auto-Push — GitHub → Apps Script

Merging to `main` will push every `.gs` / `.html` / `appsscript.json` change to your Google Apps Script project. No more copy-paste.

## One-time setup (10 minutes)

### 1. Install and log in with clasp on your machine

```bash
npm i -g @google/clasp@2.4.2
clasp login          # opens a browser; sign in with the Crux Google account that owns the project
```

### 2. Link your local checkout to the Apps Script project

If the Apps Script project already exists:

```bash
cd apps-script
clasp clone <SCRIPT_ID>          # SCRIPT_ID is in the URL of the Apps Script editor
```

This creates a `.clasp.json` file. **Either** commit it (it only contains the script id) **or** keep it out of git and use the `CLASP_JSON` secret below.

### 3. Add GitHub secrets

Go to *Repo → Settings → Secrets and variables → Actions → New repository secret* and add:

| Secret name        | Value                                                                 |
|--------------------|-----------------------------------------------------------------------|
| `CLASPRC_JSON`     | Paste the contents of `~/.clasprc.json` (created by `clasp login`).  |
| `CLASP_JSON`       | *(optional)* Paste the contents of `.clasp.json` if you'd rather **not** commit it. |
| `DEPLOY_ID`        | *(optional)* An existing deployment id from `clasp deployments`, if you want the workflow to update the same live URL on demand. |

### 4. Confirm the workflow file

`.github/workflows/deploy-appsscript.yml` is already committed. It runs on:

- **Push to `main`** that touches `apps-script/**` → *pushes* the source to Apps Script.
- **Manual dispatch** with `deploy = true` → *pushes and cuts a new versioned deployment* (updating `DEPLOY_ID` in place if provided; otherwise a fresh deployment id is created).

## Day-to-day usage

- Just merge PRs to `main`. Within ~30 seconds your Apps Script editor shows the new code.
- To create a new user-facing deployment, go to *Actions → Deploy to Google Apps Script → Run workflow → deploy = true*.

## Troubleshooting

- **`Push failed: unauthorised`** — your `CLASPRC_JSON` has expired. Run `clasp login` locally again and refresh the secret.
- **`Command "push" not found`** — pin `clasp` to `2.4.2` (already done in the workflow).
- **Web-app URL unchanged after push** — you also need to *deploy*, not just push. Trigger the workflow manually with `deploy = true`.
- **CI touched files I didn't want pushed** — add them to `.claspignore`.

## Security notes

- `~/.clasprc.json` grants full access to your Apps Script projects. Treat it like a password. Rotate by re-running `clasp login`.
- The workflow runs on GitHub-hosted runners — no long-lived credentials on your machine.
- The workflow is guarded by `concurrency` so two pushes cannot race each other.
