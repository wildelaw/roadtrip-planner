// Data layer: trip CRUD, itinerary, budget, and all trip-data.json collections.
// Persistence is IndexedDB (db.js). UI state (current trip, active tab, search) is in-memory.

import { uid } from './utils/id.js';
import { expandDays, dayCount } from './utils/dates.js';
import { mapImportToTrip, buildExportObject, normalizeTrip, rollupBudget, parseCost } from './io.js';
import * as db from './db.js';

// ---- In-memory UI state ----
const state = {
  trips: [],
  currentTripId: null,
  tab: 'itinerary',
  search: '',
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn()); }

export function getState() { return state; }
export function setState(patch) { Object.assign(state, patch); }

// ---- Bootstrap ----
export async function initStore() {
  state.trips = (await db.getAll('trips')).map(normalizeTrip);
  state.trips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (state.trips.length && !state.currentTripId) state.currentTripId = state.trips[0].id;
  return state;
}

export function getTrip(id) {
  return state.trips.find((t) => t.id === id) || null;
}

export async function refreshTrips() {
  state.trips = (await db.getAll('trips')).map(normalizeTrip);
  state.trips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return state.trips;
}

// ---- Core mutation helper ----
async function mutate(tripId, fn) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  fn(trip);
  trip.updatedAt = Date.now();
  await db.put('trips', trip);
  emit();
  return trip;
}
async function persist(trip) { trip.updatedAt = Date.now(); await db.put('trips', trip); emit(); }

// ---- Trip CRUD ----
export function newTripObject({ title, subtitle, vehicle, destinations, startDate, endDate, travelers, currency }) {
  const start = startDate || null;
  const end = endDate || null;
  const trip = {
    id: uid(),
    title: title || 'Untitled trip',
    subtitle: subtitle || '',
    vehicle: vehicle || null,
    destinations: destinations || [],
    startDate: start, endDate: end,
    travelers: travelers || [{ name: '', type: 'adult' }],
    currency: currency || 'USD',
    budget: { total: 0, categories: [] },
    budgetEstimates: [],
    expenses: [],
    days: expandDays(start, end),
    checklists: [],
    keyTips: [],
  };
  for (const k of COLLECTION_KEYS) trip[k] = [];
  return normalizeTrip(trip);
}

const COLLECTION_KEYS = [
  'lodging', 'reservations', 'noReservationNeeded', 'preTripActions',
  'bucketList', 'chargingNetworks', 'minSocThresholds', 'locations',
  'contacts', 'criticalAlerts',
];

export async function createTrip(input) {
  const trip = newTripObject(input);
  await db.put('trips', trip);
  state.trips.push(trip);
  state.trips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.currentTripId = trip.id;
  emit();
  return trip;
}

export async function updateTrip(id, patch) {
  const trip = getTrip(id);
  if (!trip) return null;
  const next = { ...trip, ...patch, updatedAt: Date.now() };
  await db.put('trips', next);
  const idx = state.trips.findIndex((t) => t.id === id);
  state.trips[idx] = next;
  emit();
  return next;
}

// Trip-level metadata (subtitle, vehicle, title, currency, etc.)
export function updateTripMeta(id, patch) { return updateTrip(id, patch); }

// Re-expand days when dates change, preserving items AND per-day meta on days that still exist.
export async function updateTripDates(id, startDate, endDate) {
  const trip = getTrip(id);
  if (!trip) return null;
  const existing = new Map((trip.days || []).map((d) => [d.date, d]));
  const days = expandDays(startDate, endDate).map((d) => {
    const old = existing.get(d.date);
    return old ? { ...d, ...old, items: old.items || [] } : d;
  });
  return updateTrip(id, { startDate, endDate, days });
}

export async function deleteTrip(id) {
  await db.del('trips', id);
  state.trips = state.trips.filter((t) => t.id !== id);
  const convos = await db.getAll('ai_conversations');
  await Promise.all(convos.filter((c) => c.tripId === id).map((c) => db.del('ai_conversations', c.id)));
  if (state.currentTripId === id) state.currentTripId = state.trips[0]?.id || null;
  emit();
}

export async function selectTrip(id) { state.currentTripId = id; emit(); }

// ---- Generic collection CRUD (array-of-objects sections keyed by id) ----
export function collectionAdd(tripId, key, item) {
  return mutate(tripId, (t) => { (t[key] ||= []).push({ id: uid(), ...item }); });
}
export function collectionUpdate(tripId, key, id, patch) {
  return mutate(tripId, (t) => {
    const it = (t[key] || []).find((x) => x.id === id);
    if (it) Object.assign(it, patch);
  });
}
export function collectionDelete(tripId, key, id) {
  return mutate(tripId, (t) => { t[key] = (t[key] || []).filter((x) => x.id !== id); });
}
export function collectionSet(tripId, key, arr) {
  return mutate(tripId, (t) => { t[key] = arr; });
}

// keyTips is a string[] (no ids): add by text, delete by index.
export function addKeyTip(tripId, text) {
  return mutate(tripId, (t) => { (t.keyTips ||= []).push(text); });
}
export function deleteKeyTip(tripId, index) {
  return mutate(tripId, (t) => { t.keyTips = (t.keyTips || []).filter((_, i) => i !== index); });
}

// ---- Itinerary items ----
export async function addItineraryItem(tripId, { date, dayIndex, type, title, time, location, cost, currency, durationMin, confirmation, notes }) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const day = resolveDay(trip, { date, dayIndex });
  if (!day) return { error: 'No matching day in the trip date range.' };
  const item = { id: uid(), type: type || 'activity', title: title || 'Untitled', time, location, cost, currency, durationMin, confirmation, notes };
  day.items.push(item);
  await persist(trip);
  return { id: item.id, day: day.date };
}

export async function setDayPlan(tripId, { date, dayIndex, items }) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  const day = resolveDay(trip, { date, dayIndex });
  if (!day) return { error: 'No matching day in the trip date range.' };
  day.items = (items || []).map((it) => ({ id: uid(), type: it.type || 'activity', title: it.title || 'Untitled', time: it.time, timeRaw: it.timeRaw, location: it.location, cost: it.cost, currency: it.currency, durationMin: it.durationMin, confirmation: it.confirmation, notes: it.notes, flags: it.flags || {} }));
  await persist(trip);
  return { date: day.date, count: day.items.length };
}

export async function updateItineraryItem(tripId, dayId, itemId, patch) {
  return mutate(tripId, (t) => {
    const day = (t.days || []).find((d) => d.id === dayId);
    const item = day && day.items.find((i) => i.id === itemId);
    if (item) Object.assign(item, patch);
  });
}

export async function deleteItineraryItem(tripId, dayId, itemId) {
  return mutate(tripId, (t) => {
    const day = (t.days || []).find((d) => d.id === dayId);
    if (day) day.items = day.items.filter((i) => i.id !== itemId);
  });
}

// Day-level meta (title, stay, drive, summary, dining[], tips[], chargeStops, nacs).
export async function setDayMeta(tripId, dayId, patch) {
  return mutate(tripId, (t) => {
    const day = (t.days || []).find((d) => d.id === dayId);
    if (day) Object.assign(day, patch);
  });
}

// Bridge: add a location activity or dining entry to a specific day as an itinerary item.
export async function addActivityToDay(tripId, { date, title, type, location, notes, time }) {
  return addItineraryItem(tripId, { date, type: type || 'activity', title, location, notes, time });
}

function resolveDay(trip, { date, dayIndex }) {
  if (date) return (trip.days || []).find((d) => d.date === date) || null;
  if (dayIndex != null) return trip.days[dayIndex] || null;
  return null;
}

// ---- Checklists (typed: [{id, category, items:[{id,text,done}]}]) ----
export function addChecklistCategory(tripId, category) {
  return mutate(tripId, (t) => { (t.checklists ||= []).push({ id: uid(), category: category || 'New list', items: [] }); });
}
export function renameChecklistCategory(tripId, catId, category) {
  return mutate(tripId, (t) => { const c = (t.checklists || []).find((x) => x.id === catId); if (c) c.category = category; });
}
export function deleteChecklistCategory(tripId, catId) {
  return mutate(tripId, (t) => { t.checklists = (t.checklists || []).filter((c) => c.id !== catId); });
}
export function addChecklistItem(tripId, catId, text) {
  return mutate(tripId, (t) => {
    const c = (t.checklists || []).find((x) => x.id === catId);
    if (c) (c.items ||= []).push({ id: uid(), text: text || '', done: false });
  });
}
export function toggleChecklistItem(tripId, catId, itemId) {
  return mutate(tripId, (t) => {
    const c = (t.checklists || []).find((x) => x.id === catId);
    const it = c && (c.items || []).find((i) => i.id === itemId);
    if (it) it.done = !it.done;
  });
}
export function updateChecklistItem(tripId, catId, itemId, text) {
  return mutate(tripId, (t) => {
    const c = (t.checklists || []).find((x) => x.id === catId);
    const it = c && (c.items || []).find((i) => i.id === itemId);
    if (it) it.text = text;
  });
}
export function deleteChecklistItem(tripId, catId, itemId) {
  return mutate(tripId, (t) => {
    const c = (t.checklists || []).find((x) => x.id === catId);
    if (c) c.items = (c.items || []).filter((i) => i.id !== itemId);
  });
}

// ---- Budget estimates (source of truth) ----
export function addBudgetEstimate(tripId, e) {
  return mutate(tripId, (t) => {
    (t.budgetEstimates ||= []).push({ id: uid(), category: e.category || 'General', item: e.item || '', cost: e.cost ?? '', optional: !!e.optional });
    t.budget = rollupBudget(t.budgetEstimates);
  });
}
export function updateBudgetEstimate(tripId, id, patch) {
  return mutate(tripId, (t) => {
    const it = (t.budgetEstimates || []).find((x) => x.id === id);
    if (it) Object.assign(it, patch);
    t.budget = rollupBudget(t.budgetEstimates);
  });
}
export function deleteBudgetEstimate(tripId, id) {
  return mutate(tripId, (t) => {
    t.budgetEstimates = (t.budgetEstimates || []).filter((x) => x.id !== id);
    t.budget = rollupBudget(t.budgetEstimates);
  });
}

// ---- Expenses (actual spend) ----
export async function addExpense(tripId, { date, category, amount, label, dayId }) {
  const trip = getTrip(tripId);
  if (!trip) return null;
  trip.expenses.push({ id: uid(), date, category: category || 'General', amount: Number(amount) || 0, label: label || '', dayId });
  await persist(trip);
  return trip.expenses[trip.expenses.length - 1];
}
export async function deleteExpense(tripId, expenseId) {
  return mutate(tripId, (t) => { t.expenses = (t.expenses || []).filter((e) => e.id !== expenseId); });
}
export async function setBudget(tripId, { total, categories }) {
  return mutate(tripId, (t) => {
    t.budget = { total: total != null ? Number(total) || 0 : (t.budget?.total || 0), categories: categories || (t.budget?.categories || []) };
  });
}

// ---- AI conversations ----
export async function saveConversation(conv) {
  const rec = { id: conv.id || uid(), tripId: conv.tripId, messages: conv.messages, updatedAt: Date.now() };
  await db.put('ai_conversations', rec);
  return rec;
}
export async function loadConversations(tripId) {
  const all = await db.getAll('ai_conversations');
  return all.filter((c) => c.tripId === tripId).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
}

// ---- Import / Export ----
export async function importTripData(obj) {
  const trip = mapImportToTrip(obj);
  await db.put('trips', trip);
  state.trips.push(trip);
  state.trips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.currentTripId = trip.id;
  emit();
  return trip;
}
export function buildTripExport(tripId) {
  const trip = getTrip(tripId);
  return trip ? buildExportObject(trip) : null;
}
export async function exportAllTrips() {
  const all = await db.getAll('trips');
  return all.map((t) => buildExportObject(t));
}

// ---- Danger zone ----
export async function wipeAll() {
  await db.clearStore('trips');
  await db.clearStore('ai_conversations');
  state.trips = [];
  state.currentTripId = null;
  emit();
}

export { dayCount, parseCost, rollupBudget };