/**
 * Auth.gs — role-based access control.
 *
 * Roles: ADMIN, MANAGER, LOCATION_HEAD, VIEWER.
 * Auth identity comes from Google (Session.getActiveUser().getEmail()).
 * Every RPC verifies the caller against the USERS sheet.
 * Location Heads only see clients/branches assigned to them (or where they
 * are the DefaultLocationHead on the client).
 */

var VALID_ROLES = ['ADMIN','MANAGER','LOCATION_HEAD','VIEWER'];

function whoAmI_() {
  var email = '';
  try { email = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!email) return { email: '', role: 'VIEWER', active: false, name: 'Guest', pending: true };
  var user = readTable_('USERS').filter(function(u){ return String(u.Email || '').toLowerCase() === email; })[0];
  if (!user) {
    // First-time user; auto-create as pending so an admin can approve.
    var newU = {
      UserID: nextId_('USR'),
      Name: email.split('@')[0], Email: email, Mobile: '', Designation: '',
      Role: 'LOCATION_HEAD', LocationHead: '', Manager: '',
      Status: 'PENDING', CreatedAt: nowIso_(), UpdatedAt: nowIso_(), UpdatedBy: 'system'
    };
    // Never let a user auto-become admin. But if the sheet has no admins yet, seed as admin.
    var admins = readTable_('USERS').filter(function(u){ return u.Role === 'ADMIN' && u.Status === 'ACTIVE'; });
    if (admins.length === 0) { newU.Role = 'ADMIN'; newU.Status = 'ACTIVE'; }
    appendRow_('USERS', newU);
    user = newU;
  }
  return {
    email: user.Email, name: user.Name, role: user.Role,
    active: user.Status === 'ACTIVE',
    pending: user.Status === 'PENDING',
    userId: user.UserID,
    locationHead: user.LocationHead || ''
  };
}

function navForRole_(role) {
  var common = [{key:'dashboard', label:'Dashboard'}];
  if (role === 'ADMIN') return common.concat([
    {key:'clients', label:'Clients'},
    {key:'escalations', label:'Escalations'},
    {key:'admin', label:'Admin'},
    {key:'logs', label:'Logs'}
  ]);
  if (role === 'MANAGER') return common.concat([
    {key:'clients', label:'Clients'},
    {key:'escalations', label:'Escalations'},
    {key:'logs', label:'Logs'}
  ]);
  if (role === 'LOCATION_HEAD') return common.concat([
    {key:'clients', label:'My Clients'},
    {key:'escalations', label:'Escalations'}
  ]);
  return common.concat([{key:'clients', label:'Matrix'}, {key:'escalations', label:'Escalations'}]);
}

function requestAccess_(payload, me) {
  var email = me.email;
  if (!email) throw AuthError_('Please sign in with your Crux Google account.');
  var patch = {
    Name: payload.name || me.name, Mobile: payload.mobile || '',
    Designation: payload.designation || '',
    Manager: payload.manager || '', UpdatedAt: nowIso_(), UpdatedBy: email
  };
  updateRowById_('USERS', 'Email', email, patch);
  logAudit_({ user: email, action: 'REQUEST_ACCESS', entity: 'USERS', entityId: me.userId, oldValue:'', newValue: JSON.stringify(patch) });
  return { ok: true };
}

function listUsers_() { return readTable_('USERS'); }

function upsertUser_(payload, me) {
  var u = payload || {};
  if (!isEmail_(u.Email)) throw ValidationError_('Valid email is required.');
  if (VALID_ROLES.indexOf(u.Role) === -1) throw ValidationError_('Invalid role.');
  var existing = findRowById_('USERS', 'Email', String(u.Email).toLowerCase());
  var patch = {
    Name: u.Name || '', Email: String(u.Email).toLowerCase(), Mobile: u.Mobile || '',
    Designation: u.Designation || '', Role: u.Role, LocationHead: u.LocationHead || '',
    Manager: u.Manager || '', Status: u.Status || 'ACTIVE',
    UpdatedAt: nowIso_(), UpdatedBy: me.email
  };
  if (existing) {
    updateRowById_('USERS', 'Email', existing.Email, patch);
    logAudit_({ user: me.email, action: 'USER_UPDATE', entity: 'USERS', entityId: existing.UserID, oldValue: JSON.stringify(existing), newValue: JSON.stringify(patch) });
    return Object.assign({}, existing, patch);
  }
  patch.UserID = nextId_('USR'); patch.CreatedAt = nowIso_();
  appendRow_('USERS', patch);
  logAudit_({ user: me.email, action: 'USER_CREATE', entity: 'USERS', entityId: patch.UserID, oldValue:'', newValue: JSON.stringify(patch) });
  return patch;
}

/** Filter helper — Location Heads only see their own records. Admin/Manager see all. Viewer sees all read-only. */
function scopeClientsForUser_(clients, me) {
  if (me.role === 'ADMIN' || me.role === 'MANAGER' || me.role === 'VIEWER') return clients;
  // LOCATION_HEAD: match by DefaultLocationHead == user's email OR user's assigned LocationHead code
  var mine = String(me.email).toLowerCase();
  var lh = String(me.locationHead || '').toLowerCase();
  return clients.filter(function(c){
    var dlh = String(c.DefaultLocationHead || '').toLowerCase();
    return dlh === mine || (lh && dlh === lh);
  });
}
function scopeBranchesForUser_(branches, me) {
  if (me.role === 'ADMIN' || me.role === 'MANAGER' || me.role === 'VIEWER') return branches;
  var mine = String(me.email).toLowerCase();
  var lh = String(me.locationHead || '').toLowerCase();
  return branches.filter(function(b){
    var blh = String(b.LocationHead || '').toLowerCase();
    return blh === mine || (lh && blh === lh);
  });
}
function assertClientAccess_(client, me) {
  if (!client) throw ValidationError_('Client not found.');
  if (me.role === 'ADMIN' || me.role === 'MANAGER' || me.role === 'VIEWER') return;
  var mine = String(me.email).toLowerCase();
  var lh = String(me.locationHead || '').toLowerCase();
  var dlh = String(client.DefaultLocationHead || '').toLowerCase();
  if (dlh !== mine && (!lh || dlh !== lh)) throw AuthError_('You do not have access to this client.');
}
