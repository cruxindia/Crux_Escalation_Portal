/**
 * Portal.gs — read-only, tokenised client-facing portal.
 *
 * A signed URL of the form
 *   <WEB_APP_URL>?view=portal&c=<ClientID>&t=<HMAC>
 * renders a lightweight read-only page showing:
 *   - Client name + effective month
 *   - The 5-level escalation matrix
 *   - Branch contact directory (Crux POC per branch)
 *
 * The token is HMAC-SHA256(ClientID, PORTAL_SECRET). No login needed.
 * Admin generates the link from the client detail page.
 */

function ensurePortalSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('PORTAL_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PORTAL_SECRET', s);
  }
  return s;
}

function portalToken_(clientId) {
  var secret = ensurePortalSecret_();
  var sig = Utilities.computeHmacSha256Signature(String(clientId), secret);
  // URL-safe base64
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function portalUrl_(payload, me) {
  var clientId = payload.clientId;
  var c = findRowById_('CLIENTS','ClientID', clientId);
  assertClientAccess_(c, me);
  var base = ScriptApp.getService().getUrl() || '';
  var t = portalToken_(clientId);
  return {
    url: base + '?view=portal&c=' + encodeURIComponent(clientId) + '&t=' + encodeURIComponent(t),
    note: 'This link is signed for this client only. Access = depends on the Web App deployment access setting (see DEPLOYMENT.md → Portal).',
    revokeHint: 'To invalidate all existing portal links, run the "Rotate portal secret" action from Admin → Setup.'
  };
}

function portalRotate_(me) {
  PropertiesService.getScriptProperties().deleteProperty('PORTAL_SECRET');
  ensurePortalSecret_();
  logAudit_({ user: me.email, action: 'PORTAL_ROTATE', entity: 'PROPERTIES', entityId: 'PORTAL_SECRET', oldValue:'', newValue: 'rotated' });
  return { ok: true };
}

function getPortalPayload_(clientId, token) {
  if (!clientId || !token) throw new Error('Missing parameters.');
  var expected = portalToken_(clientId);
  if (String(expected) !== String(token)) throw new Error('Invalid or revoked link.');
  var c = findRowById_('CLIENTS', 'ClientID', clientId);
  if (!c || c.Status === 'INACTIVE') throw new Error('Client not available.');
  var matrix = readTable_('ESCALATION_MATRIX').filter(function(m){ return m.ClientID === clientId; });
  var branches = readTable_('BRANCHES').filter(function(b){ return b.ClientID === clientId && b.Status !== 'INACTIVE'; });
  return {
    company: getSetting_('COMPANY_NAME', 'Crux Risk Management Pvt Ltd'),
    client: { ClientName: c.ClientName, ClientCode: c.ClientCode, EffectiveFrom: c.EffectiveFrom, UpdatedAt: c.UpdatedAt },
    matrix: [1,2,3,4,5].map(function(L){
      var byL = matrix.filter(function(m){ return String(m.Level) === String(L); })[0] || {};
      var levelName = ['SPOC','Team Leader','Branch Manager','Zonal Manager','Head Office'][L-1];
      return { Level: L, LevelName: levelName, ContactName: byL.ContactName || '', Mobile: byL.Mobile || '', Email: byL.Email || '' };
    }),
    branches: branches.map(function(b){
      return { BranchName: b.BranchName, BranchCode: b.BranchCode, Address: b.Address, CruxPOCName: b.CruxPOCName, CruxPOCMobile: b.CruxPOCMobile, CruxPOCEmail: b.CruxPOCEmail };
    }),
    generatedAt: Utilities.formatDate(new Date(), getTz_(), 'dd MMM yyyy, HH:mm')
  };
}
