/**
 * Utils.gs — small helpers (id, date, holiday, hash, validators, pagination).
 */

function AuthError_(msg) {
  var e = new Error(msg);
  e.isFriendly = true;
  return e;
}
function ValidationError_(msg) { return AuthError_(msg); } // friendly at the user

function nowIso_() {
  return Utilities.formatDate(new Date(), getTz_(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}
function today_() {
  var tz = getTz_();
  return new Date(Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd'));
}
function getTz_() {
  try { return getSetting_('APP_TIMEZONE', 'Asia/Kolkata'); } catch (e) { return 'Asia/Kolkata'; }
}

var ID_LOCK = 'CRUX_ID_LOCK';
function nextId_(prefix) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(2000);
  try {
    var key = 'SEQ_' + prefix;
    var n = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(n));
    return prefix + '-' + pad_(n, 5);
  } finally {
    lock.releaseLock();
  }
}
function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

var EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var PHONE_RX = /^[0-9+\-\s()]{7,}$/;

function isEmail_(v) { return !!v && EMAIL_RX.test(String(v).trim()); }
function isPhone_(v) { return !!v && PHONE_RX.test(String(v).trim()); }
function req_(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

/** Dedupe list of emails, lowercasing & trimming; removes blanks & values in `exclude`. */
function dedupeEmails_(list, exclude) {
  var seen = {};
  var excl = {};
  (exclude || []).forEach(function(e){ if (e) excl[String(e).toLowerCase().trim()] = 1; });
  var out = [];
  (list || []).forEach(function(e) {
    if (!e) return;
    var k = String(e).toLowerCase().trim();
    if (!k || excl[k] || seen[k]) return;
    if (!EMAIL_RX.test(k)) return;
    seen[k] = 1;
    out.push(String(e).trim());
  });
  return out;
}

function parseListStr_(s) {
  if (!s) return [];
  return String(s).split(/[,;]+/).map(function(x){ return x.trim(); }).filter(Boolean);
}

/** Last working day of the given (yyyy, month0) in configured TZ, skipping Sat/Sun/holidays. */
function lastWorkingDay_(year, month0) {
  var holidays = listHolidays_().filter(function(h){ return h.Status !== 'INACTIVE'; }).reduce(function(acc, h){
    var d = new Date(h.Date);
    if (!isNaN(d)) acc[Utilities.formatDate(d, getTz_(), 'yyyy-MM-dd')] = true;
    return acc;
  }, {});
  var d = new Date(year, month0 + 1, 0); // last day of month
  while (true) {
    var day = d.getDay();
    var key = Utilities.formatDate(d, getTz_(), 'yyyy-MM-dd');
    if (day !== 0 && day !== 6 && !holidays[key]) return d;
    d.setDate(d.getDate() - 1);
  }
}

function monthKey_(d) { return Utilities.formatDate(d, getTz_(), 'yyyy-MM'); }
function ymd_(d) { return Utilities.formatDate(d, getTz_(), 'yyyy-MM-dd'); }

function applyFilters_(rows, filters) {
  if (!filters) return rows;
  return rows.filter(function(r) {
    return Object.keys(filters).every(function(k) {
      var f = filters[k];
      if (f === '' || f === null || f === undefined) return true;
      return String(r[k] || '').toLowerCase().indexOf(String(f).toLowerCase()) !== -1;
    });
  });
}

function paginate_(rows, p) {
  var page = (p && p.page) || 1;
  var size = (p && p.size) || 50;
  var sortBy = p && p.sortBy;
  var sortDir = (p && p.sortDir) === 'asc' ? 1 : -1;
  if (sortBy) rows = rows.slice().sort(function(a, b){
    var x = a[sortBy], y = b[sortBy];
    return x < y ? -sortDir : (x > y ? sortDir : 0);
  });
  var start = (page - 1) * size;
  return { total: rows.length, page: page, size: size, rows: rows.slice(start, start + size) };
}

function safePayload_(p) {
  try { return JSON.parse(JSON.stringify(p)).toString().slice(0, 2000); } catch (e) { return ''; }
}

function renderTemplate_(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function(_, k) {
    return vars[k] === undefined || vars[k] === null ? '' : String(vars[k]);
  });
}
