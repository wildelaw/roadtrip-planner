// Places tab: bucket list (dated chips) + location library with activities.
// Bridge: "Add activity to day" turns a location activity into an itinerary item.
// Locations model: [{ id, name, icon?, summary?, lodging?, charging?:string[], dining?:string[], activities?:[{name,type,desc}] }].

import { getTrip, collectionAdd, collectionUpdate, collectionDelete, addActivityToDay } from '../store.js';
import { escapeHTML } from '../utils/format.js';
import { fmtDate, dayCount } from '../utils/dates.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

export function renderPlaces(tripId) {
  const panel = document.getElementById('panel-places');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }

  const bucket = trip.bucketList || [];
  const locations = trip.locations || [];

  panel.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>Bucket list</h2>
        <button class="btn btn--sm btn--primary" id="pl-add-bucket" style="margin-left:auto">+ Add</button>
      </div>
      ${bucket.length ? `<div class="chips">${bucket.map((b, i) => `
        <span class="chip">${escapeHTML(b.name)}${b.dateLabel || (b.date ? ' · ' + fmtDate(b.date) : '') ? ` <span class="subtle">· ${escapeHTML(b.dateLabel || fmtDate(b.date))}</span>` : ''}
          <button data-bucket-del="${b.id}" title="Remove">×</button>
        </span>`).join('')}</div>` : `<p class="subtle mb0">Must-see items you want to fit in. Add dated chips to track them across the trip.</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Locations</h2><span class="subtle">${locations.length}</span>
        <button class="btn btn--sm btn--primary" id="pl-add-loc" style="margin-left:auto">+ Add location</button>
      </div>
      <p class="subtle mb0">A library of places (POIs) with summaries, lodging, charging, dining, and structured activities. Add any activity directly to a day.</p>
    </div>
    <div id="pl-loc-host"></div>
  `;

  panel.querySelector('#pl-add-bucket').addEventListener('click', () => bucketModal(trip.id));
  panel.querySelector('#pl-add-loc').addEventListener('click', () => locationModal(trip.id, null));
  panel.querySelectorAll('[data-bucket-del]').forEach((b) =>
    b.addEventListener('click', () => collectionDelete(trip.id, 'bucketList', b.dataset.bucketDel)));

  const host = panel.querySelector('#pl-loc-host');
  if (!locations.length) {
    host.innerHTML = `<div class="card"><p class="subtle mb0">No locations yet. Build a library from your research, then place activities into days.</p></div>`;
    return;
  }
  for (const loc of locations) host.appendChild(renderLocation(trip, loc));
}

function renderLocation(trip, loc) {
  const el = document.createElement('div');
  el.className = 'card';
  const activities = loc.activities || [];
  const dining = loc.dining || [];
  el.innerHTML = `
    <div class="card__head">
      <h2>${escapeHTML(loc.icon || '📍')} ${escapeHTML(loc.name)}</h2>
      <div class="flex gap" style="margin-left:auto">
        <button class="btn--ghost" data-act="edit">Edit</button>
        <button class="btn--ghost" data-act="del">Delete</button>
      </div>
    </div>
    ${loc.summary ? `<p>${escapeHTML(loc.summary)}</p>` : ''}
    ${(loc.lodging || loc.charging?.length) ? `<div class="subtle mb0">
      ${loc.lodging ? `🏨 ${escapeHTML(loc.lodging)}` : ''}
      ${loc.charging?.length ? ` · ⚡ ${loc.charging.map(escapeHTML).join(', ')}` : ''}
    </div>` : ''}
    ${dining.length ? `<div class="sublist"><strong>Dining:</strong> ${dining.map((d) => `<button class="btn--ghost" data-dine="${escapeHTML(d)}">${escapeHTML(d)}</button>`).join('')}</div>` : ''}
    ${activities.length ? `<div class="loc__activities">
      ${activities.map((a) => `<div class="loc__act">
        <span class="loc__act-type">${escapeHTML(a.type || 'activity')}</span>
        <strong>${escapeHTML(a.name)}</strong>
        ${a.desc ? `<span class="subtle">— ${escapeHTML(a.desc)}</span>` : ''}
        <button class="btn btn--sm" data-act-add="${escapeHTML(a.name)}" style="margin-left:auto">+ Add to a day</button>
      </div>`).join('')}
    </div>` : ''}
  `;
  el.querySelector('[data-act="edit"]').addEventListener('click', () => locationModal(trip.id, loc));
  el.querySelector('[data-act="del"]').addEventListener('click', () => {
    if (confirm(`Delete location "${loc.name}"?`)) collectionDelete(trip.id, 'locations', loc.id);
  });
  el.querySelectorAll('[data-act-add]').forEach((b) =>
    b.addEventListener('click', () => addActivityToDayModal(trip, loc, b.dataset.actAdd)));
  el.querySelectorAll('[data-dine]').forEach((b) =>
    b.addEventListener('click', () => addActivityToDayModal(trip, loc, b.dataset.dine, 'dining')));
  return el;
}

// Pick a day and drop the activity/dining entry onto it as an itinerary item.
function addActivityToDayModal(trip, loc, name, kind) {
  const days = trip.days || [];
  if (!days.length) { toast('Set trip dates first to add activities to days.', 'warn'); return; }
  const body = document.createElement('div');
  const sel = document.createElement('select'); sel.className = 'input'; sel.id = 'd-day';
  sel.innerHTML = days.map((d, i) => `<option value="${d.date}">Day ${i + 1} — ${fmtDate(d.date)}${d.title ? ' · ' + escapeHTML(d.title) : ''}</option>`).join('');
  body.appendChild(field('Day', sel));
  body.appendChild(field('Title', textInput('d-title', name, 'Activity title')));
  body.appendChild(field('Time (optional)', timeInput('d-time')));
  openModal({
    title: kind === 'dining' ? `Add dining to a day` : `Add activity to a day`,
    body,
    actions: [{ label: 'Add', kind: 'primary', onclick: async (b, close) => {
      const date = b.querySelector('#d-day').value;
      const title = b.querySelector('#d-title').value.trim() || name;
      const time = b.querySelector('#d-time').value || undefined;
      const res = await addActivityToDay(trip.id, { date, title, type: kind === 'dining' ? 'activity' : 'activity', location: loc.name, time });
      if (res?.error) { alert(res.error); return; }
      close();
      toast(`Added "${title}" to ${fmtDate(date)}.`, 'ok');
    } }],
  });
}

function bucketModal(tripId) {
  const body = document.createElement('div');
  body.appendChild(field('Name', textInput('b-name', '', 'e.g. Fushimi Inari at dawn')));
  const row = document.createElement('div'); row.className = 'row';
  const date = document.createElement('input'); date.className = 'input'; date.id = 'b-date'; date.type = 'date';
  row.appendChild(field('Date (optional)', date));
  const label = textInput('b-label', '', 'e.g. "Day 2 morning"');
  row.appendChild(field('Date label (optional)', label));
  body.appendChild(row);
  openModal({
    title: 'Add bucket list item',
    body,
    actions: [{ label: 'Add', kind: 'primary', onclick: async (b, close) => {
      const name = b.querySelector('#b-name').value.trim();
      if (!name) { alert('Enter a name.'); return; }
      const payload = { name };
      const d = b.querySelector('#b-date').value; if (d) payload.date = d;
      const l = b.querySelector('#b-label').value.trim(); if (l) payload.dateLabel = l;
      await collectionAdd(tripId, 'bucketList', payload);
      close();
    } }],
  });
}

function locationModal(tripId, existing) {
  const body = document.createElement('div');
  body.appendChild(field('Name', textInput('l-name', existing?.name || '', 'e.g. Osaka')));
  body.appendChild(field('Icon (emoji, optional)', textInput('l-icon', existing?.icon || '', '📍')));
  body.appendChild(field('Summary', area('l-summary', existing?.summary)));
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(field('Lodging', textInput('l-lodging', existing?.lodging || '')));
  row.appendChild(field('Charging (comma-sep)', textInput('l-charge', (existing?.charging || []).join(', '))));
  body.appendChild(row);
  body.appendChild(field('Dining (one per line)', diningArea('l-dining', (existing?.dining || []).join('\n'))));
  body.appendChild(field('Activities (name | type | desc, one per line)', activitiesArea('l-acts', (existing?.activities || []).map((a) => `${a.name || ''} | ${a.type || ''} | ${a.desc || ''}`).join('\n'))));

  openModal({
    title: existing ? 'Edit location' : 'Add location',
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      const name = b.querySelector('#l-name').value.trim();
      if (!name) { alert('Enter a location name.'); return; }
      const payload = {
        name,
        icon: b.querySelector('#l-icon').value.trim() || undefined,
        summary: b.querySelector('#l-summary').value.trim() || undefined,
        lodging: b.querySelector('#l-lodging').value.trim() || undefined,
        charging: b.querySelector('#l-charge').value.split(',').map((s) => s.trim()).filter(Boolean),
        dining: b.querySelector('#l-dining').value.split('\n').map((s) => s.trim()).filter(Boolean),
        activities: b.querySelector('#l-acts').value.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
          const [nm, type, desc] = line.split('|').map((x) => x.trim());
          return { name: nm, type: type || undefined, desc: desc || undefined };
        }).filter((a) => a.name),
      };
      for (const k of Object.keys(payload)) if (payload[k] == null || (Array.isArray(payload[k]) && !payload[k].length)) delete payload[k];
      if (existing) await collectionUpdate(tripId, 'locations', existing.id, payload);
      else await collectionAdd(tripId, 'locations', payload);
      close();
      toast('Location saved.', 'ok');
    } }],
  });
}

// ---- input builders ----
function textInput(id, value, placeholder) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder; return i;
}
function area(id, value) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = 2; t.value = value ?? ''; return t;
}
function diningArea(id, value) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = 3; t.value = value ?? ''; return t;
}
function activitiesArea(id, value) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = 4; t.value = value ?? ''; return t;
}
function timeInput(id) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'time'; return i;
}