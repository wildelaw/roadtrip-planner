// Itinerary tab: trip metadata header + day-by-day list. Item rendering delegated to itinerary-day.js.

import { getState, getTrip, buildTripExport, collectionAdd, collectionDelete, addKeyTip, deleteKeyTip } from '../store.js';
import { downloadJSON } from '../io.js';
import { fmtDateLong, fmtDate, dayCount } from '../utils/dates.js';
import { renderDay, addItem } from './itinerary-day.js';
import { openEditTripModal } from './trip-list.js';
import { renderTripList } from './trip-list.js';
import { escapeHTML } from '../utils/format.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

export function renderItinerary(tripId) {
  const panel = document.getElementById('panel-itinerary');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2><p>Create a trip from the sidebar to start planning.</p></div>`;
    return;
  }

  const dests = (trip.destinations || []).map((d) => d.name).filter(Boolean).join(', ') || '—';
  const dates = trip.startDate && trip.endDate
    ? `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate)} (${dayCount(trip.startDate, trip.endDate)} days)`
    : 'No dates set';
  const vehicle = trip.vehicle;
  const alerts = trip.criticalAlerts || [];
  const keyTips = trip.keyTips || [];

  panel.innerHTML = `
    <div class="card">
      <div class="card__head">
        <div>
          <h2>${escapeHTML(trip.title)}</h2>
          <div class="subtle">${trip.subtitle ? escapeHTML(trip.subtitle) + ' · ' : ''}${escapeHTML(dests)} · ${dates}</div>
        </div>
        <div class="flex gap">
          <button class="btn btn--sm" id="export-trip">⬇ Export</button>
          <button class="btn btn--sm" id="edit-trip">Edit trip</button>
        </div>
      </div>
      <div class="kv">
        <dt>Travelers</dt><dd>${(trip.travelers || []).map((t) => escapeHTML(t.name || 'Traveler')).join(', ') || '—'}</dd>
        <dt>Currency</dt><dd>${escapeHTML(trip.currency || 'USD')}</dd>
        ${vehicle ? `<dt>Vehicle</dt><dd>${escapeHTML(vehicle.model || '')}${vehicle.usableRangeMiles ? ` · ${vehicle.usableRangeMiles} mi usable` : ''}</dd>` : ''}
        ${trip.source ? `<dt>Source</dt><dd>Imported ${new Date(trip.source.importedAt || Date.now()).toLocaleDateString()}</dd>` : ''}
      </div>
    </div>

    ${alerts.length || keyTips.length ? `
    <div class="card">
      <div class="card__head"><h2>Alerts & tips</h2>
        <div class="flex gap" style="margin-left:auto">
          <button class="btn btn--sm" id="add-alert">+ Alert</button>
          <button class="btn btn--sm" id="add-tip">+ Tip</button>
        </div>
      </div>
      ${alerts.map((a) => `
        <div class="info ${a.severity === 'danger' ? 'info--danger' : 'info--warn'}" style="display:flex;align-items:start;gap:8px">
          <div style="flex:1"><strong>${escapeHTML(a.title || '')}</strong> — ${escapeHTML(a.text || '')}</div>
          <button class="btn--ghost" data-alert-del="${a.id}">×</button>
        </div>`).join('')}
      ${keyTips.length ? `<ul class="data" style="padding-left:18px;margin-bottom:0">${keyTips.map((k, i) => `<li style="display:flex;align-items:center;gap:8px"><span style="flex:1">${escapeHTML(k)}</span><button class="btn--ghost" data-tip-del="${i}">×</button></li>`).join('')}</ul>` : ''}
    </div>` : `
    <div class="card">
      <div class="card__head"><h2>Alerts & tips</h2>
        <div class="flex gap" style="margin-left:auto">
          <button class="btn btn--sm" id="add-alert">+ Alert</button>
          <button class="btn btn--sm" id="add-tip">+ Tip</button>
        </div>
      </div>
      <p class="subtle mb0">No alerts or tips yet. Add critical alerts (closures, deadlines) and key tips for the trip.</p>
    </div>`}

    <div id="days-host"></div>
  `;

  panel.querySelector('#edit-trip').addEventListener('click', () => {
    openEditTripModal(trip.id, () => { renderTripList(); renderItinerary(trip.id); });
  });
  panel.querySelector('#export-trip').addEventListener('click', () => {
    const obj = buildTripExport(trip.id);
    if (!obj) return;
    const slug = (trip.title || 'trip').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'trip';
    downloadJSON(obj, `${slug}-trip-data.json`);
    toast('Exported trip-data.json.', 'ok');
  });

  panel.querySelector('#add-alert')?.addEventListener('click', () => alertModal(trip.id));
  panel.querySelector('#add-tip')?.addEventListener('click', () => {
    const text = prompt('New key tip:');
    if (text && text.trim()) addKeyTip(trip.id, text.trim());
  });
  panel.querySelectorAll('[data-alert-del]').forEach((b) =>
    b.addEventListener('click', () => collectionDelete(trip.id, 'criticalAlerts', b.dataset.alertDel)));
  panel.querySelectorAll('[data-tip-del]').forEach((b) =>
    b.addEventListener('click', () => deleteKeyTip(trip.id, Number(b.dataset.tipDel))));

  const host = panel.querySelector('#days-host');
  if (!trip.days?.length) {
    host.innerHTML = `<div class="card"><p class="subtle mb0">This trip has no dates yet. Click <b>Edit trip</b> to set a date range and generate days.</p></div>`;
    return;
  }
  for (const day of trip.days) host.appendChild(renderDay(trip, day));

  // "Add item" buttons are wired inside renderDay; here we attach the global add handler via delegation.
  host.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.day__add');
    if (addBtn) addItem(trip.id, addBtn.dataset.dayId);
  });
}

function alertModal(tripId) {
  const body = document.createElement('div');
  const titleI = document.createElement('input'); titleI.className = 'input'; titleI.id = 'a-title'; titleI.placeholder = 'e.g. Typhoon season';
  body.appendChild(field('Title', titleI));
  const textI = document.createElement('textarea'); textI.className = 'input'; textI.id = 'a-text'; textI.rows = 2; textI.placeholder = 'Details…';
  body.appendChild(field('Text', textI));
  const sev = document.createElement('select'); sev.className = 'input'; sev.id = 'a-sev';
  sev.innerHTML = `<option value="warn">Warning</option><option value="danger">Danger</option>`;
  body.appendChild(field('Severity', sev));
  openModal({
    title: 'Add alert',
    body,
    actions: [{ label: 'Add', kind: 'primary', onclick: (b, close) => {
      const title = b.querySelector('#a-title').value.trim();
      if (!title) { alert('Enter a title.'); return; }
      collectionAdd(tripId, 'criticalAlerts', { severity: b.querySelector('#a-sev').value, title, text: b.querySelector('#a-text').value.trim() });
      close();
    } }],
  });
}