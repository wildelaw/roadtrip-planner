// Per-day itinerary item rendering + add/edit/delete.

import { getState, getTrip, addItineraryItem, updateItineraryItem, deleteItineraryItem, setDayMeta } from '../store.js';
import { fmtDateLong } from '../utils/dates.js';
import { fmtMoney, escapeHTML } from '../utils/format.js';
import { openModal, field } from './modal.js';

const TYPE_LABEL = { activity: 'Activity', transport: 'Transport', lodging: 'Lodging', note: 'Note' };

export function renderDay(trip, day) {
  const wrap = document.createElement('div');
  wrap.className = 'day card';
  const meta = [
    day.title && escapeHTML(day.title),
    day.drive && `🚗 ${escapeHTML(day.drive)}`,
    day.stay && `🏨 ${escapeHTML(day.stay)}`,
    day.chargeStops != null && `⚡ ${day.chargeStops} stops`,
  ].filter(Boolean).join(' · ');
  wrap.innerHTML = `
    <div class="day__head">
      <div>
        <div class="day__date">${escapeHTML(fmtDateLong(day.date))}</div>
        ${meta ? `<div class="subtle">${meta}</div>` : ''}
        ${day.summary ? `<div class="subtle">${escapeHTML(day.summary)}</div>` : ''}
      </div>
      <span class="subtle">${day.items.length} item${day.items.length === 1 ? '' : 's'}</span>
      <button class="btn btn--sm day__meta" data-day-id="${day.id}">Day notes</button>
      <button class="btn btn--sm day__add" data-day-id="${day.id}">+ Add item</button>
    </div>
    ${day.dining && day.dining.length ? `<div class="subtle" style="margin-bottom:6px">🍽️ ${day.dining.map((d) => escapeHTML(d)).join(' · ')}</div>` : ''}
    ${day.tips && day.tips.length ? `<div class="info info--warn" style="margin-bottom:10px"><strong>Tips:</strong> ${day.tips.map((t) => escapeHTML(t)).join(' · ')}</div>` : ''}
    <div class="day__items"></div>
  `;
  wrap.querySelector('.day__meta').addEventListener('click', () => dayMetaModal(trip, day));
  const itemsHost = wrap.querySelector('.day__items');
  if (!day.items.length) {
    itemsHost.innerHTML = `<p class="subtle mb0">Nothing planned yet. Add an item, or ask the AI Planner to fill this day.</p>`;
  } else {
    for (const item of [...day.items].sort(byTime)) itemsHost.appendChild(renderItem(trip, day, item));
  }
  return wrap;
}

function renderItem(trip, day, item) {
  const el = document.createElement('div');
  el.className = 'item';
  const cost = item.cost != null ? fmtMoney(item.cost, item.currency || trip.currency || 'USD') : '';
  const f = item.flags || {};
  const flagBadges = [
    f.charge ? '⚡' : '',
    f.overnight ? '🌙' : '',
    f.tour ? '🎟️' : '',
    f.warn ? '⚠️' : '',
    f.minSoc ? `🔋${escapeHTML(f.minSoc)}` : '',
  ].filter(Boolean).join(' ');
  const timeLabel = item.timeRaw || item.time || '';
  el.innerHTML = `
    <div class="item__time">${escapeHTML(timeLabel)}${flagBadges ? `<br><span class="subtle">${flagBadges}</span>` : ''}</div>
    <div>
      <div class="item__title"><span class="tag tag--${item.type || 'activity'}">${TYPE_LABEL[item.type] || 'Activity'}</span> ${escapeHTML(item.title)}</div>
      <div class="item__meta">
        ${item.location ? '📍 ' + escapeHTML(item.location) + ' · ' : ''}
        ${item.durationMin ? item.durationMin + ' min · ' : ''}
        ${cost}
        ${item.confirmation ? ' · ✎ ' + escapeHTML(item.confirmation) : ''}
      </div>
      ${item.notes ? `<div class="item__meta">${escapeHTML(item.notes)}</div>` : ''}
    </div>
    <div class="flex gap">
      <button class="btn--ghost" data-act="edit">Edit</button>
      <button class="btn--ghost" data-act="del">Delete</button>
    </div>
  `;
  el.querySelector('[data-act="edit"]').addEventListener('click', () => editItem(trip, day, item));
  el.querySelector('[data-act="del"]').addEventListener('click', async () => {
    if (confirm(`Delete "${item.title}"?`)) await deleteItineraryItem(trip.id, day.id, item.id);
  });
  return el;
}

export function addItem(tripId, dayId) {
  const trip = getTrip(tripId);
  const day = trip?.days.find((d) => d.id === dayId);
  if (!day) return;
  itemModal('Add itinerary item', trip.currency, null, async (vals, close) => {
    const res = await addItineraryItem(tripId, { date: day.date, ...vals });
    if (res?.error) { alert(res.error); return; }
    close();
  });
}

function editItem(trip, day, item) {
  itemModal('Edit item', trip.currency, item, async (vals, close) => {
    await updateItineraryItem(trip.id, day.id, item.id, vals);
    close();
  });
}

function itemModal(title, currency, existing, onSave) {
  const body = document.createElement('div');
  body.appendChild(field('Type', selectEl('f-type', ['activity', 'transport', 'lodging', 'note'], existing?.type)));
  body.appendChild(field('Title', textEl('f-title', existing?.title, 'e.g. Dinner at Ichiran')));
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(field('Time', timeEl('f-time', existing?.time)));
  row.appendChild(field('Duration (min)', numEl('f-duration', existing?.durationMin)));
  body.appendChild(row);
  body.appendChild(field('Location', textEl('f-loc', existing?.location, 'e.g. Dotonbori, Osaka')));
  const row2 = document.createElement('div'); row2.className = 'row';
  row2.appendChild(field(`Cost (${currency || 'USD'})`, numEl('f-cost', existing?.cost)));
  row2.appendChild(field('Confirmation #', textEl('f-conf', existing?.confirmation)));
  body.appendChild(row2);
  body.appendChild(field('Notes', areaEl('f-notes', existing?.notes)));

  openModal({
    title,
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: (b, close) => {
      const vals = {
        type: b.querySelector('#f-type').value,
        title: b.querySelector('#f-title').value.trim() || 'Untitled',
        time: b.querySelector('#f-time').value || undefined,
        durationMin: numVal(b.querySelector('#f-duration').value),
        location: b.querySelector('#f-loc').value.trim() || undefined,
        cost: numVal(b.querySelector('#f-cost').value),
        confirmation: b.querySelector('#f-conf').value.trim() || undefined,
        notes: b.querySelector('#f-notes').value.trim() || undefined,
      };
      onSave(vals, close);
    } }],
  });
}

// input builders
function textEl(id, value, placeholder) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder; return i;
}
function areaEl(id, value) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = 2; t.value = value ?? ''; return t;
}
function selectEl(id, opts, value) {
  const s = document.createElement('select'); s.id = s.id || id; s.id = id;
  s.innerHTML = opts.map((o) => `<option value="${o}">${TYPE_LABEL[o]}</option>`).join('');
  if (value) s.value = value; return s;
}
function timeEl(id, value) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'time';
  if (value) i.value = value; return i;
}
function numEl(id, value) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'number'; i.step = '0.01';
  i.value = value ?? ''; return i;
}
function numVal(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; }

function byTime(a, b) {
  if (!a.time && !b.time) return 0;
  if (!a.time) return 1;
  if (!b.time) return -1;
  return a.time.localeCompare(b.time);
}

// Editable day meta: title, drive, stay, summary, dining list, tips list.
function dayMetaModal(trip, day) {
  const body = document.createElement('div');
  body.appendChild(field('Day title', textEl('m-title', day.title, 'e.g. Osaka → Kyoto')));
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(field('Drive', textEl('m-drive', day.drive, 'e.g. 80 mi, 2h')));
  row.appendChild(field('Stay', textEl('m-stay', day.stay, 'e.g. Hotel in Kyoto')));
  body.appendChild(row);
  body.appendChild(field('Summary', areaEl('m-summary', day.summary)));
  body.appendChild(field('Dining (one per line)', areaElRows('m-dining', (day.dining || []).join('\n'), 3)));
  body.appendChild(field('Tips (one per line)', areaElRows('m-tips', (day.tips || []).join('\n'), 3)));
  openModal({
    title: `Day notes — ${fmtDateLong(day.date)}`,
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      const patch = {
        title: b.querySelector('#m-title').value.trim() || undefined,
        drive: b.querySelector('#m-drive').value.trim() || undefined,
        stay: b.querySelector('#m-stay').value.trim() || undefined,
        summary: b.querySelector('#m-summary').value.trim() || undefined,
        dining: b.querySelector('#m-dining').value.split('\n').map((s) => s.trim()).filter(Boolean),
        tips: b.querySelector('#m-tips').value.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      for (const k of Object.keys(patch)) if (patch[k] == null || (Array.isArray(patch[k]) && !patch[k].length)) delete patch[k];
      await setDayMeta(trip.id, day.id, patch);
      close();
    } }],
  });
}

function areaElRows(id, value, rows) {
  const t = document.createElement('textarea'); t.className = 'input'; t.id = id; t.rows = rows || 2; t.value = value ?? ''; return t;
}