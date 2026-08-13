/**
 * CRUX ESCALATION MATRIX — Main Entrypoint
 * =========================================
 * Company: Crux Risk Management Pvt Ltd
 * Runtime: Google Apps Script (V8), Asia/Kolkata
 *
 * This file contains:
 *  - Web-app doGet router (serves single-page HTML shell)
 *  - Top-level RPC dispatcher (called from client-side google.script.run)
 *  - Bootstrap / setup helpers
 *
 * Server-side files (all share global namespace in Apps Script):
 *   Code.gs       - this file, entrypoint & RPC surface
 *   Sheets.gs     - low-level sheet accessors / CRUD
 *   Auth.gs       - role-based access control
 *   Clients.gs    - client / branch / matrix domain logic
 *   Import.gs     - bulk import (validate → preview → commit)
 *   Email.gs      - email engine + templates + logging + retry
 *   Scheduler.gs  - reminder / dispatch scheduler (idempotent)
 *   Escalation.gs - escalation logging & raising
 *   Utils.gs      - helpers (id, date, holiday, hash, dedupe)
 *
 * All privileged operations verify the caller's role server-side.
 * Never trust anything from the browser.
 */

/** Web-app entrypoint. Serves the SPA shell — or the read-only portal. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.view === 'portal') return renderPortal_(params);
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.bootstrap = JSON.stringify(getBootstrap_());
  return tpl.evaluate()
    .setTitle('Crux — Client Escalation Matrix')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Renders the tokenised read-only client portal view. */
function renderPortal_(params) {
  var body = '';
  try {
    var data = getPortalPayload_(params.c, params.t);
    body = renderPortalHtml_(data);
  } catch (err) {
    body = '<div class="portal-brand">Access</div>' +
      '<div class="portal-title">Link unavailable</div>' +
      '<p class="portal-sub">' + (err && err.message ? String(err.message) : 'This link is not valid.') + '</p>' +
      '<p class="portal-footer">If you believe this is an error, please contact your Crux relationship manager.</p>';
  }
  var tpl = HtmlService.createTemplateFromFile('Portal');
  tpl.body = body;
  return tpl.evaluate()
    .setTitle('Escalation Matrix')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderPortalHtml_(d) {
  var matrixRows = d.matrix.map(function(m) {
    return '<tr>' +
      '<td style="border:1px solid #d0d7de;padding:8px 12px;font-family:Georgia,serif;color:#b25a00">' + m.Level + '</td>' +
      '<td style="border:1px solid #d0d7de;padding:8px 12px"><b>' + escHtml_(m.LevelName) + '</b></td>' +
      '<td style="border:1px solid #d0d7de;padding:8px 12px">' + escHtml_(m.ContactName || '—') + '</td>' +
      '<td style="border:1px solid #d0d7de;padding:8px 12px">' + escHtml_(m.Mobile || '—') + '</td>' +
      '<td style="border:1px solid #d0d7de;padding:8px 12px">' + escHtml_(m.Email || '—') + '</td>' +
      '</tr>';
  }).join('');
  var branchRows = d.branches.map(function(b) {
    return '<tr>' +
      '<td style="border:1px solid #d0d7de;padding:6px 10px;font-family:ui-monospace,monospace;font-size:12px">' + escHtml_(b.BranchCode || '—') + '</td>' +
      '<td style="border:1px solid #d0d7de;padding:6px 10px"><b>' + escHtml_(b.BranchName || '—') + '</b><br><span style="color:#5b6473;font-size:12px">' + escHtml_(b.Address || '') + '</span></td>' +
      '<td style="border:1px solid #d0d7de;padding:6px 10px">' + escHtml_(b.CruxPOCName || '—') + '<br><span style="color:#5b6473;font-size:12px">' + escHtml_(b.CruxPOCMobile || '') + ' · ' + escHtml_(b.CruxPOCEmail || '') + '</span></td>' +
      '</tr>';
  }).join('');
  return '<div class="portal-brand">' + escHtml_(d.company) + '</div>' +
    '<h1 class="portal-title">' + escHtml_(d.client.ClientName) + '</h1>' +
    '<div class="portal-sub">Client Escalation Matrix' + (d.client.ClientCode ? ' · <span class="mono">' + escHtml_(d.client.ClientCode) + '</span>' : '') + '</div>' +
    '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px">' +
      '<thead style="background:#f6f8fa"><tr>' +
        '<th style="border:1px solid #d0d7de;padding:8px 12px;text-align:left">#</th>' +
        '<th style="border:1px solid #d0d7de;padding:8px 12px;text-align:left">Level</th>' +
        '<th style="border:1px solid #d0d7de;padding:8px 12px;text-align:left">Name</th>' +
        '<th style="border:1px solid #d0d7de;padding:8px 12px;text-align:left">Mobile</th>' +
        '<th style="border:1px solid #d0d7de;padding:8px 12px;text-align:left">Email</th>' +
      '</tr></thead><tbody>' + matrixRows + '</tbody>' +
    '</table>' +
    (branchRows ? '<h3 style="margin-top:22px;font-family:Georgia,serif;font-weight:500">Branch directory</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">' +
        '<thead style="background:#f6f8fa"><tr><th style="border:1px solid #d0d7de;padding:6px 10px;text-align:left">Code</th><th style="border:1px solid #d0d7de;padding:6px 10px;text-align:left">Branch</th><th style="border:1px solid #d0d7de;padding:6px 10px;text-align:left">Crux Point of Contact</th></tr></thead><tbody>' +
        branchRows + '</tbody></table>' : '') +
    '<div class="portal-footer">Last updated ' + escHtml_(d.client.UpdatedAt || '—') + ' · generated ' + escHtml_(d.generatedAt) + '. This is a live, read-only view — bookmark this page to always see the current matrix.</div>';
}

/** Include another HTML file (used by templating). */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Bootstrap payload passed to the SPA on first load. */
function getBootstrap_() {
  ensureSpreadsheet_();
  var me = whoAmI_();
  return {
    user: me,
    app: {
      name: getSetting_('APP_NAME', 'Crux Escalation Matrix'),
      company: getSetting_('COMPANY_NAME', 'Crux Risk Management Pvt Ltd'),
      timezone: getSetting_('APP_TIMEZONE', 'Asia/Kolkata'),
      dateFormat: getSetting_('DATE_FORMAT', 'dd-MMM-yyyy'),
      testMode: getSetting_('DRY_RUN', 'false') === 'true',
      version: '1.0.0'
    },
    nav: navForRole_(me.role),
    scheduledJobs: nextScheduledJobs_()
  };
}

/* =========================================================================
 * RPC — every entry-point here is callable from the browser via
 * google.script.run.rpc(...). We keep a single dispatcher so we can enforce
 * auth centrally and log every call.
 * ========================================================================= */

/**
 * @param {string} action      e.g. "clients.list"
 * @param {object} payload     JSON-safe args
 */
function rpc(action, payload) {
  var t0 = Date.now();
  try {
    var me = whoAmI_();
    if (!me.active && action !== 'auth.me' && action !== 'auth.requestAccess') {
      throw AuthError_('Your account is not yet approved. Please contact Admin.');
    }
    var handler = RPC_ROUTES[action];
    if (!handler) throw new Error('Unknown action: ' + action);
    // Enforce role at the route level.
    if (handler.roles && handler.roles.indexOf(me.role) === -1 && me.role !== 'ADMIN') {
      throw AuthError_('You are not authorised to perform this action.');
    }
    var out = handler.fn(payload || {}, me);
    return { ok: true, data: out };
  } catch (err) {
    var friendly = (err && err.isFriendly) ? err.message :
                   'Unable to complete the request. Please try again.';
    // Structured server log for admin.
    logAudit_({
      user: (Session.getActiveUser() || {}).getEmail && Session.getActiveUser().getEmail() || 'unknown',
      action: 'RPC_ERROR',
      entity: action,
      entityId: '',
      oldValue: '',
      newValue: JSON.stringify({ err: String(err && err.stack || err), payload: safePayload_(payload) })
    });
    return { ok: false, error: friendly };
  } finally {
    // Keep call latency observable but do not spam logs.
    if (Date.now() - t0 > 4000) console.warn('slow rpc', action, Date.now() - t0);
  }
}

/** RPC registry. `roles` is inclusive-OR; ADMIN always passes. */
var RPC_ROUTES = {
  // Auth
  'auth.me':              { roles: null, fn: function(p, me) { return me; } },
  'auth.requestAccess':   { roles: null, fn: function(p, me) { return requestAccess_(p, me); } },

  // Dashboard
  'dashboard.summary':    { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return dashboardSummary_(me); } },

  // Clients / Branches / Matrix
  'clients.list':         { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return listClients_(p, me); } },
  'clients.get':          { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return getClient_(p.id, me); } },
  'clients.upsert':       { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return upsertClient_(p, me); } },
  'clients.setStatus':    { roles: ['ADMIN','MANAGER'],                           fn: function(p, me) { return setClientStatus_(p, me); } },
  'branches.list':        { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return listBranches_(p, me); } },
  'branches.upsert':      { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return upsertBranch_(p, me); } },
  'branches.setStatus':   { roles: ['ADMIN','MANAGER'],                           fn: function(p, me) { return setBranchStatus_(p, me); } },
  'matrix.get':           { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return getMatrix_(p.clientId, me); } },
  'matrix.save':          { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return saveMatrix_(p, me); } },

  // Bulk import
  'import.validate':      { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return validateImport_(p, me); } },
  'import.commit':        { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return commitImport_(p, me); } },

  // Escalations
  'escalations.list':     { roles: ['ADMIN','LOCATION_HEAD','VIEWER','MANAGER'], fn: function(p, me) { return listEscalations_(p, me); } },
  'escalations.log':      { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return logEscalationCase_(p, me); } },
  'escalations.raise':    { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return raiseEscalationCase_(p, me); } },
  'escalations.update':   { roles: ['ADMIN','LOCATION_HEAD','MANAGER'],          fn: function(p, me) { return updateEscalationCase_(p, me); } },

  // Admin
  'admin.users.list':     { roles: ['ADMIN'], fn: function(p, me) { return listUsers_(); } },
  'admin.users.upsert':   { roles: ['ADMIN'], fn: function(p, me) { return upsertUser_(p, me); } },
  'admin.settings.get':   { roles: ['ADMIN'], fn: function(p, me) { return getAllSettings_(); } },
  'admin.settings.save':  { roles: ['ADMIN'], fn: function(p, me) { return saveSettings_(p, me); } },
  'admin.templates.get':  { roles: ['ADMIN'], fn: function(p, me) { return getTemplates_(); } },
  'admin.templates.save': { roles: ['ADMIN'], fn: function(p, me) { return saveTemplates_(p, me); } },
  'admin.holidays.list':  { roles: ['ADMIN'], fn: function(p, me) { return listHolidays_(); } },
  'admin.holidays.save':  { roles: ['ADMIN'], fn: function(p, me) { return saveHolidays_(p, me); } },
  'admin.logs.email':     { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return queryEmailLog_(p); } },
  'admin.logs.audit':     { roles: ['ADMIN'], fn: function(p, me) { return queryAuditLog_(p); } },
  'admin.logs.reminders': { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return queryReminderLog_(p); } },
  'admin.email.retry':    { roles: ['ADMIN'], fn: function(p, me) { return retryEmail_(p, me); } },
  'admin.email.test':     { roles: ['ADMIN'], fn: function(p, me) { return sendTestEmail_(p, me); } },
  'admin.run.reminder25': { roles: ['ADMIN'], fn: function(p, me) { return runJob_('REMINDER_25', p, me); } },
  'admin.run.reminderLWD':{ roles: ['ADMIN'], fn: function(p, me) { return runJob_('REMINDER_LWD', p, me); } },
  'admin.run.dispatch':   { roles: ['ADMIN'], fn: function(p, me) { return runJob_('MONTHLY_DISPATCH', p, me); } },
  'admin.run.summary':    { roles: ['ADMIN'], fn: function(p, me) { return runJob_('MONTHLY_SUMMARY', p, me); } },
  'admin.export.csv':     { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return exportCsv_(p); } },
  'admin.automation.status': { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return automationStatus_(); } },
  'admin.setup.seed':     { roles: ['ADMIN'], fn: function(p, me) { return seedDemoData_(me); } },
  'admin.setup.triggers': { roles: ['ADMIN'], fn: function(p, me) { return installTriggers_(); } },

  // Portal (read-only tokenised client link)
  'portal.getLink':       { roles: ['ADMIN','MANAGER','LOCATION_HEAD'], fn: function(p, me) { return portalUrl_(p, me); } },
  'portal.rotate':        { roles: ['ADMIN'], fn: function(p, me) { return portalRotate_(me); } },

  // Gemini AI
  'ai.status':            { roles: ['ADMIN','MANAGER','LOCATION_HEAD','VIEWER'], fn: function(p, me) { return geminiStatus_(); } },
  'ai.saveConfig':        { roles: ['ADMIN'], fn: function(p, me) { return geminiSaveConfig_(p, me); } },
  'ai.classifyEscalation':{ roles: ['ADMIN','LOCATION_HEAD','MANAGER'], fn: function(p, me) { return aiClassifyEscalation_(p, me); } },
  'ai.draftEscalation':   { roles: ['ADMIN','LOCATION_HEAD','MANAGER'], fn: function(p, me) { return aiDraftEscalation_(p, me); } },
  'ai.chat':              { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return aiChat_(p, me); } },
  'ai.weeklyAnomalies':   { roles: ['ADMIN','MANAGER'], fn: function(p, me) { return aiWeeklyAnomalies_(p); } }
};

/* =========================================================================
 * FIRST-RUN BOOTSTRAP
 * ========================================================================= */

/**
 * Called manually from the Apps Script editor after project creation.
 * Creates the spreadsheet, seeds admin, installs triggers.
 * Safe to run multiple times.
 */
function setup() {
  var ss = ensureSpreadsheet_();
  var email = Session.getEffectiveUser().getEmail();
  // Seed the deploying user as the first ADMIN.
  var users = readTable_('USERS');
  if (!users.some(function(u){ return (u.Email || '').toLowerCase() === email.toLowerCase(); })) {
    appendRow_('USERS', {
      UserID: nextId_('USR'),
      Name: email.split('@')[0],
      Email: email,
      Mobile: '',
      Designation: 'Admin',
      Role: 'ADMIN',
      LocationHead: '',
      Manager: '',
      Status: 'ACTIVE',
      CreatedAt: nowIso_(),
      UpdatedAt: nowIso_(),
      UpdatedBy: 'system'
    });
  }
  installTriggers_();
  ensurePortalSecret_();
  Logger.log('Setup complete. Spreadsheet: ' + ss.getUrl());
  Logger.log('Web-app URL will be available after Deploy → New deployment.');
  Logger.log('To enable Gemini AI: open the app → Admin → AI → paste API key.');
  return ss.getUrl();
}
