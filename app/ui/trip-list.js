// Left sidebar: trip list, new-trip modal, edit-trip modal, search filter.

import { getState, setState, createTrip, selectTrip, deleteTrip, getTrip, updateTrip, updateTripDates } from '../store.js';
import { fmtDate } from '../utils/dates.js';
import { openModal, closeModal, field } from './modal.js';
import { switchTab, renderActive } from './shell.js';

export function renderTripList() {
  const el = document.getElementById('trip-list');
  const { trips, currentTripId, search } = getState();
  const q = (search || '').trim().toLowerCase();

  const filtered = q
    ? trips.filter((t) =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.destinations || []).map((d) => d.name).join(' ').toLowerCase().includes(q))
    : trips;

  if (!trips.length) {
    el.innerHTML = `<div class="empty"><p>No trips yet.</p><button class="btn btn--primary btn--sm" id="empty-new">+ New Trip</button></div>`;
    el.querySelector('#empty-new')?.addEventListener('click', openNewTripModal);
    return;
  }
  if (!filtered.length) {
    el.innerHTML = `<div class="empty"><p>No matches.</p></div>`;
    return;
  }

  el.innerHTML = filtered
    .map((t) => `
      <button class="trip-item ${t.id === currentTripId ? 'trip-item--active' : ''}" data-id="${t.id}">
        <div class="trip-item__title">${escapeAttr(t.title)}</div>
        <div class="trip-item__meta">
          ${(t.destinations || []).map((d) => escapeText(d.name)).join(', ') || '—'} ·
          ${t.startDate ? fmtDate(t.startDate) : 'No dates'}
        </div>
      </button>`)
    .join('');

  el.querySelectorAll('.trip-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTrip(btn.dataset.id);
      setState({ tab: 'itinerary' });
      switchTab('itinerary');
    });
  });
}

export function openNewTripModal() {
  const body = document.createElement('div');
  body.appendChild(field('Trip title', textInput('f-title', '', 'Summer in Japan')));
  body.appendChild(field('Subtitle', textInput('f-subtitle', '', 'A short tagline (optional)'), 'Shown under the trip title'));
  body.appendChild(field('Destination(s)', destInput(), 'Comma-separated'));
  const dates = document.createElement('div');
  dates.className = 'row';
  dates.appendChild(field('Start date', dateInput('f-start')));
  dates.appendChild(field('End date', dateInput('f-end')));
  body.appendChild(dates);
  body.appendChild(field('Currency', currencyInput()));

  openModal({
    title: 'New trip',
    body,
    actions: [
      { label: 'Create', kind: 'primary', onclick: async (b, close) => {
        const title = b.querySelector('#f-title').value.trim();
        const subtitle = b.querySelector('#f-subtitle').value.trim();
        const dests = b.querySelector('#f-dest').value.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
        const start = b.querySelector('#f-start').value;
        const end = b.querySelector('#f-end').value;
        const currency = b.querySelector('#f-currency').value.trim() || 'USD';
        if (end && start && end < start) { alert('End date must be on or after the start date.'); return; }
        const trip = await createTrip({ title: title || 'Untitled trip', subtitle, destinations: dests, startDate: start || null, endDate: end || null, currency });
        close();
        renderTripList();
        renderActive();
      } },
    ],
  });
}

export function openEditTripModal(tripId, onDone) {
  const trip = getTrip(tripId);
  if (!trip) return;
  const body = document.createElement('div');
  body.appendChild(field('Trip title', valInput('f-title', trip.title)));
  body.appendChild(field('Subtitle', valInput('f-subtitle', trip.subtitle || ''), 'A short tagline (optional)'));
  const dests = valInput('f-dest', (trip.destinations || []).map((d) => d.name).join(', '));
  dests.id = 'f-dest';
  body.appendChild(field('Destination(s)', dests, 'Comma-separated'));
  const dates = document.createElement('div'); dates.className = 'row';
  const s = valInput('f-start', trip.startDate || ''); s.type = 'date';
  const e = valInput('f-end', trip.endDate || ''); e.type = 'date';
  dates.appendChild(field('Start date', s));
  dates.appendChild(field('End date', e));
  body.appendChild(dates);
  body.appendChild(field('Currency', valInput('f-currency', trip.currency || 'USD')));

  // Vehicle editor (sets EV mode). Empty model clears the vehicle.
  body.appendChild(vehicleSection(trip.vehicle));

  openModal({
    title: 'Edit trip',
    body,
    actions: [
      { label: 'Delete trip', kind: 'danger', onclick: async (_b, close) => {
        if (!confirm('Delete this trip and all its data?')) return;
        await deleteTrip(tripId); close(); renderTripList(); renderActive();
      } },
      { label: 'Save', kind: 'primary', onclick: async (b, close) => {
        const title = b.querySelector('#f-title').value.trim();
        const subtitle = b.querySelector('#f-subtitle').value.trim();
        const destArr = b.querySelector('#f-dest').value.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
        const start = b.querySelector('#f-start').value;
        const end = b.querySelector('#f-end').value;
        const currency = b.querySelector('#f-currency').value.trim() || 'USD';
        if (end && start && end < start) { alert('End date must be on or after the start date.'); return; }
        const vehicle = readVehicle(b);
        await updateTrip(tripId, { title, subtitle, destinations: destArr, currency, vehicle });
        await updateTripDates(tripId, start || null, end || null);
        close(); renderTripList(); onDone?.();
      } },
    ],
  });
}

// ---- Vehicle editor ----
function vehicleSection(existing) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = 'Vehicle (optional — set to enable EV mode)';
  wrap.appendChild(lab);
  const hint = document.createElement('p');
  hint.className = 'subtle mb0';
  hint.textContent = 'Model is generic; the EV fields are optional/advanced.';
  wrap.appendChild(hint);

  const v = existing || {};
  const grid = document.createElement('div');
  grid.className = 'row';
  grid.appendChild(field('Model', valInput('v-model', v.model || '', 'e.g. Tesla Model 3')));
  grid.appendChild(field('Charging convention', selectInput('v-conv', ['NACS', 'CCS', 'Type 2', 'CHAdeMO', '—'], v.chargingConvention || '—')));
  wrap.appendChild(grid);

  const grid2 = document.createElement('div');
  grid2.className = 'row';
  grid2.appendChild(field('Battery (kWh)', numInput('v-battery', v.batteryKWh)));
  grid2.appendChild(field('Efficiency (mi/kWh)', numInput('v-eff', v.efficiencyMilesPerKWh)));
  wrap.appendChild(grid2);

  const grid3 = document.createElement('div');
  grid3.className = 'row';
  grid3.appendChild(field('Full range (mi)', numInput('v-full', v.fullRangeMiles)));
  grid3.appendChild(field('Usable range (mi)', numInput('v-usable', v.usableRangeMiles)));
  wrap.appendChild(grid3);
  return wrap;
}

function readVehicle(b) {
  const model = b.querySelector('#v-model').value.trim();
  if (!model) return null; // clearing the model clears EV mode
  const conv = b.querySelector('#v-conv').value;
  const v = {
    model,
    batteryKWh: numVal(b.querySelector('#v-battery').value),
    efficiencyMilesPerKWh: numVal(b.querySelector('#v-eff').value),
    fullRangeMiles: numVal(b.querySelector('#v-full').value),
    usableRangeMiles: numVal(b.querySelector('#v-usable').value),
  };
  if (conv && conv !== '—') v.chargingConvention = conv;
  // drop undefined keys for a clean object
  for (const k of Object.keys(v)) if (v[k] == null) delete v[k];
  return v;
}

// ---- input builders ----
function textInput(id, value, placeholder) {
  const i = document.createElement('input');
  i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function dateInput(id) {
  const i = document.createElement('input');
  i.className = 'input'; i.id = id; i.type = 'date';
  return i;
}
function currencyInput() {
  const i = document.createElement('input');
  i.className = 'input'; i.id = 'f-currency'; i.value = 'USD'; i.maxLength = 4;
  return i;
}
function destInput() {
  const i = document.createElement('input');
  i.className = 'input'; i.id = 'f-dest'; i.placeholder = 'e.g. Osaka, Japan';
  return i;
}
function valInput(id, value) {
  const i = document.createElement('input');
  i.className = 'input'; i.id = id; i.value = value == null ? '' : value;
  return i;
}
function numInput(id, value) {
  const i = document.createElement('input');
  i.className = 'input'; i.id = id; i.type = 'number'; i.step = '0.01'; i.value = value ?? '';
  return i;
}
function selectInput(id, opts, value) {
  const s = document.createElement('select');
  s.className = 'input'; s.id = id;
  s.innerHTML = opts.map((o) => `<option value="${o}">${escapeText(o)}</option>`).join('');
  if (value) s.value = value;
  return s;
}
function numVal(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; }

function escapeText(s) { return String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function escapeAttr(s) { return escapeText(s).replace(/"/g, '&quot;'); }