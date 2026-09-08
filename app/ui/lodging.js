// Lodging tab: stay entries with check-in/out, nights, area, notes.
// Model: trip.lodging: [{ id, location, checkIn, checkOut, nights?, area?, notes? }] (id-normalized).

import { getTrip, collectionAdd, collectionUpdate, collectionDelete } from '../store.js';
import { escapeHTML } from '../utils/format.js';
import { fmtDate, daysBetween } from '../utils/dates.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

export function renderLodging(tripId) {
  const panel = document.getElementById('panel-lodging');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }
  const lodging = trip.lodging || [];
  const days = trip.days || [];
  const dayDates = new Set(days.map((d) => d.date));

  panel.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>Lodging</h2><span class="subtle">${lodging.length} stay${lodging.length === 1 ? '' : 's'}</span>
        <button class="btn btn--sm btn--primary" id="lg-add" style="margin-left:auto">+ Add stay</button>
      </div>
      <p class="subtle mb0">Where you're sleeping each night. Nights are derived from check-in/out; days covered are matched against your trip dates.</p>
    </div>
    <div id="lg-host"></div>
  `;
  panel.querySelector('#lg-add').addEventListener('click', () => stayModal(trip.id, null));
  const host = panel.querySelector('#lg-host');
  if (!lodging.length) {
    host.innerHTML = `<div class="card"><p class="subtle mb0">No lodging added yet.</p></div>`;
    return;
  }
  for (const stay of lodging) host.appendChild(renderStay(trip.id, stay, dayDates));
}

function renderStay(tripId, stay, dayDates) {
  const el = document.createElement('div');
  el.className = 'card';
  const nights = stay.nights != null ? stay.nights : (stay.checkIn && stay.checkOut ? Math.max(0, daysBetween(stay.checkIn, stay.checkOut)) : null);
  // Which trip days does this stay cover?
  const covered = [];
  if (stay.checkIn && stay.checkOut) {
    for (const d of [...dayDates].sort()) {
      if (d >= stay.checkIn && d < stay.checkOut) covered.push(d);
    }
  }
  el.innerHTML = `
    <div class="card__head">
      <h2>${escapeHTML(stay.location || 'Untitled stay')}</h2>
      <div class="flex gap" style="margin-left:auto">
        <button class="btn--ghost" data-act="edit">Edit</button>
        <button class="btn--ghost" data-act="del">Delete</button>
      </div>
    </div>
    <div class="kv">
      <dt>Check-in</dt><dd>${escapeHTML(stay.checkIn ? fmtDate(stay.checkIn) : '—')}</dd>
      <dt>Check-out</dt><dd>${escapeHTML(stay.checkOut ? fmtDate(stay.checkOut) : '—')}</dd>
      <dt>Nights</dt><dd>${nights != null ? nights : '—'}</dd>
      ${stay.area ? `<dt>Area</dt><dd>${escapeHTML(stay.area)}</dd>` : ''}
    </div>
    ${covered.length ? `<div class="subtle mt">Covers ${covered.length} trip day${covered.length === 1 ? '' : 's'}: ${covered.map((d) => escapeHTML(fmtDate(d))).join(', ')}</div>` : ''}
    ${stay.notes ? `<p class="mt">${escapeHTML(stay.notes)}</p>` : ''}
  `;
  el.querySelector('[data-act="edit"]').addEventListener('click', () => stayModal(tripId, stay));
  el.querySelector('[data-act="del"]').addEventListener('click', () => {
    if (confirm(`Delete lodging "${stay.location || 'stay'}"?`)) collectionDelete(tripId, 'lodging', stay.id);
  });
  return el;
}

function stayModal(tripId, existing) {
  const body = document.createElement('div');
  body.appendChild(field('Location / name', textInput('l-loc', existing?.location || '', 'e.g. Hotel Granvia Osaka')));
  const row = document.createElement('div'); row.className = 'row';
  const ci = dateInput('l-ci', existing?.checkIn); row.appendChild(field('Check-in', ci));
  const co = dateInput('l-co', existing?.checkOut); row.appendChild(field('Check-out', co));
  body.appendChild(row);
  const row2 = document.createElement('div'); row2.className = 'row';
  row2.appendChild(field('Area (optional)', textInput('l-area', existing?.area || '')));
  body.appendChild(row2);
  body.appendChild(field('Notes', area('l-notes', existing?.notes)));
  openModal({
    title: existing ? 'Edit lodging' : 'Add lodging',
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      const location = b.querySelector('#l-loc').value.trim();
      if (!location) { alert('Enter a location/name.'); return; }
      const payload = {
        location,
        checkIn: b.querySelector('#l-ci').value || undefined,
        checkOut: b.querySelector('#l-co').value || undefined,
        area: b.querySelector('#l-area').value.trim() || undefined,
        notes: b.querySelector('#l-notes').value.trim() || undefined,
      };
      for (const k of Object.keys(payload)) if (payload[k] == null) delete payload[k];
      if (payload.checkIn && payload.checkOut) {
        const n = daysBetween(payload.checkIn, payload.checkOut);
        if (n >= 0) payload.nights = n;
      }
      if (existing) await collectionUpdate(tripId, 'lodging', existing.id, payload);
      else await collectionAdd(tripId, 'lodging', payload);
      close();
      toast('Lodging saved.', 'ok');
    } }],
  });
}

// ---- input builders ----
function textInput(id, value, placeholder) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder; return i;
}
function dateInput(id, value) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'date';
  if (value) i.value = value; return i;
}
function area(id, value) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = 2; t.value = value ?? ''; return t;
}