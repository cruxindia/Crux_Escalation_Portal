/**
 * Email.gs — email engine, templates, logging, retry, dry-run.
 *
 * Sending path is GmailApp.sendEmail (uses the authorized deployer's Gmail),
 * so no SMTP/app-password is needed. The deployer must have the send-mail
 * OAuth scope on first authorization (declared in appsscript.json).
 */

/**
 * Central send with idempotency, dry-run, retry, and logging.
 * options: {
 *   type, clientId, branchId, to, cc, subject, htmlBody, trigger,
 *   idempotencyKey, replyTo, senderName, bcc
 * }
 */
function sendEmail_(options) {
  var opt = options || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (opt.idempotencyKey) {
      var existing = readTable_('EMAIL_LOG').filter(function(r){
        return r.IdempotencyKey === opt.idempotencyKey && r.Status === 'SENT';
      })[0];
      if (existing) return { skipped: true, reason: 'already sent', logId: existing.LogID };
    }
    var dryRun = getSetting_('DRY_RUN','false') === 'true';
    var override = getSetting_('TEST_EMAIL_OVERRIDE','');
    var toAddr = (opt.to || []).slice();
    var ccAddr = dedupeEmails_(opt.cc || [], toAddr);
    var bccAddr = dedupeEmails_(opt.bcc || parseListStr_(getSetting_('DEFAULT_BCC','')), toAddr.concat(ccAddr));
    // remove dupes from To against itself
    toAddr = dedupeEmails_(toAddr, []);
    if (toAddr.length === 0) throw new Error('No valid recipient');
    if (dryRun) {
      if (!isEmail_(override)) throw new Error('DRY_RUN is enabled but TEST_EMAIL_OVERRIDE is not set.');
      // Rewrite recipients but include the intended list in the body header.
      opt.htmlBody = '<div style="background:#fff3bf;padding:10px;margin:0 0 12px;border:1px solid #fab005">' +
        '<b>TEST MODE</b> — original To: ' + toAddr.join(', ') +
        (ccAddr.length ? '<br/>original CC: ' + ccAddr.join(', ') : '') + '</div>' + (opt.htmlBody || '');
      toAddr = [override]; ccAddr = []; bccAddr = [];
    }
    var subject = opt.subject || '(no subject)';
    var senderName = opt.senderName || getSetting_('FROM_NAME','Crux Risk Management');
    var replyTo = opt.replyTo || getSetting_('REPLY_TO','');
    var logId = nextId_('EML');
    var attempt = 1;
    var status = 'PENDING';
    var errorMsg = '';
    var messageRef = '';
    try {
      GmailApp.sendEmail(toAddr.join(','), subject, stripHtml_(opt.htmlBody || ''), {
        htmlBody: (opt.htmlBody || '') + (getSetting_('SIGNATURE','') || ''),
        name: senderName,
        cc: ccAddr.join(','),
        bcc: bccAddr.join(','),
        replyTo: replyTo || undefined
      });
      status = 'SENT';
      messageRef = 'gmail:' + Utilities.getUuid();
    } catch (e) {
      status = 'FAILED';
      errorMsg = String(e && e.message || e);
    }
    appendRow_('EMAIL_LOG', {
      LogID: logId, Timestamp: nowIso_(),
      Type: opt.type || 'MANUAL',
      ClientID: opt.clientId || '', BranchID: opt.branchId || '',
      ToAddr: toAddr.join(','), CcAddr: ccAddr.join(','),
      Subject: subject, Trigger: opt.trigger || '',
      SentBy: (Session.getEffectiveUser() || {}).getEmail && Session.getEffectiveUser().getEmail() || '',
      Status: status, Attempt: attempt, Error: errorMsg,
      MessageRef: messageRef, IdempotencyKey: opt.idempotencyKey || ''
    });
    return { logId: logId, status: status, error: errorMsg };
  } finally {
    lock.releaseLock();
  }
}

function stripHtml_(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim(); }

function getTemplate_(key) {
  var rows = readTable_('EMAIL_TEMPLATES');
  return rows.filter(function(r){ return r.Key === key; })[0] || { Subject:'', Body:'' };
}

/* ---------- Public admin actions ---------- */

function sendTestEmail_(payload, me) {
  var to = payload.to || me.email;
  if (!isEmail_(to)) throw ValidationError_('Please provide a valid test email.');
  var tpl = getTemplate_('TEST');
  var body = renderTemplate_(tpl.Body, { SIGNATURE: getSetting_('SIGNATURE','') });
  var subj = renderTemplate_(tpl.Subject, {});
  return sendEmail_({
    type: 'TEST', to: [to], cc: [],
    subject: subj, htmlBody: body, trigger: 'admin.email.test'
  });
}

function retryEmail_(payload, me) {
  var log = findRowById_('EMAIL_LOG', 'LogID', payload.logId);
  if (!log) throw ValidationError_('Log not found.');
  if (log.Status === 'SENT') return { skipped: true, reason: 'already sent' };
  var limit = parseInt(getSetting_('RETRY_LIMIT','3'), 10);
  if ((parseInt(log.Attempt || 1, 10)) >= limit) throw ValidationError_('Retry limit reached.');
  var res = sendEmail_({
    type: log.Type, clientId: log.ClientID, branchId: log.BranchID,
    to: parseListStr_(log.ToAddr), cc: parseListStr_(log.CcAddr),
    subject: log.Subject, htmlBody: '(retry) See original log ' + log.LogID,
    trigger: 'admin.email.retry',
    idempotencyKey: log.IdempotencyKey ? log.IdempotencyKey + '-retry-' + (parseInt(log.Attempt || 1, 10) + 1) : ''
  });
  updateRowById_('EMAIL_LOG', 'LogID', log.LogID, {
    Attempt: (parseInt(log.Attempt || 1, 10) + 1),
    Status: res.status, Error: res.error || ''
  });
  return res;
}

/* ---------- Rendering helpers used by scheduler/dispatch ---------- */

function matrixToHtml_(client, matrixRows) {
  var byLevel = {}; matrixRows.forEach(function(r){ byLevel[r.Level] = r; });
  var rows = MATRIX_LEVELS.map(function(L){
    var r = byLevel[L.level] || {};
    return '<tr><td>' + L.level + '</td><td>' + L.name + '</td>' +
      '<td>' + escHtml_(r.ContactName) + '</td>' +
      '<td>' + escHtml_(r.Mobile) + '</td>' +
      '<td>' + escHtml_(r.Email) + '</td></tr>';
  }).join('');
  return '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;font-family:Arial,sans-serif;font-size:14px">' +
    '<thead style="background:#f6f8fa"><tr>' +
      '<th style="border:1px solid #d0d7de">#</th>' +
      '<th style="border:1px solid #d0d7de">Level</th>' +
      '<th style="border:1px solid #d0d7de">Name</th>' +
      '<th style="border:1px solid #d0d7de">Mobile</th>' +
      '<th style="border:1px solid #d0d7de">Email</th>' +
    '</tr></thead><tbody>' + rows.replace(/<td>/g,'<td style="border:1px solid #d0d7de">') + '</tbody></table>';
}

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function clientListToHtml_(clients) {
  if (!clients.length) return '<p><i>No clients pending.</i></p>';
  var rows = clients.map(function(c){
    return '<tr><td style="border:1px solid #d0d7de;padding:6px">' + escHtml_(c.ClientName) +
      '</td><td style="border:1px solid #d0d7de;padding:6px">' + escHtml_(c.ClientCode || '') +
      '</td><td style="border:1px solid #d0d7de;padding:6px">' + escHtml_(c._status || '') + '</td></tr>';
  }).join('');
  return '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><thead style="background:#f6f8fa"><tr><th style="border:1px solid #d0d7de;padding:6px">Client</th><th style="border:1px solid #d0d7de;padding:6px">Code</th><th style="border:1px solid #d0d7de;padding:6px">Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function missingToHtml_(missing) {
  return '<ul>' + missing.map(function(m){ return '<li>' + escHtml_(m) + '</li>'; }).join('') + '</ul>';
}
