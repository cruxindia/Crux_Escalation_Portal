/**
 * Escalation.gs — LOG and RAISE escalation flows.
 */

var ESCALATION_STATUSES = ['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'];

function listEscalations_(p, me) {
  var rows = readTable_('ESCALATIONS');
  if (me.role === 'LOCATION_HEAD') {
    var mine = String(me.email).toLowerCase();
    rows = rows.filter(function(e){
      // owned by user or belongs to their client
      if (String(e.AssignedOwner || '').toLowerCase() === mine || String(e.CreatedBy || '').toLowerCase() === mine) return true;
      var c = findRowById_('CLIENTS','ClientID', e.ClientID);
      return c && String(c.DefaultLocationHead || '').toLowerCase() === mine;
    });
  }
  // Attach client name.
  var clientMap = {};
  readTable_('CLIENTS').forEach(function(c){ clientMap[c.ClientID] = c.ClientName; });
  rows = rows.map(function(r){ return Object.assign({}, r, { ClientName: clientMap[r.ClientID] || r.ClientID }); });
  rows = applyFilters_(rows, p && p.filters);
  return paginate_(rows, p);
}

function logEscalationCase_(payload, me) {
  var e = payload || {};
  if (!req_(e.ClientID)) throw ValidationError_('Client is required.');
  var c = findRowById_('CLIENTS','ClientID', e.ClientID);
  if (!c) throw ValidationError_('Invalid client.');
  var row = {
    EscalationID: nextId_('ESC'), Type: 'LOGGED',
    Date: e.Date || ymd_(new Date()), Time: e.Time || Utilities.formatDate(new Date(), getTz_(), 'HH:mm'),
    ClientID: e.ClientID, BranchID: e.BranchID || '',
    BranchCode: e.BranchCode || '',
    ContactName: e.ContactName || '', ContactPhone: e.ContactPhone || '',
    Category: e.Category || 'Service',
    Severity: e.Severity || 'Medium',
    EscalatedAgainst: e.EscalatedAgainst || '',
    Description: e.Description || '',
    AssignedOwner: (e.AssignedOwner || c.DefaultLocationHead || me.email).toLowerCase(),
    RequiredAction: e.RequiredAction || '', TargetDate: e.TargetDate || '',
    Status: 'OPEN', ClosureDate: '', ClosureRemarks: '',
    CreatedBy: me.email, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
  };
  appendRow_('ESCALATIONS', row);
  appendRow_('ESCALATION_HISTORY', {
    HistoryID: nextId_('EHI'), EscalationID: row.EscalationID, Timestamp: nowIso_(),
    User: me.email, Field: 'CREATE', OldValue: '', NewValue: 'LOGGED', Note: ''
  });
  logAudit_({ user: me.email, action: 'ESCALATION_LOG', entity: 'ESCALATIONS', entityId: row.EscalationID, oldValue: '', newValue: JSON.stringify(row) });
  return row;
}

function raiseEscalationCase_(payload, me) {
  var e = payload || {};
  if (!req_(e.ClientID)) throw ValidationError_('Client is required.');
  var c = findRowById_('CLIENTS','ClientID', e.ClientID);
  if (!c) throw ValidationError_('Invalid client.');
  var to = parseListStr_(e.To);
  if (to.length === 0 || !to.every(isEmail_)) throw ValidationError_('At least one valid recipient (TO) is required.');
  var cc = parseListStr_(e.Cc).filter(isEmail_);
  var row = {
    EscalationID: nextId_('ESC'), Type: 'RAISED',
    Date: ymd_(new Date()), Time: Utilities.formatDate(new Date(), getTz_(), 'HH:mm'),
    ClientID: e.ClientID, BranchID: e.BranchID || '',
    BranchCode: e.BranchCode || '',
    ContactName: '', ContactPhone: '',
    Category: e.Category || 'General',
    Severity: e.Severity || 'Medium',
    EscalatedAgainst: e.PersonConcerned || '',
    Description: e.Details || '',
    AssignedOwner: me.email,
    RequiredAction: e.RequiredResolution || '', TargetDate: e.DueDate || '',
    Status: 'OPEN', ClosureDate: '', ClosureRemarks: '',
    CreatedBy: me.email, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
  };
  appendRow_('ESCALATIONS', row);
  appendRow_('ESCALATION_HISTORY', {
    HistoryID: nextId_('EHI'), EscalationID: row.EscalationID, Timestamp: nowIso_(),
    User: me.email, Field: 'CREATE', OldValue: '', NewValue: 'RAISED', Note: ''
  });
  // Send the formal email now (logged automatically).
  var tpl = getTemplate_('RAISE_ESCALATION');
  var table = '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    kv_('Client', c.ClientName) + kv_('Branch Code', row.BranchCode) +
    kv_('Category', row.Category) + kv_('Severity', row.Severity) +
    kv_('Person/Team', row.EscalatedAgainst) + kv_('Details', row.Description) + '</table>';
  var vars = {
    CLIENT_NAME: c.ClientName, BRANCH_CODE: row.BranchCode,
    CATEGORY: row.Category, ESCALATION_TABLE: table,
    REQUIRED_RESOLUTION: row.RequiredAction, DUE_DATE: row.TargetDate,
    SIGNATURE: getSetting_('SIGNATURE','')
  };
  var res = sendEmail_({
    type: 'RAISED_ESCALATION', clientId: c.ClientID,
    to: to, cc: cc, subject: renderTemplate_(tpl.Subject, vars),
    htmlBody: renderTemplate_(tpl.Body, vars),
    trigger: 'escalations.raise',
    idempotencyKey: 'ESC-' + row.EscalationID,
    attachments: e.Attachments || []
  });
  logAudit_({ user: me.email, action: 'ESCALATION_RAISE', entity: 'ESCALATIONS', entityId: row.EscalationID, oldValue: '', newValue: JSON.stringify({ to: to, cc: cc, emailStatus: res.status, attachments: (e.Attachments||[]).length }) });
  return { escalation: row, email: res };
}

function updateEscalationCase_(payload, me) {
  var e = findRowById_('ESCALATIONS','EscalationID', payload.EscalationID);
  if (!e) throw ValidationError_('Escalation not found.');
  var patch = {};
  ['Status','AssignedOwner','RequiredAction','TargetDate','ClosureDate','ClosureRemarks','Severity','Category','Description'].forEach(function(k){
    if (payload[k] !== undefined) patch[k] = payload[k];
  });
  if (patch.Status && ESCALATION_STATUSES.indexOf(patch.Status) === -1) throw ValidationError_('Invalid status.');
  patch.UpdatedAt = nowIso_();
  updateRowById_('ESCALATIONS','EscalationID', e.EscalationID, patch);
  Object.keys(patch).forEach(function(k){
    if (k === 'UpdatedAt') return;
    appendRow_('ESCALATION_HISTORY', {
      HistoryID: nextId_('EHI'), EscalationID: e.EscalationID, Timestamp: nowIso_(),
      User: me.email, Field: k, OldValue: String(e[k] || ''), NewValue: String(patch[k] || ''), Note: ''
    });
  });
  logAudit_({ user: me.email, action: 'ESCALATION_UPDATE', entity: 'ESCALATIONS', entityId: e.EscalationID, oldValue: JSON.stringify(e), newValue: JSON.stringify(patch) });
  return Object.assign({}, e, patch);
}

function kv_(k, v) {
  return '<tr><td style="border:1px solid #d0d7de;background:#f6f8fa"><b>' + escHtml_(k) + '</b></td>' +
         '<td style="border:1px solid #d0d7de">' + escHtml_(v || '') + '</td></tr>';
}
