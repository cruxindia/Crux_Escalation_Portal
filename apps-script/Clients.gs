/**
 * Clients.gs — client / branch / matrix domain logic.
 */

var MATRIX_LEVELS = [
  { level: 1, name: 'SPOC' },
  { level: 2, name: 'Team Leader' },
  { level: 3, name: 'Branch Manager' },
  { level: 4, name: 'Zonal Manager' },
  { level: 5, name: 'Head Office' }
];

/* ---------- CLIENTS ---------- */

function listClients_(p, me) {
  var rows = readTable_('CLIENTS');
  rows = scopeClientsForUser_(rows, me);
  rows = applyFilters_(rows, p && p.filters);
  // Attach summary stats.
  var branches = readTable_('BRANCHES');
  var matrix = readTable_('ESCALATION_MATRIX');
  rows = rows.map(function(c){
    var bcount = branches.filter(function(b){ return b.ClientID === c.ClientID && b.Status !== 'INACTIVE'; }).length;
    var m = matrix.filter(function(m){ return m.ClientID === c.ClientID; });
    var complete = isMatrixComplete_(c, m);
    return Object.assign({}, c, { _branchCount: bcount, _matrixComplete: complete });
  });
  return paginate_(rows, p);
}

function getClient_(id, me) {
  var c = findRowById_('CLIENTS', 'ClientID', id);
  assertClientAccess_(c, me);
  var branches = readTable_('BRANCHES').filter(function(b){ return b.ClientID === id; });
  var matrix = readTable_('ESCALATION_MATRIX').filter(function(m){ return m.ClientID === id; });
  return { client: c, branches: branches, matrix: matrix };
}

function upsertClient_(payload, me) {
  var c = payload || {};
  if (!req_(c.ClientName)) throw ValidationError_('Client Name is required.');
  if (c.ClientEmail && !isEmail_(c.ClientEmail)) throw ValidationError_('Client email format is invalid.');
  var existing = c.ClientID ? findRowById_('CLIENTS', 'ClientID', c.ClientID) : null;
  var patch = {
    ClientName: c.ClientName, ClientCode: c.ClientCode || '',
    ClientEmail: c.ClientEmail || '', ClientCC: c.ClientCC || '',
    DefaultLocationHead: (c.DefaultLocationHead || '').toString().toLowerCase(),
    Status: c.Status || 'ACTIVE',
    EffectiveFrom: c.EffectiveFrom || '', EffectiveTo: c.EffectiveTo || '',
    Notes: c.Notes || '', UpdatedAt: nowIso_(), UpdatedBy: me.email
  };
  if (existing) {
    assertClientAccess_(existing, me);
    // Duplicate name check (case-insensitive) except self.
    var dupe = readTable_('CLIENTS').filter(function(r){ return r.ClientID !== existing.ClientID && String(r.ClientName).toLowerCase() === String(patch.ClientName).toLowerCase(); })[0];
    if (dupe) throw ValidationError_('Another client already exists with this name.');
    updateRowById_('CLIENTS', 'ClientID', existing.ClientID, patch);
    logAudit_({ user: me.email, action: 'CLIENT_UPDATE', entity: 'CLIENTS', entityId: existing.ClientID, oldValue: JSON.stringify(existing), newValue: JSON.stringify(patch) });
    return Object.assign({}, existing, patch);
  }
  patch.ClientID = nextId_('CLI'); patch.CreatedAt = nowIso_();
  var dupe2 = readTable_('CLIENTS').filter(function(r){ return String(r.ClientName).toLowerCase() === String(patch.ClientName).toLowerCase(); })[0];
  if (dupe2) throw ValidationError_('A client already exists with this name.');
  appendRow_('CLIENTS', patch);
  logAudit_({ user: me.email, action: 'CLIENT_CREATE', entity: 'CLIENTS', entityId: patch.ClientID, oldValue:'', newValue: JSON.stringify(patch) });
  return patch;
}

function setClientStatus_(payload, me) {
  var c = findRowById_('CLIENTS', 'ClientID', payload.id);
  if (!c) throw ValidationError_('Client not found.');
  updateRowById_('CLIENTS', 'ClientID', c.ClientID, { Status: payload.status, UpdatedAt: nowIso_(), UpdatedBy: me.email });
  logAudit_({ user: me.email, action: 'CLIENT_STATUS', entity: 'CLIENTS', entityId: c.ClientID, oldValue: c.Status, newValue: payload.status });
  return { ok: true };
}

/* ---------- BRANCHES ---------- */

function listBranches_(p, me) {
  var rows = readTable_('BRANCHES');
  if (p && p.clientId) rows = rows.filter(function(b){ return b.ClientID === p.clientId; });
  rows = scopeBranchesForUser_(rows, me);
  rows = applyFilters_(rows, p && p.filters);
  return paginate_(rows, p);
}

function upsertBranch_(payload, me) {
  var b = payload || {};
  if (!req_(b.ClientID)) throw ValidationError_('Client is required.');
  if (!req_(b.BranchName)) throw ValidationError_('Branch Name is required.');
  if (!req_(b.BranchCode)) throw ValidationError_('Branch Code is required.');
  if (b.CruxPOCEmail && !isEmail_(b.CruxPOCEmail)) throw ValidationError_('Crux POC email format is invalid.');
  if (b.BranchManagerEmail && !isEmail_(b.BranchManagerEmail)) throw ValidationError_('Branch manager email format is invalid.');
  if (b.CruxPOCMobile && !isPhone_(b.CruxPOCMobile)) throw ValidationError_('Crux POC mobile format is invalid.');
  var client = findRowById_('CLIENTS', 'ClientID', b.ClientID);
  if (!client) throw ValidationError_('Invalid client reference.');
  assertClientAccess_(client, me);
  // duplicate branch code under same client
  var siblings = readTable_('BRANCHES').filter(function(r){ return r.ClientID === b.ClientID; });
  var dupe = siblings.filter(function(r){
    return String(r.BranchCode).toLowerCase() === String(b.BranchCode).toLowerCase()
      && r.BranchID !== b.BranchID;
  })[0];
  if (dupe) throw ValidationError_('Duplicate Branch Code under this client.');
  var patch = {
    ClientID: b.ClientID, BranchName: b.BranchName, BranchCode: b.BranchCode,
    Address: b.Address || '',
    CruxPOCName: b.CruxPOCName || '', CruxPOCEmpID: b.CruxPOCEmpID || '',
    CruxPOCMobile: b.CruxPOCMobile || '', CruxPOCEmail: b.CruxPOCEmail || '',
    BranchManagerName: b.BranchManagerName || '', BranchManagerMobile: b.BranchManagerMobile || '', BranchManagerEmail: b.BranchManagerEmail || '',
    LocationHead: String(b.LocationHead || '').toLowerCase(),
    Location: b.Location || '', Zone: b.Zone || '',
    Status: b.Status || 'ACTIVE',
    EffectiveFrom: b.EffectiveFrom || '', EffectiveTo: b.EffectiveTo || '',
    Notes: b.Notes || '', UpdatedAt: nowIso_(), UpdatedBy: me.email
  };
  var existing = b.BranchID ? findRowById_('BRANCHES', 'BranchID', b.BranchID) : null;
  if (existing) {
    updateRowById_('BRANCHES', 'BranchID', existing.BranchID, patch);
    logAudit_({ user: me.email, action: 'BRANCH_UPDATE', entity: 'BRANCHES', entityId: existing.BranchID, oldValue: JSON.stringify(existing), newValue: JSON.stringify(patch) });
    return Object.assign({}, existing, patch);
  }
  patch.BranchID = nextId_('BR'); patch.CreatedAt = nowIso_();
  appendRow_('BRANCHES', patch);
  logAudit_({ user: me.email, action: 'BRANCH_CREATE', entity: 'BRANCHES', entityId: patch.BranchID, oldValue:'', newValue: JSON.stringify(patch) });
  return patch;
}

function setBranchStatus_(payload, me) {
  var b = findRowById_('BRANCHES', 'BranchID', payload.id);
  if (!b) throw ValidationError_('Branch not found.');
  updateRowById_('BRANCHES', 'BranchID', b.BranchID, { Status: payload.status, UpdatedAt: nowIso_(), UpdatedBy: me.email });
  logAudit_({ user: me.email, action: 'BRANCH_STATUS', entity: 'BRANCHES', entityId: b.BranchID, oldValue: b.Status, newValue: payload.status });
  return { ok: true };
}

/* ---------- ESCALATION MATRIX ---------- */

function getMatrix_(clientId, me) {
  var c = findRowById_('CLIENTS', 'ClientID', clientId);
  assertClientAccess_(c, me);
  var rows = readTable_('ESCALATION_MATRIX').filter(function(m){ return m.ClientID === clientId; });
  // Ensure 5 rows always exist in the response, even if unsaved.
  var byLevel = {};
  rows.forEach(function(r){ byLevel[r.Level] = r; });
  return MATRIX_LEVELS.map(function(L) {
    var r = byLevel[L.level] || {};
    return {
      Level: L.level, LevelName: L.name,
      ContactName: r.ContactName || '', Mobile: r.Mobile || '', Email: r.Email || '',
      MatrixID: r.MatrixID || '', UpdatedAt: r.UpdatedAt || '', UpdatedBy: r.UpdatedBy || ''
    };
  });
}

function saveMatrix_(payload, me) {
  var clientId = payload.clientId;
  var rows = payload.rows || [];
  var c = findRowById_('CLIENTS', 'ClientID', clientId);
  if (!c) throw ValidationError_('Client not found.');
  assertClientAccess_(c, me);
  var existing = readTable_('ESCALATION_MATRIX').filter(function(m){ return m.ClientID === clientId; });
  var byLevel = {}; existing.forEach(function(r){ byLevel[r.Level] = r; });
  rows.forEach(function(r) {
    if (r.Email && !isEmail_(r.Email)) throw ValidationError_('Invalid email for level ' + r.LevelName);
    if (r.Mobile && !isPhone_(r.Mobile)) throw ValidationError_('Invalid mobile for level ' + r.LevelName);
    var e = byLevel[r.Level];
    var patch = {
      Level: r.Level, LevelName: r.LevelName,
      ContactName: r.ContactName || '', Mobile: r.Mobile || '', Email: r.Email || '',
      UpdatedAt: nowIso_(), UpdatedBy: me.email
    };
    if (e) {
      updateRowById_('ESCALATION_MATRIX', 'MatrixID', e.MatrixID, patch);
    } else {
      patch.MatrixID = nextId_('MTX'); patch.ClientID = clientId;
      appendRow_('ESCALATION_MATRIX', patch);
    }
  });
  updateRowById_('CLIENTS', 'ClientID', clientId, { UpdatedAt: nowIso_(), UpdatedBy: me.email });
  logAudit_({ user: me.email, action: 'MATRIX_SAVE', entity: 'ESCALATION_MATRIX', entityId: clientId, oldValue: JSON.stringify(existing), newValue: JSON.stringify(rows) });
  return { ok: true };
}

/** Validate a client's matrix. Returns {complete, missing:[...]}. */
function validateClientMatrix_(client, matrixRows) {
  var missing = [];
  if (!isEmail_(client.ClientEmail)) missing.push('Client Email');
  var byLevel = {}; (matrixRows || []).forEach(function(r){ byLevel[r.Level] = r; });
  MATRIX_LEVELS.forEach(function(L) {
    var r = byLevel[L.level] || {};
    if (!req_(r.ContactName)) missing.push(L.name + ' — Name');
    if (!isPhone_(r.Mobile))  missing.push(L.name + ' — Mobile');
    if (!isEmail_(r.Email))   missing.push(L.name + ' — Email');
  });
  return { complete: missing.length === 0, missing: missing };
}

function isMatrixComplete_(client, matrixRows) {
  return validateClientMatrix_(client, matrixRows).complete;
}

function dashboardSummary_(me) {
  var clients = scopeClientsForUser_(readTable_('CLIENTS'), me);
  var branches = scopeBranchesForUser_(readTable_('BRANCHES'), me);
  var matrix = readTable_('ESCALATION_MATRIX');
  var escal = readTable_('ESCALATIONS');
  var emailLog = readTable_('EMAIL_LOG');
  var activeClients = clients.filter(function(c){ return c.Status !== 'INACTIVE'; });
  var complete = 0, incomplete = 0;
  activeClients.forEach(function(c){
    var m = matrix.filter(function(x){ return x.ClientID === c.ClientID; });
    if (isMatrixComplete_(c, m)) complete++; else incomplete++;
  });
  var monthKey = monthKey_(new Date());
  var monthEmails = emailLog.filter(function(e){ return String(e.Timestamp).indexOf(monthKey) === 0; });
  return {
    role: me.role,
    totals: {
      clients: activeClients.length,
      branches: branches.filter(function(b){ return b.Status !== 'INACTIVE'; }).length,
      complete: complete, incomplete: incomplete,
      openEscalations: escal.filter(function(e){ return ['OPEN','ASSIGNED','IN_PROGRESS'].indexOf(e.Status) !== -1; }).length,
      emailsThisMonth: monthEmails.length,
      failedEmails: monthEmails.filter(function(e){ return e.Status === 'FAILED'; }).length
    },
    myClients: me.role === 'LOCATION_HEAD' ? activeClients.slice(0, 10) : [],
    incompleteList: activeClients.filter(function(c){
      var m = matrix.filter(function(x){ return x.ClientID === c.ClientID; });
      return !isMatrixComplete_(c, m);
    }).slice(0, 20)
  };
}

function seedDemoData_(me) {
  // Idempotent: only seed if empty.
  if (readTable_('CLIENTS').length > 0) return { seeded: false, reason: 'already has data' };
  var lhEmail = me.email; // assign to current user
  var clientRows = [
    { name:'ABC Bank', code:'ABCB', email:'ops@abc-bank.example.com', cc:'compliance@abc-bank.example.com' },
    { name:'XYZ Finance', code:'XYZF', email:'support@xyzfin.example.com', cc:'' },
    { name:'Nova Insurance', code:'NOVA', email:'client-desk@nova.example.com', cc:'ops@nova.example.com' }
  ];
  var clients = clientRows.map(function(cr) {
    var c = {
      ClientID: nextId_('CLI'), ClientName: cr.name, ClientCode: cr.code,
      ClientEmail: cr.email, ClientCC: cr.cc,
      DefaultLocationHead: lhEmail, Status:'ACTIVE',
      EffectiveFrom: ymd_(new Date()), EffectiveTo:'', Notes:'Demo',
      CreatedAt: nowIso_(), UpdatedAt: nowIso_(), UpdatedBy:'seed'
    };
    appendRow_('CLIENTS', c);
    return c;
  });
  var branchTpl = [
    ['001','Andheri','Mumbai','West'],
    ['002','Borivali','Mumbai','West'],
    ['003','Pune','Pune','West'],
    ['004','Nashik','Nashik','West']
  ];
  clients.forEach(function(c) {
    branchTpl.forEach(function(bt) {
      appendRow_('BRANCHES', {
        BranchID: nextId_('BR'), ClientID: c.ClientID,
        BranchName: bt[1], BranchCode: c.ClientCode + '-' + bt[0], Address: bt[2] + ', India',
        CruxPOCName: 'Rahul Sharma', CruxPOCEmpID:'CRX-101', CruxPOCMobile:'9876543210', CruxPOCEmail:'rahul.sharma@crux.example.com',
        BranchManagerName:'Priya Nair', BranchManagerMobile:'9812345670', BranchManagerEmail:'priya.nair@'+c.ClientCode.toLowerCase()+'.example.com',
        LocationHead: lhEmail, Location: bt[2], Zone: bt[3], Status:'ACTIVE',
        EffectiveFrom: ymd_(new Date()), EffectiveTo:'', Notes:'', CreatedAt: nowIso_(), UpdatedAt: nowIso_(), UpdatedBy:'seed'
      });
    });
  });
  // Matrix: fill fully for first two clients, leave 3rd partial.
  function fillMatrix(client, partial) {
    MATRIX_LEVELS.forEach(function(L) {
      if (partial && L.level >= 4) return;
      appendRow_('ESCALATION_MATRIX', {
        MatrixID: nextId_('MTX'), ClientID: client.ClientID,
        Level: L.level, LevelName: L.name,
        ContactName: L.name + ' ' + client.ClientCode,
        Mobile: '9800' + (100000 + L.level * 111 + Math.floor(Math.random()*89)),
        Email: L.name.toLowerCase().replace(/\s+/g,'.') + '@' + client.ClientCode.toLowerCase() + '.example.com',
        UpdatedAt: nowIso_(), UpdatedBy:'seed'
      });
    });
  }
  fillMatrix(clients[0], false);
  fillMatrix(clients[1], false);
  fillMatrix(clients[2], true);
  // Holidays
  var yr = new Date().getFullYear();
  [
    [yr+'-01-26','Republic Day'],
    [yr+'-08-15','Independence Day'],
    [yr+'-10-02','Gandhi Jayanti']
  ].forEach(function(h){ appendRow_('HOLIDAYS', { HolidayID: nextId_('HOL'), Date: h[0], Name: h[1], Status:'ACTIVE', CreatedAt: nowIso_() }); });
  return { seeded: true, clients: clients.length };
}
