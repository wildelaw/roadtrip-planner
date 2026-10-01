// Date helpers. Pure. Day ids are derived from their date so that re-expanding a trip's
// date range preserves items by date (03-data-model.md §3).

TP.dates = (function () {
  'use strict';

  function todayISO() {
    var d = new Date();
    return toISO(d);
  }

  function toISO(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // Parsed as a local calendar date, never as UTC: an itinerary day is a calendar day.
  function parseISO(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }

  function daysBetween(aISO, bISO) {
    var a = parseISO(aISO), b = parseISO(bISO);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  function dayCount(startISO, endISO) {
    if (!startISO || !endISO) return 0;
    var n = daysBetween(startISO, endISO) + 1;
    return n > 0 ? n : 0;
  }

  // Expand [start, end] into Day entities. The id encodes the index and the date, so it is
  // stable across a re-expansion as long as the date is preserved.
  function expandDays(startISO, endISO, maxDays) {
    var out = [];
    var start = parseISO(startISO);
    var end = parseISO(endISO);
    if (!start || !end) return out;
    var n = daysBetween(startISO, endISO) + 1;
    var cap = typeof maxDays === 'number' ? maxDays : 400;
    if (n > cap) n = cap;
    for (var i = 0; i < n; i++) {
      var date = toISO(addDays(start, i));
      out.push({ id: 'day-' + i + '-' + date, date: date, items: [] });
    }
    return out;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fmtDate(iso) {
    var d = parseISO(iso);
    if (!d) return iso || '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function fmtDateLong(iso) {
    var d = parseISO(iso);
    if (!d) return iso || '';
    return WEEKDAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  return {
    todayISO: todayISO,
    toISO: toISO,
    parseISO: parseISO,
    addDays: addDays,
    daysBetween: daysBetween,
    dayCount: dayCount,
    expandDays: expandDays,
    fmtDate: fmtDate,
    fmtDateLong: fmtDateLong,
  };
})();
