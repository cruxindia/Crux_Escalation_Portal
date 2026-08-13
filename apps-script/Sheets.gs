/**
 * Sheets.gs — spreadsheet bootstrap + generic table CRUD.
 * Every sheet is treated as a table with a header row.
 * Records use stable IDs (never row index).
 */

// One canonical schema. Order matters for column layout.
var SCHEMA = {
  SETTINGS: ['Key','Value','Description','UpdatedAt','UpdatedBy'],
  USERS:    ['UserID','Name','Email','Mobile','Designation','Role','LocationHead','Manager','Status','CreatedAt','UpdatedAt','UpdatedBy'],
  CLIENTS:  ['ClientID','ClientName','ClientCode','ClientEmail','ClientCC','DefaultLocationHead','Status','EffectiveFrom','EffectiveTo','Notes','CreatedAt','UpdatedAt','UpdatedBy'],
  BRANCHES: ['BranchID','ClientID','BranchName','BranchCode','Address','CruxPOCName','CruxPOCEmpID','CruxPOCMobile','CruxPOCEmail','BranchManagerName','BranchManagerMobile','BranchManagerEmail','LocationHead','Location','Zone','Status','EffectiveFrom','EffectiveTo','Notes','CreatedAt','UpdatedAt','UpdatedBy'],
  ESCALATION_MATRIX: ['MatrixID','ClientID','Level','LevelName','ContactName','Mobile','Email','UpdatedAt','UpdatedBy'],
  HOLIDAYS: ['HolidayID','Date','Name','Status','CreatedAt'],
  EMAIL_TEMPLATES: ['Key','Subject','Body','UpdatedAt','UpdatedBy'],
  EMAIL_LOG: ['LogID','Timestamp','Type','ClientID','BranchID','ToAddr','CcAddr','Subject','Trigger','SentBy','Status','Attempt','Error','MessageRef','IdempotencyKey'],
  REMINDER_LOG: ['JobKey','Type','Month','ExecutedAt','ExecutedBy','Result','Notes'],
  ESCALATIONS: ['EscalationID','Type','Date','Time','ClientID','BranchID','BranchCode','ContactName','ContactPhone','Category','Severity','EscalatedAgainst','Description','AssignedOwner','RequiredAction','TargetDate','Status','ClosureDate','ClosureRemarks','CreatedBy','CreatedAt','UpdatedAt'],
  ESCALATION_HISTORY: ['HistoryID','EscalationID','Timestamp','User','Field','OldValue','NewValue','Note'],
  AUDIT_LOG: ['LogID','Timestamp','User','Action','Entity','EntityID','OldValue','NewValue']
};

var DEFAULT_SETTINGS = [
  ['APP_NAME','Crux Escalation Matrix','Displayed app title'],
  ['COMPANY_NAME','Crux Risk Management Pvt Ltd','Company name'],
  ['APP_TIMEZONE','Asia/Kolkata','Timezone for jobs & dates'],
  ['DATE_FORMAT','dd-MMM-yyyy','UI date format'],
  ['REMINDER_DAY_1','25','Day of month for first reminder'],
  ['REMINDER_TIME','12:00','Time of day HH:mm (24h)'],
  ['MONTHLY_DISPATCH_DAY','1','Day of month to dispatch matrix to client'],
  ['MONTHLY_DISPATCH_TIME','10:00','Time of day HH:mm for dispatch'],
  ['MONTHLY_SUMMARY_DAY','2','Day of month to email admin summary of previous month'],
  ['MONTHLY_SUMMARY_TIME','09:00','Time of day HH:mm for summary digest'],
  ['FROM_NAME','Crux Risk Management','Email display name'],
  ['REPLY_TO','','Reply-to address (blank uses sender)'],
  ['DEFAULT_CC','','Default CC (comma separated)'],
  ['DEFAULT_BCC','','Default BCC (comma separated)'],
  ['ESCALATION_MANAGER','','Internal escalation recipient (email)'],
  ['SUMMARY_EXTRA_RECIPIENTS','','Extra recipients for the monthly digest (comma-separated). Added in addition to all active ADMINs.'],
  ['RETRY_LIMIT','3','Max email retry attempts'],
  ['DRY_RUN','false','If true, override all recipients with TEST_EMAIL_OVERRIDE'],
  ['TEST_EMAIL_OVERRIDE','','Recipient used when DRY_RUN is true'],
  ['SIGNATURE','<p>Warm regards,<br/>Team Crux Risk Management</p>','HTML signature block']
];

var DEFAULT_TEMPLATES = [
  ['REMINDER',
   'Action required: Update Client Escalation Matrix — {{MONTH}} {{YEAR}}',
   '<p>Dear {{LOCATION_HEAD_NAME}},</p><p>Please review and update the Client Escalation Matrix for the following clients assigned to you. The finalized matrix will be dispatched to clients on the 1st of {{NEXT_MONTH}}.</p>{{CLIENT_TABLE}}<p><a href="{{APP_URL}}">Open the tool</a></p>{{SIGNATURE}}'],
  ['DISPATCH',
   'Client Escalation Matrix — {{CLIENT_NAME}} — {{MONTH}} {{YEAR}}',
   '<p>Dear Team,</p><p>Please find below the current escalation matrix for <b>{{CLIENT_NAME}}</b>, effective {{MONTH}} {{YEAR}}. Kindly reach out to the concerned level should any issue require attention.</p>{{MATRIX_TABLE}}<p>Branch contacts are available on request.</p>{{SIGNATURE}}'],
  ['INCOMPLETE',
   '[ACTION REQUIRED] Incomplete Escalation Matrix — {{CLIENT_NAME}}',
   '<p>Dear {{LOCATION_HEAD_NAME}},</p><p>The escalation matrix for <b>{{CLIENT_NAME}}</b> could not be dispatched because the following mandatory fields are missing:</p>{{MISSING_LIST}}<p>Please complete the matrix at the earliest. This client email was <b>not</b> sent.</p>{{SIGNATURE}}'],
  ['RAISE_ESCALATION',
   '[ESCALATION] {{CATEGORY}} — {{CLIENT_NAME}} ({{BRANCH_CODE}})',
   '<p>Dear Team,</p><p>We wish to formally escalate the following matter:</p>{{ESCALATION_TABLE}}<p><b>Required resolution:</b> {{REQUIRED_RESOLUTION}}<br/><b>Due date:</b> {{DUE_DATE}}</p>{{SIGNATURE}}'],
  ['TEST',
   '[TEST] Crux Escalation Tool — Email connectivity check',
   '<p>This is a test email from the Crux Escalation Matrix tool.</p><p>If you received this, sending is configured correctly.</p>{{SIGNATURE}}']
];

var SS_PROP_KEY = 'CRUX_SS_ID';
// Per-execution caches — Apps Script instantiates a fresh V8 context per RPC call.
// Caching within a single execution avoids repeat spreadsheet opens + header scans.
var _SS_CACHE = null;
var _SCHEMA_OK = false;
var _TABLE_CACHE = {};
var _SETTINGS_MAP = null;

function invalidateTableCache_(name) {
  if (name) delete _TABLE_CACHE[name]; else _TABLE_CACHE = {};
  if (name === 'SETTINGS' || !name) _SETTINGS_MAP = null;
  if (name === 'USERS' || !name) _ME_CACHE = null;
}

function ensureSpreadsheet_() {
  if (_SS_CACHE && _SCHEMA_OK) return _SS_CACHE;
  var ss = _SS_CACHE;
  if (!ss) {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(SS_PROP_KEY);
    if (id) {
      try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create('Crux Escalation Matrix — Datastore');
      props.setProperty(SS_PROP_KEY, ss.getId());
    }
    _SS_CACHE = ss;
  }
  if (!_SCHEMA_OK) {
    // Ensure every table exists with headers.
    Object.keys(SCHEMA).forEach(function(name) {
      var sh = ss.getSheetByName(name);
      var headers = SCHEMA[name];
      if (!sh) {
        sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        sh.setFrozenRows(1);
      } else {
        var existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
        var missing = headers.filter(function(h){ return existing.indexOf(h) === -1; });
        if (missing.length) {
          var startCol = sh.getLastColumn() + 1;
          sh.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold');
        }
      }
    });
    var extra = ss.getSheetByName('Sheet1');
    if (extra && extra.getLastRow() <= 1 && Object.keys(SCHEMA).indexOf('Sheet1') === -1) {
      try { ss.deleteSheet(extra); } catch (e) {}
    }
    seedSettingsIfEmpty_(ss);
    seedTemplatesIfEmpty_(ss);
    _SCHEMA_OK = true;
  }
  return ss;
}

function seedSettingsIfEmpty_(ss) {
  var sh = ss.getSheetByName('SETTINGS');
  if (sh.getLastRow() > 1) return;
  var rows = DEFAULT_SETTINGS.map(function(r) { return [r[0], r[1], r[2], nowIso_(), 'system']; });
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function seedTemplatesIfEmpty_(ss) {
  var sh = ss.getSheetByName('EMAIL_TEMPLATES');
  if (sh.getLastRow() > 1) return;
  var rows = DEFAULT_TEMPLATES.map(function(r){ return [r[0], r[1], r[2], nowIso_(), 'system']; });
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

/* -----------------------------------------------------------
 * Generic table helpers
 * ----------------------------------------------------------- */

function sh_(name) {
  var ss = ensureSpreadsheet_();
  return ss.getSheetByName(name);
}

function readTable_(name) {
  if (_TABLE_CACHE[name]) return _TABLE_CACHE[name];
  var sh = sh_(name);
  var last = sh.getLastRow();
  if (last < 2) { _TABLE_CACHE[name] = []; return []; }
  var headers = SCHEMA[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = values.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  }).filter(function(o){
    return Object.keys(o).some(function(k){ return o[k] !== '' && o[k] !== null; });
  });
  _TABLE_CACHE[name] = out;
  return out;
}

function appendRow_(name, obj) {
  var sh = sh_(name);
  var headers = SCHEMA[name];
  var row = headers.map(function(h){ return obj[h] === undefined ? '' : obj[h]; });
  sh.appendRow(row);
  invalidateTableCache_(name);
  return obj;
}

function updateRowById_(name, idField, idValue, patch) {
  var sh = sh_(name);
  var headers = SCHEMA[name];
  var idCol = headers.indexOf(idField) + 1;
  if (idCol < 1) throw new Error('unknown id column ' + idField);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idValue)) {
      var rowNum = i + 2;
      var current = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      var merged = headers.map(function(h, j){
        if (patch.hasOwnProperty(h)) return patch[h];
        return current[j];
      });
      sh.getRange(rowNum, 1, 1, headers.length).setValues([merged]);
      invalidateTableCache_(name);
      var obj = {};
      headers.forEach(function(h, j){ obj[h] = merged[j]; });
      return obj;
    }
  }
  return null;
}

function findRowById_(name, idField, idValue) {
  var rows = readTable_(name);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][idField]) === String(idValue)) return rows[i];
  return null;
}

function deleteRowById_(name, idField, idValue) {
  var sh = sh_(name);
  var headers = SCHEMA[name];
  var idCol = headers.indexOf(idField) + 1;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idValue)) {
      sh.deleteRow(i + 2);
      invalidateTableCache_(name);
      return true;
    }
  }
  return false;
}

/** SETTINGS helpers. Reads are hot — use a per-execution map cache. */
function getSetting_(key, dflt) {
  if (!_SETTINGS_MAP) {
    _SETTINGS_MAP = {};
    readTable_('SETTINGS').forEach(function(r){ _SETTINGS_MAP[r.Key] = r.Value; });
  }
  var v = _SETTINGS_MAP[key];
  if (v === undefined || v === '' || v === null) return dflt;
  return String(v);
}

function setSetting_(key, value, user) {
  var existing = findRowById_('SETTINGS', 'Key', key);
  if (existing) {
    return updateRowById_('SETTINGS', 'Key', key, { Value: value, UpdatedAt: nowIso_(), UpdatedBy: user || 'system' });
  }
  return appendRow_('SETTINGS', { Key: key, Value: value, Description: '', UpdatedAt: nowIso_(), UpdatedBy: user || 'system' });
}

function getAllSettings_() {
  return readTable_('SETTINGS');
}

function saveSettings_(payload, me) {
  var updates = payload.updates || [];
  updates.forEach(function(u) { setSetting_(u.Key, u.Value, me.email); });
  logAudit_({ user: me.email, action: 'SETTINGS_SAVE', entity: 'SETTINGS', entityId: '', oldValue: '', newValue: JSON.stringify(updates) });
  return { ok: true };
}

function getTemplates_() { return readTable_('EMAIL_TEMPLATES'); }
function saveTemplates_(payload, me) {
  var items = payload.items || [];
  items.forEach(function(t) {
    var existing = findRowById_('EMAIL_TEMPLATES', 'Key', t.Key);
    if (existing) updateRowById_('EMAIL_TEMPLATES', 'Key', t.Key, { Subject: t.Subject, Body: t.Body, UpdatedAt: nowIso_(), UpdatedBy: me.email });
    else appendRow_('EMAIL_TEMPLATES', { Key: t.Key, Subject: t.Subject, Body: t.Body, UpdatedAt: nowIso_(), UpdatedBy: me.email });
  });
  logAudit_({ user: me.email, action: 'TEMPLATE_SAVE', entity: 'EMAIL_TEMPLATES', entityId: '', oldValue: '', newValue: JSON.stringify(items.map(function(i){return i.Key;})) });
  return { ok: true };
}

function listHolidays_() { return readTable_('HOLIDAYS'); }
function saveHolidays_(payload, me) {
  var items = payload.items || [];
  // Simple approach: clear & rewrite. Small table, admin-only.
  var sh = sh_('HOLIDAYS');
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SCHEMA.HOLIDAYS.length).clearContent();
  invalidateTableCache_('HOLIDAYS');
  items.forEach(function(h) {
    appendRow_('HOLIDAYS', {
      HolidayID: h.HolidayID || nextId_('HOL'),
      Date: h.Date, Name: h.Name || '',
      Status: h.Status || 'ACTIVE',
      CreatedAt: h.CreatedAt || nowIso_()
    });
  });
  logAudit_({ user: me.email, action: 'HOLIDAYS_SAVE', entity: 'HOLIDAYS', entityId: '', oldValue: '', newValue: String(items.length) });
  return { ok: true, count: items.length };
}

function logAudit_(o) {
  appendRow_('AUDIT_LOG', {
    LogID: nextId_('AUD'),
    Timestamp: nowIso_(),
    User: o.user || '',
    Action: o.action || '',
    Entity: o.entity || '',
    EntityID: o.entityId || '',
    OldValue: o.oldValue || '',
    NewValue: o.newValue || ''
  });
}

function queryEmailLog_(p) {
  var rows = readTable_('EMAIL_LOG');
  rows = applyLogFilters_(rows, p && p.filters);
  return paginate_(rows, p);
}
function queryAuditLog_(p) {
  var rows = readTable_('AUDIT_LOG');
  rows = applyLogFilters_(rows, p && p.filters);
  return paginate_(rows, p);
}
function queryReminderLog_(p) {
  var rows = readTable_('REMINDER_LOG');
  rows = applyLogFilters_(rows, p && p.filters);
  return paginate_(rows, p);
}

/**
 * Rich filter for log tables. Recognised keys:
 *   dateFrom / dateTo — YYYY-MM-DD, compared against the row's timestamp field.
 *   Status            — exact match (SENT / FAILED / …).
 *   Any other key     — substring match against the same column name.
 */
function applyLogFilters_(rows, f) {
  if (!f) return rows;
  var dateFrom = f.dateFrom || '';
  var dateTo = f.dateTo || '';
  var status = f.Status || '';
  var timeField = rows.length && (rows[0].Timestamp !== undefined ? 'Timestamp' : (rows[0].ExecutedAt !== undefined ? 'ExecutedAt' : ''));
  return rows.filter(function(r) {
    if (dateFrom && timeField) {
      var ts = String(r[timeField] || '').slice(0, 10);
      if (ts < dateFrom) return false;
    }
    if (dateTo && timeField) {
      var ts2 = String(r[timeField] || '').slice(0, 10);
      if (ts2 > dateTo) return false;
    }
    if (status && String(r.Status || r.Result || '') !== status) return false;
    return Object.keys(f).every(function(k) {
      if (['dateFrom','dateTo','Status'].indexOf(k) !== -1) return true;
      var v = f[k];
      if (v === '' || v == null) return true;
      return String(r[k] || '').toLowerCase().indexOf(String(v).toLowerCase()) !== -1;
    });
  });
}

/**
 * Server-side CSV export. Admins/managers can pull whole logs for month-end reporting.
 * payload: { table: 'EMAIL_LOG'|'AUDIT_LOG'|'REMINDER_LOG'|'ESCALATIONS'|'CLIENTS'|'BRANCHES', filters?: {} }
 * Returns { filename, mime, dataBase64 }
 */
function exportCsv_(payload) {
  var table = payload && payload.table;
  if (!SCHEMA[table]) throw ValidationError_('Unknown table: ' + table);
  var rows = readTable_(table);
  if (payload && payload.filters) {
    // Log-shaped filters (date range + status) for log tables; substring for others.
    if (['EMAIL_LOG','AUDIT_LOG','REMINDER_LOG'].indexOf(table) !== -1) rows = applyLogFilters_(rows, payload.filters);
    else rows = applyFilters_(rows, payload.filters);
  }
  var headers = SCHEMA[table];
  var lines = [headers.map(csvCell_).join(',')];
  rows.forEach(function(r){ lines.push(headers.map(function(h){ return csvCell_(r[h]); }).join(',')); });
  var csv = lines.join('\r\n');
  var stamp = Utilities.formatDate(new Date(), getTz_(), 'yyyyMMdd-HHmm');
  return {
    filename: table.toLowerCase() + '-' + stamp + '.csv',
    mime: 'text/csv',
    dataBase64: Utilities.base64Encode(csv, Utilities.Charset.UTF_8),
    rowCount: rows.length
  };
}

function csvCell_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.indexOf('"') !== -1) s = s.replace(/"/g, '""');
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) s = '"' + s + '"';
  return s;
}
