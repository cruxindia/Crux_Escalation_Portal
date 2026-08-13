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

/** Web-app entrypoint. Serves the SPA shell. */
function doGet(e) {
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.bootstrap = JSON.stringify(getBootstrap_());
  return tpl.evaluate()
    .setTitle('Crux — Client Escalation Matrix')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      throw new AuthError_('Your account is not yet approved. Please contact Admin.');
    }
    var handler = RPC_ROUTES[action];
    if (!handler) throw new Error('Unknown action: ' + action);
    // Enforce role at the route level.
    if (handler.roles && handler.roles.indexOf(me.role) === -1 && me.role !== 'ADMIN') {
      throw new AuthError_('You are not authorised to perform this action.');
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
  'admin.setup.triggers': { roles: ['ADMIN'], fn: function(p, me) { return installTriggers_(); } }
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
  Logger.log('Setup complete. Spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}
