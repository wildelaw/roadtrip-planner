// Bookings & tasks tab: reservations, no-reservation-needed, pre-trip actions, contacts.
// Each booking collection is id-normalized in store.js (collectionAdd/Update/Delete).
// reservations & preTripActions carry a UI-only `done` flag (stripped on export).

import { getTrip, collectionAdd, collectionUpdate, collectionDelete } from '../store.js';
import { escapeHTML } from '../utils/format.js';
import { fmtDate } from '../utils/dates.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

const PRIORITY = ['high', 'med', 'low'];

export function renderBookings(tripId) {
  const panel = document.getElementById('panel-bookings');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }

  const reservations = trip.reservations || [];
  const noRes = trip.noReservationNeeded || [];
  const actions = trip.preTripActions || [];
  const contacts = trip.contacts || [];
  const today = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>Reservations</h2><span class="subtle">${reservations.length}</span>
        <button class="btn btn--sm btn--primary" data-add="reservations" style="margin-left:auto">+ Add</button>
      </div>
      ${reservations.length ? renderReservations(reservations, today) : `<p class="subtle mb0">Things that need booking (with deadlines). Add what to book, by when, and how.</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>No reservation needed</h2><span class="subtle">${noRes.length}</span>
        <button class="btn btn--sm btn--primary" data-add="noReservationNeeded" style="margin-left:auto">+ Add</button>
      </div>
      ${noRes.length ? renderNoRes(noRes) : `<p class="subtle mb0">Activities you can just show up to — no booking required.</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Pre-trip actions</h2><span class="subtle">${actions.length}</span>
        <button class="btn btn--sm btn--primary" data-add="preTripActions" style="margin-left:auto">+ Add</button>
      </div>
      ${actions.length ? renderActions(actions) : `<p class="subtle mb0">Todos before you leave (documents, packing, prep). Check them off as you go.</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Contacts</h2><span class="subtle">${contacts.length}</span>
        <button class="btn btn--sm btn--primary" data-add="contacts" style="margin-left:auto">+ Add</button>
      </div>
      ${contacts.length ? renderContacts(contacts) : `<p class="subtle mb0">Useful contacts — what they're for and how to reach them.</p>`}
    </div>
  `;

  wireRowActions(panel, trip.id);
  panel.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addModal(trip.id, b.dataset.add)));
}

// ---- render helpers ----
function renderReservations(list, today) {
  return `<table class="data"><thead><tr><th></th><th>What</th><th>When</th><th>Book by</th><th>Cost</th><th></th></tr></thead><tbody>
    ${list.map((r) => {
      const overdue = r.bookBy && r.bookBy < today && !r.done;
      const priority = r.priority || 'med';
      return `<tr>
        <td><input type="checkbox" data-toggle="reservations" data-id="${r.id}" ${r.done ? 'checked' : ''} /></td>
        <td><strong>${escapeHTML(r.what || '')}</strong>${r.priority ? ` <span class="badge badge--${priority}">${priority}</span>` : ''}${r.howToBook ? `<div class="subtle">${linkify(r.howToBook)}</div>` : ''}</td>
        <td>${escapeHTML(r.when ? fmtDate(r.when) : '—')}</td>
        <td${overdue ? ' class="overdue"' : ''}>${escapeHTML(r.bookBy ? fmtDate(r.bookBy) : '—')}${overdue ? ' ⚠' : ''}</td>
        <td>${escapeHTML(String(r.cost ?? ''))}</td>
        <td><button class="btn--ghost" data-edit="reservations" data-id="${r.id}">Edit</button><button class="btn--ghost" data-del="reservations" data-id="${r.id}">Delete</button></td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function renderNoRes(list) {
  return `<table class="data"><thead><tr><th>What</th><th>Notes</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr>
      <td><strong>${escapeHTML(r.what || '')}</strong></td>
      <td class="subtle">${escapeHTML(r.notes || '')}</td>
      <td><button class="btn--ghost" data-edit="noReservationNeeded" data-id="${r.id}">Edit</button><button class="btn--ghost" data-del="noReservationNeeded" data-id="${r.id}">Delete</button></td>
    </tr>`).join('')}
  </tbody></table>`;
}

function renderActions(list) {
  return `<table class="data"><thead><tr><th></th><th>Task</th><th>Category</th><th>Priority</th><th></th></tr></thead><tbody>
    ${list.map((r) => {
      const priority = r.priority || 'low';
      return `<tr>
        <td><input type="checkbox" data-toggle="preTripActions" data-id="${r.id}" ${r.done ? 'checked' : ''} /></td>
        <td><span class="${r.done ? 'cl-text--done' : ''}">${escapeHTML(r.text || '')}</span></td>
        <td class="subtle">${escapeHTML(r.category || '—')}</td>
        <td>${r.priority ? `<span class="badge badge--${priority}">${priority}</span>` : '—'}</td>
        <td><button class="btn--ghost" data-edit="preTripActions" data-id="${r.id}">Edit</button><button class="btn--ghost" data-del="preTripActions" data-id="${r.id}">Delete</button></td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function renderContacts(list) {
  return `<table class="data"><thead><tr><th>What</th><th>How</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr>
      <td>${escapeHTML(c.what || '')}</td>
      <td>${linkify(c.how || '')}</td>
      <td><button class="btn--ghost" data-edit="contacts" data-id="${c.id}">Edit</button><button class="btn--ghost" data-del="contacts" data-id="${c.id}">Delete</button></td>
    </tr>`).join('')}
  </tbody></table>`;
}

function linkify(s) {
  const url = /^(https?:\/\/|www\.)/i.test(s);
  if (!url) return escapeHTML(s);
  const href = s.startsWith('http') ? s : 'https://' + s;
  return `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(s)}</a>`;
}

function wireRowActions(panel, tripId) {
  panel.querySelectorAll('[data-toggle]').forEach((cb) =>
    cb.addEventListener('change', () => collectionUpdate(tripId, cb.dataset.toggle, cb.dataset.id, { done: cb.checked })));
  panel.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const trip = getTrip(tripId);
      const item = (trip[b.dataset.edit] || []).find((x) => x.id === b.dataset.id);
      if (item) editModal(tripId, b.dataset.edit, item);
    }));
  panel.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => collectionDelete(tripId, b.dataset.del, b.dataset.id)));
}

// ---- modals ----
function addModal(tripId, key) { fieldModal(tripId, key, null); }
function editModal(tripId, key, item) { fieldModal(tripId, key, item); }

function fieldModal(tripId, key, existing) {
  const body = document.createElement('div');
  const set = (id, val, ph) => { const i = textInput(id, val ?? '', ph); body.appendChild(field(labelFor(key, id), i)); return i; };

  if (key === 'reservations') {
    set('f-what', existing?.what, 'e.g. Ryokan in Hakone');
    const row = document.createElement('div'); row.className = 'row';
    const when = dateInput('f-when', existing?.when); row.appendChild(field('Date', when));
    const bookBy = dateInput('f-bookby', existing?.bookBy); row.appendChild(field('Book by', bookBy));
    body.appendChild(row);
    set('f-cost', existing?.cost, 'est. $300');
    body.appendChild(field('How to book', textInput('f-how', existing?.howToBook || '', 'URL or instructions')));
    body.appendChild(field('Priority', selectInput('f-prio', PRIORITY, existing?.priority || 'med')));
  } else if (key === 'noReservationNeeded') {
    set('f-what', existing?.what, 'e.g. Walk around Gion');
    body.appendChild(field('Notes', area('f-notes', existing?.notes)));
  } else if (key === 'preTripActions') {
    set('f-text', existing?.text, 'e.g. Buy JR Pass');
    const row = document.createElement('div'); row.className = 'row';
    row.appendChild(field('Category', textInput('f-cat', existing?.category || '', 'documents')));
    row.appendChild(field('Priority', selectInput('f-prio', PRIORITY, existing?.priority || 'low')));
    body.appendChild(row);
  } else if (key === 'contacts') {
    set('f-what', existing?.what, 'e.g. Embassy / hotel concierge');
    body.appendChild(field('How', textInput('f-how', existing?.how || '', 'phone or URL')));
  }

  openModal({
    title: `${existing ? 'Edit' : 'Add'} ${humanKey(key)}`,
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      const payload = readPayload(b, key);
      if (key === 'reservations' && !payload.what) { alert('Enter what to book.'); return; }
      if (key === 'noReservationNeeded' && !payload.what) { alert('Enter a description.'); return; }
      if (key === 'preTripActions' && !payload.text) { alert('Enter a task.'); return; }
      if (key === 'contacts' && !payload.what) { alert('Enter what the contact is for.'); return; }
      if (existing) await collectionUpdate(tripId, key, existing.id, payload);
      else await collectionAdd(tripId, key, payload);
      close();
      toast('Saved.', 'ok');
    } }],
  });
}

function readPayload(b, key) {
  const v = (id) => b.querySelector(`#${id}`)?.value.trim() || undefined;
  if (key === 'reservations') return { what: v('f-what'), when: v('f-when'), bookBy: v('f-bookby'), cost: v('f-cost'), howToBook: v('f-how'), priority: v('f-prio') };
  if (key === 'noReservationNeeded') return { what: v('f-what'), notes: v('f-notes') };
  if (key === 'preTripActions') return { text: v('f-text'), category: v('f-cat'), priority: v('f-prio'), done: !!b.querySelector('#f-done')?.checked };
  if (key === 'contacts') return { what: v('f-what'), how: v('f-how') };
  return {};
}

function humanKey(k) {
  return { reservations: 'reservation', noReservationNeeded: 'no-reservation item', preTripActions: 'pre-trip action', contacts: 'contact' }[k] || k;
}
function labelFor(k, id) {
  if (id === 'f-what') return k === 'preTripActions' ? 'Task' : 'What';
  if (id === 'f-how') return k === 'contacts' ? 'How' : 'How to book';
  return id.replace('f-', '').replace(/^./, (c) => c.toUpperCase());
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
function selectInput(id, opts, value) {
  const s = document.createElement('select'); s.className = 'input'; s.id = id;
  s.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join('');
  if (value) s.value = value; return s;
}