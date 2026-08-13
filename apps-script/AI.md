# Gemini AI Features

The tool integrates **Google Gemini** (default: `gemini-2.5-flash`, free tier) for four narrow, high-value use-cases. Every feature *fails soft* — if the API key is missing, disabled, or the call fails, the app continues to work normally without AI.

## 1. Setup

1. Get a key
   - **Google AI Studio** (free tier): <https://aistudio.google.com/apikey>
   - **Emergent Universal LLM key**: use the value provided in your Emergent workspace.
2. Open the app → **Admin → AI**.
3. Paste the key. Optionally change the model. Set **Enabled = ENABLED**. Save.

The key is stored in Apps Script's **Script Properties** — it never leaves the server and is never sent to the browser. To rotate it, paste a new key over the old one.

## 2. Features

### a) Draft with AI — formal escalations
On *Escalations → + Raise escalation*, enter a one-line **AI brief** (e.g. *"Client received wrong statement on 3rd; disputes ₹2.1L reversal"*) and click **✨ Draft with AI**. Gemini fills in the *Details* and *Required resolution* fields with a neutral, professional 3-6 sentence write-up. You can edit before sending.

### b) Suggest category & severity — logged escalations
On *Escalations → + Log escalation*, after writing the *Description*, click **✨ Suggest category & severity**. Gemini returns a triage suggestion (Category / Severity + short reason + suggested next action) and pre-fills the dropdowns and *Required action* field. Always human-reviewable.

### c) Monthly digest insight paragraph
The scheduled *Monthly Summary* email now includes a highlighted "**What changed / what to watch**" paragraph produced by Gemini, based on that month's stats and failed-send samples. If Gemini is unavailable at digest time, the paragraph is silently omitted; everything else in the digest is unaffected.

### d) Ask my data — admin chat
*Admin → AI → Ask my data* is a short conversational box for admins/managers. Gemini answers using a compressed snapshot of the last 60 days of `EMAIL_LOG` and `ESCALATIONS`. Example prompts:

- *"How many dispatches failed last month?"*
- *"Which clients had the most escalations in July?"*
- *"What's the most common failure reason?"*

Answers are grounded in the snapshot; Gemini is instructed to say so if the answer isn't in the data.

## 3. Data safety

- The chat snapshot uses **aggregates** (counts by client/status/type) and short samples of failed error messages — never the full email body, never attachment content.
- Personal data included: email addresses in `ToAddr` fields when explicitly requested by the user.
- Gemini calls are made from the deploying account's Apps Script identity via `UrlFetchApp` — no browser-side calls; no leaked keys.
- All AI-related mutations write to `AUDIT_LOG` (`AI_CLASSIFY`, `AI_DRAFT_ESCALATION`, `GEMINI_CONFIG`).

## 4. Free-tier notes

- `gemini-2.5-flash` has a generous free tier via Google AI Studio (rate-limited per minute; refer to <https://ai.google.dev/pricing>).
- If you exceed rate limits, requests return an error surfaced as *"AI: Gemini API 429 …"*. The rest of the app is unaffected.
- Free tier does not support long context windows; keep briefs short and let the tool handle the rest.

## 5. Turning AI off

If you ever want to disable AI globally without deleting the key, go to *Admin → AI* → set **Enabled = DISABLED** → Save. All AI buttons disappear from the UI and the scheduler skips the insight paragraph.

## 6. Troubleshooting

| Symptom                                            | Fix                                                                 |
|----------------------------------------------------|---------------------------------------------------------------------|
| AI buttons don't appear                            | *Admin → AI* — check *Configured = YES* and *Enabled = YES*.        |
| "Gemini is not configured"                         | Paste the key in *Admin → AI*.                                       |
| "Gemini API 401" / "PERMISSION_DENIED"             | Wrong or expired key. Rotate in AI Studio; paste new key.            |
| "Gemini API 429"                                   | Rate limited. Wait a minute, or upgrade billing on the AI Studio project. |
| Chat says "no data" when data clearly exists       | Snapshot window is 60 days. Ask about older data by narrowing your question, or export via *Logs → CSV*. |
