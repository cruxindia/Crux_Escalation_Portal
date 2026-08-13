/**
 * Scheduler.gs — reminders (25th, LWD), monthly dispatch (1st).
 *
 * Google's time-driven triggers can drift by a few minutes. We therefore:
 *   1. Install a single "tick" trigger that fires every 5 minutes.
 *   2. Each tick checks: today's date + configured schedule time, and if
 *      the job is due AND not yet run this month, runs it exactly once.
 *   3. Idempotency is enforced by REMINDER_LOG.JobKey ("YYYY-MM-<TYPE>").
 *   4. LockService prevents concurrent execution.
 */

var JOB_TYPES = { R25:'REMINDER_25', RLW:'REMINDER_LWD', DIS:'MONTHLY_DISPATCH' };

/** Called by the installable time-driven trigger every 5 minutes. */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var now = new Date();
    var tz = getTz_();
    var today = parseInt(Utilities.formatDate(now, tz, 'd'), 10);
    var hhmm  = Utilities.formatDate(now, tz, 'HH:mm');
    var month = Utilities.formatDate(now, tz, 'yyyy-MM');
    var remDay = parseInt(getSetting_('REMINDER_DAY_1','25'), 10);
    var remTime = getSetting_('REMINDER_TIME','12:00');
    var disDay = parseInt(getSetting_('MONTHLY_DISPATCH_DAY','1'), 10);
    var disTime = getSetting_('MONTHLY_DISPATCH_TIME','10:00');
    // Reminder 25th: fire on the configured day at the earliest tick >= configured time.
    if (today === remDay && hhmm >= remTime && !jobDone_(month, JOB_TYPES.R25)) {
      runReminder_(JOB_TYPES.R25, 'auto');
    }
    // Reminder LWD: compute last-working-day for current month; fire on that day at >= configured time.
    var lwd = lastWorkingDay_(now.getFullYear(), now.getMonth());
    var lwdDay = parseInt(Utilities.formatDate(lwd, tz, 'd'), 10);
    if (today === lwdDay && hhmm >= remTime && !jobDone_(month, JOB_TYPES.RLW)) {
      runReminder_(JOB_TYPES.RLW, 'auto');
    }
    // Monthly dispatch on 1st (of NEW month), at configured time.
    if (today === disDay && hhmm >= disTime && !jobDone_(month, JOB_TYPES.DIS)) {
      runDispatch_('auto');
    }
  } finally {
    lock.releaseLock();
  }
}

function jobDone_(monthKey, type) {
  var jobKey = monthKey + '-' + type;
  var rows = readTable_('REMINDER_LOG');
  return rows.some(function(r){ return r.JobKey === jobKey && r.Result === 'OK'; });
}

function recordJob_(monthKey, type, result, notes, executedBy) {
  appendRow_('REMINDER_LOG', {
    JobKey: monthKey + '-' + type, Type: type, Month: monthKey,
    ExecutedAt: nowIso_(), ExecutedBy: executedBy || 'auto',
    Result: result, Notes: notes || ''
  });
}

/** Sends the reminder email(s), grouped by Location Head. */
function runReminder_(type, executedBy) {
  var monthKey = Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM');
  var jobKey = monthKey + '-' + type;
  if (jobDone_(monthKey, type)) return { skipped: true };
  var clients = readTable_('CLIENTS').filter(function(c){ return c.Status !== 'INACTIVE'; });
  var matrix = readTable_('ESCALATION_MATRIX');
  // Group by LH email.
  var groups = {};
  clients.forEach(function(c) {
    var m = matrix.filter(function(x){ return x.ClientID === c.ClientID; });
    var v = validateClientMatrix_(c, m);
    var lh = String(c.DefaultLocationHead || '').toLowerCase();
    if (!lh) lh = 'unassigned';
    if (!groups[lh]) groups[lh] = [];
    groups[lh].push(Object.assign({}, c, { _status: v.complete ? 'Complete' : ('Missing: ' + v.missing.join(', ')) }));
  });
  var tpl = getTemplate_('REMINDER');
  var sent = 0, failed = 0;
  var defaultCc = parseListStr_(getSetting_('DEFAULT_CC',''));
  var mgr = getSetting_('ESCALATION_MANAGER','');
  Object.keys(groups).forEach(function(lh) {
    if (lh === 'unassigned' || !isEmail_(lh)) return; // don't email unassigned bucket
    var user = readTable_('USERS').filter(function(u){ return String(u.Email).toLowerCase() === lh; })[0] || { Name: lh.split('@')[0] };
    var vars = {
      LOCATION_HEAD_NAME: user.Name || lh,
      MONTH: Utilities.formatDate(new Date(), getTz_(), 'MMMM'),
      YEAR: Utilities.formatDate(new Date(), getTz_(), 'yyyy'),
      NEXT_MONTH: Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth()+1, 1), getTz_(), 'MMMM'),
      CLIENT_TABLE: clientListToHtml_(groups[lh]),
      APP_URL: ScriptApp.getService().getUrl() || '',
      SIGNATURE: getSetting_('SIGNATURE','')
    };
    var subj = renderTemplate_(tpl.Subject, vars);
    var body = renderTemplate_(tpl.Body, vars);
    try {
      var res = sendEmail_({
        type: type, to: [lh], cc: defaultCc.concat(mgr && isEmail_(mgr) ? [mgr] : []),
        subject: subj, htmlBody: body, trigger: 'scheduler.' + type,
        idempotencyKey: jobKey + '-' + lh
      });
      if (res.status === 'SENT' || res.skipped) sent++; else failed++;
    } catch (err) {
      failed++;
      appendRow_('EMAIL_LOG', {
        LogID: nextId_('EML'), Timestamp: nowIso_(), Type: type,
        ClientID: '', BranchID: '', ToAddr: lh, CcAddr: '', Subject: subj,
        Trigger: 'scheduler.' + type, SentBy: 'scheduler',
        Status: 'FAILED', Attempt: 1, Error: String(err && err.message || err),
        MessageRef: '', IdempotencyKey: jobKey + '-' + lh
      });
    }
  });
  recordJob_(monthKey, type, failed === 0 ? 'OK' : 'PARTIAL', 'sent=' + sent + ' failed=' + failed, executedBy);
  return { type: type, sent: sent, failed: failed };
}

/** Runs the 1st-of-month validation + dispatch. */
function runDispatch_(executedBy) {
  var now = new Date();
  var monthKey = Utilities.formatDate(now, getTz_(), 'yyyy-MM');
  if (jobDone_(monthKey, JOB_TYPES.DIS)) return { skipped: true };
  var clients = readTable_('CLIENTS').filter(function(c){ return c.Status !== 'INACTIVE'; });
  var matrix = readTable_('ESCALATION_MATRIX');
  var tplD = getTemplate_('DISPATCH');
  var tplI = getTemplate_('INCOMPLETE');
  var defaultCc = parseListStr_(getSetting_('DEFAULT_CC',''));
  var mgr = getSetting_('ESCALATION_MANAGER','');
  var totalOk = 0, totalIncomplete = 0, failed = 0;
  clients.forEach(function(c) {
    var m = matrix.filter(function(x){ return x.ClientID === c.ClientID; });
    var v = validateClientMatrix_(c, m);
    var vars = {
      CLIENT_NAME: c.ClientName,
      MONTH: Utilities.formatDate(now, getTz_(), 'MMMM'),
      YEAR: Utilities.formatDate(now, getTz_(), 'yyyy'),
      MATRIX_TABLE: matrixToHtml_(c, m),
      MISSING_LIST: missingToHtml_(v.missing),
      LOCATION_HEAD_NAME: (readTable_('USERS').filter(function(u){return String(u.Email).toLowerCase() === String(c.DefaultLocationHead).toLowerCase();})[0] || {}).Name || c.DefaultLocationHead || '',
      SIGNATURE: getSetting_('SIGNATURE','')
    };
    if (!v.complete) {
      totalIncomplete++;
      // Internal escalation only. NEVER email client.
      var lh = c.DefaultLocationHead;
      if (!isEmail_(lh)) { failed++; return; }
      try {
        var res = sendEmail_({
          type: 'INCOMPLETE_ESCALATION', clientId: c.ClientID,
          to: [lh], cc: defaultCc.concat(mgr && isEmail_(mgr) ? [mgr] : []),
          subject: renderTemplate_(tplI.Subject, vars),
          htmlBody: renderTemplate_(tplI.Body, vars),
          trigger: 'scheduler.dispatch.incomplete',
          idempotencyKey: monthKey + '-INCOMPLETE-' + c.ClientID
        });
        if (res.status !== 'SENT' && !res.skipped) failed++;
      } catch (err) { failed++; }
      return;
    }
    totalOk++;
    // Build CC from matrix + client CC + default CC.
    var matrixEmails = m.map(function(r){ return r.Email; }).filter(isEmail_);
    var clientCcList = parseListStr_(c.ClientCC).filter(isEmail_);
    var cc = dedupeEmails_(matrixEmails.concat(clientCcList).concat(defaultCc), [c.ClientEmail]);
    try {
      var res2 = sendEmail_({
        type: 'MONTHLY_DISPATCH', clientId: c.ClientID,
        to: [c.ClientEmail], cc: cc,
        subject: renderTemplate_(tplD.Subject, vars),
        htmlBody: renderTemplate_(tplD.Body, vars),
        trigger: 'scheduler.dispatch',
        idempotencyKey: monthKey + '-DISPATCH-' + c.ClientID
      });
      if (res2.status !== 'SENT' && !res2.skipped) failed++;
    } catch (err) { failed++; }
  });
  recordJob_(monthKey, JOB_TYPES.DIS, failed === 0 ? 'OK' : 'PARTIAL',
    'ok=' + totalOk + ' incomplete=' + totalIncomplete + ' failed=' + failed, executedBy);
  return { ok: totalOk, incomplete: totalIncomplete, failed: failed };
}

/** Admin "Run Now" wrapper (bypasses schedule but respects idempotency unless force=true). */
function runJob_(type, payload, me) {
  var monthKey = Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM');
  if (payload && payload.force) {
    // Clear this month's log entry so it can rerun; still uses per-recipient idempotency keys.
    var sh = sh_('REMINDER_LOG');
    var last = sh.getLastRow();
    if (last > 1) {
      var rows = sh.getRange(2, 1, last-1, SCHEMA.REMINDER_LOG.length).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === monthKey + '-' + type) sh.deleteRow(i + 2);
      }
    }
  }
  if (type === JOB_TYPES.DIS) return runDispatch_(me.email);
  return runReminder_(type, me.email);
}

function automationStatus_() {
  var tz = getTz_();
  var now = new Date();
  var remDay = parseInt(getSetting_('REMINDER_DAY_1','25'), 10);
  var remTime = getSetting_('REMINDER_TIME','12:00');
  var disDay = parseInt(getSetting_('MONTHLY_DISPATCH_DAY','1'), 10);
  var disTime = getSetting_('MONTHLY_DISPATCH_TIME','10:00');
  function next(day, timeHHmm, useLWD) {
    var d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (var i = 0; i < 3; i++) {
      var target = useLWD ? lastWorkingDay_(d.getFullYear(), d.getMonth()) : new Date(d.getFullYear(), d.getMonth(), day);
      target.setHours(parseInt(timeHHmm.split(':')[0], 10), parseInt(timeHHmm.split(':')[1], 10), 0, 0);
      if (target > now) return Utilities.formatDate(target, tz, 'yyyy-MM-dd HH:mm');
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return '';
  }
  var logs = readTable_('REMINDER_LOG');
  var lastOk = logs.filter(function(r){ return r.Result === 'OK'; }).slice(-1)[0];
  var lastFail = logs.filter(function(r){ return r.Result !== 'OK'; }).slice(-1)[0];
  return {
    tickInstalled: ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'tick'; }),
    nextReminder25: next(remDay, remTime, false),
    nextReminderLWD: next(null, remTime, true),
    nextMonthlyDispatch: next(disDay, disTime, false),
    lastSuccess: lastOk ? (lastOk.Type + ' @ ' + lastOk.ExecutedAt) : '',
    lastFailure: lastFail ? (lastFail.Type + ' @ ' + lastFail.ExecutedAt + ' — ' + lastFail.Notes) : ''
  };
}

function nextScheduledJobs_() {
  try { return automationStatus_(); } catch (e) { return {}; }
}

function installTriggers_() {
  // Remove any existing tick triggers first.
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  return { ok: true };
}
