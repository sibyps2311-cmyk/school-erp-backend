const env = require('../config/env');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Today's date (YYYY-MM-DD) in the school's configured timezone.
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { DATE_RE, isRealDate, todayStr, addDays };
