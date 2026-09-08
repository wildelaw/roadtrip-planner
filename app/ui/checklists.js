// Checklists tab: collapsible category groups with per-item done state.
// Backed by typed checklists [{id, category, items:[{id,text,done}]}] in store.js.
// Export converts back to {category: string[]}; done state is UI-only.

import {
  getTrip,
  addChecklistCategory, renameChecklistCategory, deleteChecklistCategory,
  addChecklistItem, toggleChecklistItem, updateChecklistItem, deleteChecklistItem,
} from '../store.js';
import { escapeHTML } from '../utils/format.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

export function renderChecklists(tripId) {
  const panel = document.getElementById('panel-checklists');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }
  const lists = trip.checklists || [];
  const totalItems = lists.reduce((n, c) => n + (c.items?.length || 0), 0);
  const doneItems = lists.reduce((n, c) => n + (c.items?.filter((i) => i.done).length || 0), 0);

  panel.innerHTML = `
    <div class="card">
      <div class="card__head">
        <h2>Checklists</h2>
        <span class="subtle">${totalItems ? `${doneItems}/${totalItems} done` : ''}</span>
        <button class="btn btn--sm btn--primary" id="cl-add-cat" style="margin-left:auto">+ Category</button>
      </div>
      <p class="subtle mb0">Packing & prep lists grouped by category. Done state is kept in the app but not written to trip-data.json on export.</p>
    </div>
    <div id="cl-host"></div>
  `;

  panel.querySelector('#cl-add-cat').addEventListener('click', () => addCategoryModal(trip.id));
  const host = panel.querySelector('#cl-host');
  if (!lists.length) {
    host.innerHTML = `<div class="card"><p class="subtle mb0">No checklists yet. Add a category (e.g. "Clothing", "EV driving").</p></div>`;
    return;
  }
  for (const cat of lists) host.appendChild(renderCategory(trip.id, cat));
}

function renderCategory(tripId, cat) {
  const el = document.createElement('div');
  el.className = 'card';
  const items = cat.items || [];
  const done = items.filter((i) => i.done).length;
  el.innerHTML = `
    <div class="card__head">
      <h3>${escapeHTML(cat.category)}</h3>
      <span class="subtle">${items.length ? `${done}/${items.length}` : ''}</span>
      <div class="flex gap" style="margin-left:auto">
        <button class="btn--ghost" data-act="rename">Rename</button>
        <button class="btn--ghost" data-act="del-cat">Delete</button>
      </div>
    </div>
    <div class="cl-items"></div>
    <button class="btn btn--sm" data-act="add-item" style="margin-top:8px">+ Item</button>
  `;
  const itemsHost = el.querySelector('.cl-items');
  if (!items.length) {
    itemsHost.innerHTML = `<p class="subtle mb0">No items.</p>`;
  } else {
    for (const it of items) itemsHost.appendChild(renderItem(tripId, cat.id, it));
  }
  el.querySelector('[data-act="add-item"]').addEventListener('click', () => {
    const text = prompt('New checklist item:');
    if (text && text.trim()) addChecklistItem(tripId, cat.id, text.trim());
  });
  el.querySelector('[data-act="rename"]').addEventListener('click', () => {
    const name = prompt('Category name:', cat.category);
    if (name && name.trim()) renameChecklistCategory(tripId, cat.id, name.trim());
  });
  el.querySelector('[data-act="del-cat"]').addEventListener('click', () => {
    if (confirm(`Delete category "${cat.category}" and all its items?`)) deleteChecklistCategory(tripId, cat.id);
  });
  return el;
}

function renderItem(tripId, catId, it) {
  const el = document.createElement('label');
  el.className = 'cl-item';
  el.innerHTML = `
    <input type="checkbox" ${it.done ? 'checked' : ''} />
    <span class="cl-text ${it.done ? 'cl-text--done' : ''}">${escapeHTML(it.text)}</span>
    <div class="flex gap" style="margin-left:auto">
      <button class="btn--ghost" data-act="edit">Edit</button>
      <button class="btn--ghost" data-act="del">Delete</button>
    </div>
  `;
  el.querySelector('input').addEventListener('change', (e) => toggleChecklistItem(tripId, catId, it.id));
  el.querySelector('[data-act="edit"]').addEventListener('click', () => {
    const text = prompt('Edit item:', it.text);
    if (text != null && text.trim()) updateChecklistItem(tripId, catId, it.id, text.trim());
  });
  el.querySelector('[data-act="del"]').addEventListener('click', () => deleteChecklistItem(tripId, catId, it.id));
  return el;
}

function addCategoryModal(tripId) {
  const body = document.createElement('div');
  const i = document.createElement('input');
  i.className = 'input'; i.id = 'cat-name'; i.placeholder = 'e.g. Clothing';
  body.appendChild(field('Category name', i));
  openModal({
    title: 'Add checklist category',
    body,
    actions: [{ label: 'Add', kind: 'primary', onclick: (b, close) => {
      const name = b.querySelector('#cat-name').value.trim();
      if (!name) { alert('Enter a category name.'); return; }
      addChecklistCategory(tripId, name);
      close();
      toast('Category added.', 'ok');
    } }],
  });
}