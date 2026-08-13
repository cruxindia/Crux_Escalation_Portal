/**
 * Import.gs — bulk import (Clients, Branches, Matrix).
 *
 * Flow: parse rows on client-side → send here with kind + rows.
 *   validate: returns per-row status + summary (do not write)
 *   commit  : writes only rows marked as valid (or update-on-existing)
 */

var IMPORT_SPEC = {
  CLIENTS: {
    required: ['ClientName'],
    fields:   ['ClientName','ClientCode','ClientEmail','ClientCC','DefaultLocationHead','Status','EffectiveFrom','EffectiveTo','Notes'],
    key: 'ClientName'
  },
  BRANCHES: {
    required: ['ClientName','BranchName','BranchCode'],
    fields:   ['ClientName','BranchName','BranchCode','Address','CruxPOCName','CruxPOCEmpID','CruxPOCMobile','CruxPOCEmail','BranchManagerName','BranchManagerMobile','BranchManagerEmail','LocationHead','Location','Zone','Status','EffectiveFrom','EffectiveTo','Notes'],
    key: ['ClientName','BranchCode']
  },
  MATRIX: {
    required: ['ClientName','Level','ContactName','Email'],
    fields:   ['ClientName','Level','ContactName','Mobile','Email'],
    key: ['ClientName','Level']
  }
};

function validateImport_(payload, me) {
  var kind = payload.kind;
  var spec = IMPORT_SPEC[kind];
  if (!spec) throw ValidationError_('Unknown import kind.');
  var rows = payload.rows || [];
  var clientsByName = {};
  readTable_('CLIENTS').forEach(function(c){ clientsByName[String(c.ClientName).toLowerCase()] = c; });
  var result = { total: rows.length, valid: 0, invalid: 0, updates: 0, creates: 0, duplicatesInFile: 0, items: [] };
  var seenKeys = {};
  rows.forEach(function(row, idx) {
    var errors = [];
    spec.required.forEach(function(f){ if (!req_(row[f])) errors.push(f + ' is required'); });
    if (row.ClientEmail && !isEmail_(row.ClientEmail)) errors.push('ClientEmail is invalid');
    if (row.CruxPOCEmail && !isEmail_(row.CruxPOCEmail)) errors.push('CruxPOCEmail is invalid');
    if (row.BranchManagerEmail && !isEmail_(row.BranchManagerEmail)) errors.push('BranchManagerEmail is invalid');
    if (row.Email && !isEmail_(row.Email)) errors.push('Email is invalid');
    if (row.CruxPOCMobile && !isPhone_(row.CruxPOCMobile)) errors.push('CruxPOCMobile is invalid');
    if (row.Mobile && !isPhone_(row.Mobile)) errors.push('Mobile is invalid');
    var isDuplicateInFile = false, isUpdate = false;
    if (kind === 'BRANCHES' || kind === 'MATRIX') {
      var clientHit = clientsByName[String(row.ClientName || '').toLowerCase()];
      if (!clientHit) errors.push('ClientName does not match any active client');
      row._clientId = clientHit && clientHit.ClientID;
    }
    // key
    var keyVal;
    if (Array.isArray(spec.key)) keyVal = spec.key.map(function(k){ return String(row[k]||'').toLowerCase(); }).join('|');
    else keyVal = String(row[spec.key]||'').toLowerCase();
    if (seenKeys[keyVal]) { isDuplicateInFile = true; result.duplicatesInFile++; }
    else seenKeys[keyVal] = 1;
    // existence check for updates
    if (kind === 'CLIENTS') {
      var existing = clientsByName[String(row.ClientName || '').toLowerCase()];
      isUpdate = !!existing;
    } else if (kind === 'BRANCHES') {
      var existingB = row._clientId
        ? readTable_('BRANCHES').filter(function(b){ return b.ClientID === row._clientId && String(b.BranchCode).toLowerCase() === String(row.BranchCode).toLowerCase(); })[0]
        : null;
      isUpdate = !!existingB;
      row._existingId = existingB && existingB.BranchID;
    } else if (kind === 'MATRIX') {
      var existingM = row._clientId
        ? readTable_('ESCALATION_MATRIX').filter(function(m){ return m.ClientID === row._clientId && String(m.Level) === String(row.Level); })[0]
        : null;
      isUpdate = !!existingM;
      row._existingId = existingM && existingM.MatrixID;
      if (row.Level && (parseInt(row.Level,10) < 1 || parseInt(row.Level,10) > 5)) errors.push('Level must be 1-5');
    }
    var status = errors.length === 0 ? (isUpdate ? 'UPDATE' : 'CREATE') : 'INVALID';
    if (isDuplicateInFile) status = 'DUPLICATE_IN_FILE';
    if (status === 'INVALID' || status === 'DUPLICATE_IN_FILE') result.invalid++;
    else {
      result.valid++;
      if (status === 'UPDATE') result.updates++; else result.creates++;
    }
    result.items.push({ index: idx, row: row, status: status, errors: errors });
  });
  return result;
}

function commitImport_(payload, me) {
  var kind = payload.kind;
  var items = payload.items || [];
  var ok = 0, fail = 0, errors = [];
  items.forEach(function(item) {
    if (item.status !== 'CREATE' && item.status !== 'UPDATE') return;
    try {
      if (kind === 'CLIENTS') {
        var row = item.row;
        upsertClient_({
          ClientID: (findRowById_('CLIENTS','ClientName', row.ClientName) || {}).ClientID,
          ClientName: row.ClientName, ClientCode: row.ClientCode || '',
          ClientEmail: row.ClientEmail || '', ClientCC: row.ClientCC || '',
          DefaultLocationHead: row.DefaultLocationHead || '',
          Status: row.Status || 'ACTIVE',
          EffectiveFrom: row.EffectiveFrom || '', EffectiveTo: row.EffectiveTo || '',
          Notes: row.Notes || ''
        }, me);
      } else if (kind === 'BRANCHES') {
        var b = item.row;
        upsertBranch_({
          BranchID: b._existingId, ClientID: b._clientId,
          BranchName: b.BranchName, BranchCode: b.BranchCode, Address: b.Address || '',
          CruxPOCName: b.CruxPOCName || '', CruxPOCEmpID: b.CruxPOCEmpID || '',
          CruxPOCMobile: b.CruxPOCMobile || '', CruxPOCEmail: b.CruxPOCEmail || '',
          BranchManagerName: b.BranchManagerName || '', BranchManagerMobile: b.BranchManagerMobile || '', BranchManagerEmail: b.BranchManagerEmail || '',
          LocationHead: b.LocationHead || '', Location: b.Location || '', Zone: b.Zone || '',
          Status: b.Status || 'ACTIVE', EffectiveFrom: b.EffectiveFrom || '', EffectiveTo: b.EffectiveTo || '', Notes: b.Notes || ''
        }, me);
      } else if (kind === 'MATRIX') {
        var m = item.row;
        var levelName = (MATRIX_LEVELS[parseInt(m.Level,10)-1] || {}).name || '';
        saveMatrix_({ clientId: m._clientId, rows: [{
          Level: parseInt(m.Level,10), LevelName: levelName,
          ContactName: m.ContactName || '', Mobile: m.Mobile || '', Email: m.Email || ''
        }]}, me);
      }
      ok++;
    } catch (e) {
      fail++;
      errors.push({ index: item.index, error: String(e.message || e) });
    }
  });
  logAudit_({ user: me.email, action: 'IMPORT_' + kind, entity: 'IMPORT', entityId: '', oldValue: '', newValue: JSON.stringify({ ok: ok, fail: fail }) });
  return { ok: ok, fail: fail, errors: errors };
}
