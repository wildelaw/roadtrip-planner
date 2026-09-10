// Import/export for the trip-data.json format + trip normalization.
//
// Model notes:
//  - Collections that need per-item CRUD get an `id` assigned (preserving any original id).
//  - checklists are stored as a TYPED array [{id, category, items:[{id,text,done}]}] for editing,
//    and converted back to the on-disk {category: string[]} shape on export.
//  - preTripActions / reservations carry a UI-only `done` flag (stripped on export).
//
// Export builds every section from the trip's NATIVE fields (so edits are reflected), with
// importedRaw only as a fallback snapshot. Round-trip is lossless for unedited imports.

import { uid } from './utils/id.js';
import { expandDays } from './utils/dates.js';

const COLLECTION_KEYS = [
  'lodging', 'reservations', 'noReservationNeeded', 'preTripActions',
  'bucketList', 'chargingNetworks', 'minSocThresholds', 'locations',
  'contacts', 'criticalAlerts', 'budgetEstimates',
];

// ---- Import ----
export function mapImportToTrip(obj) {
  const t = obj.trip || {};
  const start = t.startDate || null;
  const end = t.endDate || null;

  const days = expandDays(start, end);
  const importedDays = Array.isArray(obj.days) ? obj.days : [];
  importedDays.forEach((d, i) => {
    if (!days[i]) return;
    Object.assign(days[i], {
      title: d.title, stay: d.stay, drive: d.drive, chargeStops: d.chargeStops,
      nacs: d.nacs, summary: d.summary,
      dining: Array.isArray(d.dining) ? [...d.dining] : [],
      tips: Array.isArray(d.tips) ? [...d.tips] : [],
      _src: clone(d),
    });
    days[i].items = (d.items || []).map((it) => ({
      id: uid(),
      type: inferType(it),
      title: it.activity || 'Untitled',
      time: parseTimeToHHMM(it.time),
      timeRaw: it.time || undefined,
      location: undefined,
      cost: parseCost(it.cost),
      notes: it.desc || '',
      _src: clone(it),
      flags: {
        charge: !!it.charge, overnight: !!it.overnight, tour: !!it.tour,
        warn: !!it.warn, minSoc: it.minSoc || undefined, minSocCritical: !!it.minSocCritical,
      },
    }));
  });

  const estimates = (obj.budgetEstimates || []).map((e) => ({ id: uid(), ...clone(e) }));
  const budget = rollupBudget(estimates);

  const expenses = (obj.expenses || []).map((e) => ({ id: uid(), ...clone(e) }));

  const destinations = (Array.isArray(t.destinations) && t.destinations.length
    ? t.destinations.map((d) => (typeof d === 'string' ? { name: d } : { name: d.name }))
    : (obj.locations || []).map((l) => l.name).filter(Boolean).map((name) => ({ name })));

  const travelers = (Array.isArray(t.travelers) && t.travelers.length
    ? t.travelers.map((x) => (typeof x === 'string' ? { name: x, type: 'adult' } : { name: x.name || '', type: x.type || 'adult' }))
    : [{ name: '', type: 'adult' }]);

  const trip = {
    id: uid(),
    title: t.title || 'Imported trip',
    subtitle: t.subtitle || '',
    vehicle: t.vehicle ? clone(t.vehicle) : null,
    destinations: destinations.length ? destinations : (start ? [{ name: '' }] : []),
    startDate: start, endDate: end,
    travelers,
    currency: t.currency || 'USD',
    budget,
    expenses,
    days,
    budgetEstimates: estimates,
    checklists: checklistsToTyped(obj.checklists),
    importedRaw: clone(obj),
    source: { format: 'trip-data.json', version: 1, importedAt: Date.now() },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  // collections (id-normalized, done flags added where relevant)
  for (const k of COLLECTION_KEYS) {
    trip[k] = (obj[k] || []).map((it) => {
      const copy = clone(it);
      if (!copy.id) copy.id = uid();
      if (k === 'preTripActions' || k === 'reservations') copy.done = !!copy.done;
      return copy;
    });
  }
  trip.keyTips = Array.isArray(obj.keyTips) ? [...obj.keyTips] : [];
  return normalizeTrip(trip);
}

// ---- Export ----
export function buildExportObject(trip) {
  const n = normalizeTrip(trip);
  const out = {};
  out.trip = {
    title: n.title,
    startDate: n.startDate,
    endDate: n.endDate,
  };
  if (n.subtitle) out.trip.subtitle = n.subtitle;
  if (n.vehicle) out.trip.vehicle = clone(n.vehicle);
  if (n.currency && n.currency !== 'USD') out.trip.currency = n.currency;
  // Only emit destinations when the trip wasn't imported, or the source file itself had
  // trip.destinations — for legacy files destinations are derived from locations[].
  const rawTrip = n.importedRaw && n.importedRaw.trip ? n.importedRaw.trip : null;
  if ((!n.importedRaw || Array.isArray(rawTrip.destinations)) && Array.isArray(n.destinations) && n.destinations.some((d) => d.name)) {
    out.trip.destinations = n.destinations.map((d) => d.name).filter(Boolean);
  }
  if (Array.isArray(n.travelers) && n.travelers.some((t) => t.name)) {
    out.trip.travelers = n.travelers
      .filter((t) => t.name)
      .map((t) => (t.type && t.type !== 'adult' ? { name: t.name, type: t.type } : { name: t.name }));
  }

  for (const k of COLLECTION_KEYS) {
    // If the original import had no ids on this collection, strip our synthetic ids
    // so the export stays lossless with the source file.
    const rawColl = n.importedRaw && Array.isArray(n.importedRaw[k]) ? n.importedRaw[k] : null;
    const rawHadIds = rawColl && rawColl.some((it) => it && it.id != null);
    out[k] = (n[k] || []).map((it) => {
      const copy = clone(it);
      delete copy.done; // UI-only
      if (!rawHadIds && copy.id != null) delete copy.id;
      return copy;
    });
  }
  out.keyTips = [...(n.keyTips || [])];
  out.checklists = checklistsToRaw(n.checklists);
  out.budgetEstimates = (n.budgetEstimates || []).map((e) => {
    const { category, item, cost, optional } = e;
    const o = { category, item, cost };
    if (optional) o.optional = optional;
    return o;
  });
  out.expenses = (n.expenses || []).map((e) => ({
    date: e.date,
    category: e.category || 'General',
    amount: Number(e.amount) || 0,
    label: e.label || '',
    ...(e.dayId != null ? { dayId: e.dayId } : {}),
  }));

  // days: overlay native edits onto the imported day structure (preserve rich fields)
  const srcDays = (n.importedRaw && Array.isArray(n.importedRaw.days)) ? n.importedRaw.days : [];
  out.days = (n.days || []).map((d, i) => {
    const src = srcDays[i] || d._src || {};
    const items = (d.items || []).map((it, j) => {
      const isrc = it._src || (src.items && src.items[j]) || {};
      const o = { ...clone(isrc) };
      o.time = it.timeRaw || it.time || isrc.time;
      o.activity = it.title;
      if (it.notes != null) o.desc = it.notes;
      if (it.cost != null && it.cost !== isrc.cost) o.cost = it.cost;
      else if (it.cost == null && isrc.cost != null) delete o.cost; // cleared in-app
      if (it.location) o.location = it.location;
      else if (!it.location && isrc.location != null) delete o.location;
      if (it.durationMin != null) o.durationMin = it.durationMin;
      else if (it.durationMin == null && isrc.durationMin != null) delete o.durationMin;
      if (it.confirmation) o.confirmation = it.confirmation;
      else if (!it.confirmation && isrc.confirmation != null) delete o.confirmation;
      return o;
    });
    return {
      ...clone(src),
      id: src.id != null ? src.id : i + 1,
      date: src.date || d.date,
      title: d.title || src.title,
      stay: d.stay != null ? d.stay : src.stay,
      drive: d.drive != null ? d.drive : src.drive,
      chargeStops: d.chargeStops != null ? d.chargeStops : src.chargeStops,
      nacs: d.nacs != null ? d.nacs : src.nacs,
      summary: d.summary != null ? d.summary : src.summary,
      dining: (d.dining && d.dining.length) ? d.dining : (src.dining || []),
      tips: (d.tips && d.tips.length) ? d.tips : (src.tips || []),
      items,
    };
  });

  return out;
}

// ---- Normalization (legacy/missing fields -> canonical shape) ----
export function normalizeTrip(trip) {
  if (!trip) return trip;
  // checklists: legacy {category:string[]} -> typed array
  if (!trip.checklists) trip.checklists = [];
  else if (!Array.isArray(trip.checklists)) trip.checklists = checklistsToTyped(trip.checklists);
  else trip.checklists = trip.checklists.map((c) => ({
    id: c.id || uid(), category: c.category || 'General',
    items: (c.items || []).map((i) => (typeof i === 'string' ? { id: uid(), text: i, done: false } : { id: i.id || uid(), text: i.text || '', done: !!i.done })),
  }));
  for (const k of COLLECTION_KEYS) {
    if (!Array.isArray(trip[k])) trip[k] = [];
    else trip[k] = trip[k].map((it) => (it.id ? it : { ...it, id: uid() }));
  }
  if (!Array.isArray(trip.keyTips)) trip.keyTips = [];
  if (!Array.isArray(trip.days)) trip.days = [];
  if (!trip.budgetEstimates) trip.budgetEstimates = [];
  if (!Array.isArray(trip.expenses)) trip.expenses = [];
  if (!trip.budget) trip.budget = rollupBudget(trip.budgetEstimates);
  return trip;
}

// ---- Budget rollup from estimates ----
export function rollupBudget(estimates) {
  const byCat = new Map();
  for (const e of estimates || []) {
    const n = parseCost(e.cost);
    if (n != null) byCat.set(e.category, (byCat.get(e.category) || 0) + n);
  }
  const categories = [...byCat].map(([name, amount]) => ({ name, amount }));
  return { total: categories.reduce((s, c) => s + c.amount, 0), categories };
}

// ---- Checklist conversions ----
function checklistsToTyped(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw; // already typed
  return Object.entries(raw).map(([category, items]) => ({
    id: uid(), category,
    items: (items || []).map((text) => ({ id: uid(), text, done: false })),
  }));
}

function checklistsToRaw(typed) {
  const out = {};
  for (const cat of typed || []) out[cat.category] = (cat.items || []).map((i) => i.text).filter(Boolean);
  return out;
}

// ---- File helpers ----
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error('File is not valid JSON: ' + e.message)); }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

export function parseCost(s) {
  if (s == null) return undefined;
  if (typeof s === 'number') return Number.isFinite(s) ? s : undefined;
  const m = String(s).match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// ---- helpers ----
function inferType(it) {
  if (it.overnight) return 'lodging';
  if (it.charge) return 'transport';
  return 'activity';
}

function parseTimeToHHMM(raw) {
  if (!raw) return undefined;
  const m = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return undefined;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + min;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }