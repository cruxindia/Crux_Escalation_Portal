/**
 * Gemini.gs — thin wrapper around the Gemini REST API for Apps Script.
 *
 * Configuration (Script Properties, NOT the Sheet — never expose to browser):
 *   GEMINI_API_KEY        Google AI Studio API key (or Emergent Universal LLM key).
 *   GEMINI_MODEL          Model id, default: gemini-2.5-flash (free tier)
 *   GEMINI_ENABLED        'true' / 'false'. Any admin can flip this from the UI.
 *
 * All Gemini-backed features degrade gracefully when the key is missing —
 * the app remains fully usable without AI.
 */

var GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

function geminiConfigured_() {
  var props = PropertiesService.getScriptProperties();
  return !!props.getProperty('GEMINI_API_KEY') && props.getProperty('GEMINI_ENABLED') !== 'false';
}

function geminiStatus_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  return {
    configured: !!key,
    enabled: props.getProperty('GEMINI_ENABLED') !== 'false',
    model: props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL,
    keyPreview: key ? (String(key).slice(0, 4) + '…' + String(key).slice(-4)) : ''
  };
}

function geminiSaveConfig_(payload, me) {
  var props = PropertiesService.getScriptProperties();
  if (payload.apiKey !== undefined) props.setProperty('GEMINI_API_KEY', String(payload.apiKey || ''));
  if (payload.model !== undefined) props.setProperty('GEMINI_MODEL', String(payload.model || GEMINI_DEFAULT_MODEL));
  if (payload.enabled !== undefined) props.setProperty('GEMINI_ENABLED', payload.enabled ? 'true' : 'false');
  logAudit_({ user: me.email, action: 'GEMINI_CONFIG', entity: 'PROPERTIES', entityId: '', oldValue: '', newValue: JSON.stringify({ model: props.getProperty('GEMINI_MODEL'), enabled: props.getProperty('GEMINI_ENABLED'), hasKey: !!props.getProperty('GEMINI_API_KEY') }) });
  return geminiStatus_();
}

/**
 * Generic Gemini generateContent call.
 * @param {object} opts
 *   opts.system   Optional system instruction
 *   opts.prompt   User prompt (string)
 *   opts.json     If true, ask for JSON output and parse it
 *   opts.temp     0..1 sampling temperature (default 0.2)
 * @return {string|object}  Text response, or parsed JSON if opts.json
 */
function geminiCall_(opts) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw AuthError_('Gemini is not configured. Please ask an admin to set the API key.');
  if (props.getProperty('GEMINI_ENABLED') === 'false') throw AuthError_('Gemini features are currently disabled.');
  var model = props.getProperty('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  var url = GEMINI_ENDPOINT + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var body = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temp == null ? 0.2 : opts.temp,
      maxOutputTokens: opts.maxTokens || 1024,
      responseMimeType: opts.json ? 'application/json' : 'text/plain'
    }
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    var errMsg = '';
    try { errMsg = JSON.parse(text).error && JSON.parse(text).error.message; } catch (e) {}
    throw new Error('Gemini API ' + code + ': ' + (errMsg || text.slice(0, 240)));
  }
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Gemini API: non-JSON response'); }
  var content = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text || '';
  if (!content) throw new Error('Gemini returned no content. Reason: ' + (data.candidates && data.candidates[0] && data.candidates[0].finishReason || 'unknown'));
  if (opts.json) {
    try { return JSON.parse(content); }
    catch (e) {
      // Strip common code fences and retry
      var stripped = content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
      return JSON.parse(stripped);
    }
  }
  return content;
}

/* ------------------------------------------------------------------
 * Feature: AI severity + category classifier (LOG escalation)
 * ------------------------------------------------------------------ */
function aiClassifyEscalation_(payload, me) {
  var desc = String(payload.description || '').trim();
  if (!desc) throw ValidationError_('Please add a short description first.');
  var out = geminiCall_({
    system: 'You are a triage assistant for a risk-management ops team. From a short banker/client complaint, output STRICT JSON: { "category": one of ["Service","Compliance","Ops","Billing","Other"], "severity": one of ["Low","Medium","High"], "reason": short single sentence explaining severity, "suggestedAction": one short imperative sentence }. No markdown, no extra fields.',
    prompt: 'Complaint description:\n"""\n' + desc.slice(0, 1500) + '\n"""',
    json: true, temp: 0.1, maxTokens: 300
  });
  logAudit_({ user: me.email, action: 'AI_CLASSIFY', entity: 'GEMINI', entityId: '', oldValue: '', newValue: JSON.stringify(out).slice(0, 500) });
  return out;
}

/* ------------------------------------------------------------------
 * Feature: AI-drafted formal escalation email body
 * ------------------------------------------------------------------ */
function aiDraftEscalation_(payload, me) {
  var seed = String(payload.brief || '').trim();
  if (!seed) throw ValidationError_('Please add a short brief describing the issue.');
  var client = payload.ClientID ? findRowById_('CLIENTS', 'ClientID', payload.ClientID) : null;
  var vars = {
    client: client ? client.ClientName : '(unspecified client)',
    brief: seed.slice(0, 2000),
    category: payload.category || 'General',
    severity: payload.severity || 'Medium'
  };
  var out = geminiCall_({
    system: 'You draft professional, concise formal escalation content for a risk-management firm ("Crux Risk Management Pvt Ltd"). Use neutral, respectful tone. NEVER threaten. Output STRICT JSON: { "description": 3-6 sentences describing the issue clearly, "requiredResolution": 1-3 sentences stating the expected fix and a reasonable timeline }. No markdown, no extra fields.',
    prompt: 'Client: ' + vars.client + '\nCategory: ' + vars.category + '\nSeverity: ' + vars.severity + '\nBrief:\n"""\n' + vars.brief + '\n"""',
    json: true, temp: 0.35, maxTokens: 600
  });
  logAudit_({ user: me.email, action: 'AI_DRAFT_ESCALATION', entity: 'GEMINI', entityId: payload.ClientID || '', oldValue: '', newValue: JSON.stringify(out).slice(0, 500) });
  return out;
}

/* ------------------------------------------------------------------
 * Feature: Ask-my-data admin chat
 * The client sends short conversational messages. We attach a compressed
 * snapshot of the last 60 days of EMAIL_LOG + ESCALATIONS as context so
 * Gemini can answer common questions grounded in real data.
 * ------------------------------------------------------------------ */
function aiChat_(payload, me) {
  var messages = payload.messages || [];
  var lastUser = messages.filter(function(m){ return m.role === 'user'; }).slice(-1)[0];
  if (!lastUser) throw ValidationError_('No user message.');
  var snapshot = buildDataSnapshot_();
  var history = messages.slice(-10).map(function(m){ return (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.text; }).join('\n');
  var out = geminiCall_({
    system: 'You are an internal analytics assistant for the Crux Escalation Matrix tool. Answer succinctly, in plain English (max 6 sentences). ALWAYS ground answers in the provided data snapshot; if the answer is not in the snapshot, say so. Never invent client names or numbers. Prefer bullet points when listing 3+ items.',
    prompt: 'DATA SNAPSHOT (last 60 days):\n' + snapshot + '\n\nCONVERSATION SO FAR:\n' + history,
    temp: 0.2, maxTokens: 700
  });
  return { text: String(out) };
}

function buildDataSnapshot_() {
  var since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  var sinceKey = Utilities.formatDate(since, getTz_(), 'yyyy-MM-dd');
  var emails = readTable_('EMAIL_LOG').filter(function(r){ return String(r.Timestamp) >= sinceKey; });
  var esc = readTable_('ESCALATIONS').filter(function(r){ return String(r.CreatedAt) >= sinceKey; });
  var clientMap = {};
  readTable_('CLIENTS').forEach(function(c){ clientMap[c.ClientID] = c.ClientName; });
  function byKey(arr, keyFn) {
    var m = {};
    arr.forEach(function(x){ var k = keyFn(x); m[k] = (m[k]||0) + 1; });
    return Object.keys(m).sort(function(a,b){ return m[b] - m[a]; }).slice(0, 12).map(function(k){ return k + ' (' + m[k] + ')'; }).join(', ');
  }
  var lines = [];
  lines.push('window_days=60 from ' + sinceKey);
  lines.push('total_emails=' + emails.length + ' sent=' + emails.filter(function(r){return r.Status==='SENT';}).length + ' failed=' + emails.filter(function(r){return r.Status==='FAILED';}).length);
  lines.push('emails_by_type: ' + byKey(emails, function(r){ return r.Type || 'UNKNOWN'; }));
  lines.push('failed_by_client: ' + byKey(emails.filter(function(r){return r.Status==='FAILED';}), function(r){ return clientMap[r.ClientID] || r.ClientID || '—'; }));
  lines.push('failed_reasons_sample: ' + emails.filter(function(r){return r.Status==='FAILED';}).slice(0,8).map(function(r){ return (r.Error||'').slice(0,80); }).join(' | '));
  lines.push('escalations=' + esc.length + ' open=' + esc.filter(function(r){ return ['OPEN','ASSIGNED','IN_PROGRESS'].indexOf(r.Status) !== -1; }).length);
  lines.push('escalations_by_client: ' + byKey(esc, function(r){ return clientMap[r.ClientID] || r.ClientID || '—'; }));
  lines.push('escalations_by_severity: ' + byKey(esc, function(r){ return r.Severity || 'Medium'; }));
  lines.push('escalations_by_category: ' + byKey(esc, function(r){ return r.Category || 'Other'; }));
  return lines.join('\n');
}

/* ------------------------------------------------------------------
 * Feature: Monthly digest insight paragraph — called by the scheduler.
 * Falls back silently to '' when Gemini is not configured.
 * ------------------------------------------------------------------ */
function aiSummaryInsight_(period, stats, incomplete, failedSamples) {
  if (!geminiConfigured_()) return '';
  try {
    var prompt = 'Period: ' + period + '\nStats: ' + JSON.stringify(stats) +
      '\nIncomplete clients: ' + incomplete.slice(0, 15).join(', ') +
      '\nFailed reasons sample: ' + failedSamples.slice(0, 8).map(function(e){ return e.slice(0,100); }).join(' | ');
    return geminiCall_({
      system: 'You write a short (3-5 sentence) plain-English paragraph titled "What changed / what to watch" for the Crux ops admin. Highlight anomalies, trends and recommendations. Be direct. No bullet points. No preamble.',
      prompt: prompt, temp: 0.3, maxTokens: 400
    });
  } catch (e) {
    return '';
  }
}
