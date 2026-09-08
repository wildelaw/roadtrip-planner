// Date helpers: expand a date range into day entries, formatting, parsing.

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(date) {
  if (!(date instanceof Date)) return null;
  return date.toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Expand [start, end] inclusive into [{id, date}] entries.
export function expandDays(startDate, endDate) {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!start || !end || end < start) return [];
  const days = [];
  let cur = start;
  let i = 0;
  while (cur <= end) {
    days.push({ id: `day-${i}-${toISO(cur)}`, date: toISO(cur), items: [] });
    cur = addDays(cur, 1);
    i++;
  }
  return days;
}

export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d) return iso || '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtDateLong(iso) {
  const d = parseISO(iso);
  if (!d) return iso || '';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function dayCount(startDate, endDate) {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!start || !end || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

// Whole days from start to end (exclusive of end). e.g. checkIn→checkOut = nights.
export function daysBetween(startDate, endDate) {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}