// Budget tab: line-item estimates as source of truth + actual expenses vs. estimates.
//
// trip.budgetEstimates: [{ id, category, item, cost, optional }] — editable.
// trip.budget: derived roll-up { total, categories:[{name, amount}] } — recomputed on every edit.
// trip.expenses: actual spend.

import {
  getTrip, addExpense, deleteExpense,
  addBudgetEstimate, updateBudgetEstimate, deleteBudgetEstimate,
  parseCost, rollupBudget,
} from '../store.js';
import { fmtMoney, escapeHTML } from '../utils/format.js';
import { fmtDate } from '../utils/dates.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

export function renderBudget(tripId) {
  const panel = document.getElementById('panel-budget');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }

  const estimates = trip.budgetEstimates || [];
  const budget = trip.budget || rollupBudget(estimates);
  const budgetTotal = Number(budget.total || 0);
  const requiredTotal = estimates.filter((e) => !e.optional).reduce((s, e) => s + (parseCost(e.cost) || 0), 0);

  const expenses = trip.expenses || [];
  const totalSpent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pct = budgetTotal > 0 ? Math.min(100, (totalSpent / budgetTotal) * 100) : 0;
  const over = budgetTotal > 0 && totalSpent > budgetTotal;
  const catSpent = {};
  for (const e of expenses) catSpent[e.category] = (catSpent[e.category] || 0) + (Number(e.amount) || 0);

  // Group estimates by category for the line-item table.
  const byCat = new Map();
  for (const e of estimates) {
    const c = e.category || 'General';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(e);
  }

  panel.innerHTML = `
    <div class="card">
      <div class="card__head">
        <h2>Budget</h2>
        <div class="flex gap">
          <button class="btn btn--sm" id="b-add-estimate">+ Add estimate</button>
          <button class="btn btn--sm btn--primary" id="b-add-expense">+ Add expense</button>
        </div>
      </div>
      <div class="row">
        <div><div class="subtle">Estimated total</div><div class="stat">${fmtMoney(budgetTotal, trip.currency)}</div></div>
        <div><div class="subtle">Required (non-optional)</div><div class="stat">${fmtMoney(requiredTotal, trip.currency)}</div></div>
        <div><div class="subtle">Spent</div><div class="stat">${fmtMoney(totalSpent, trip.currency)}</div></div>
        <div><div class="subtle">Remaining</div><div class="stat" style="color:${over ? 'var(--danger)' : 'var(--ok)'}">${fmtMoney(budgetTotal - totalSpent, trip.currency)}</div></div>
      </div>
      ${budgetTotal > 0 ? `
        <div class="bar"><div class="bar__fill ${over ? 'bar__fill--over' : ''}" style="width:${pct}%"></div></div>
        <div class="subtle">${pct.toFixed(0)}% of estimated budget spent</div>` : `<div class="subtle mt">No estimates yet. Add line items to build the budget.</div>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Estimated costs</h2><span class="subtle">${estimates.length} line item${estimates.length === 1 ? '' : 's'}</span></div>
      ${estimates.length ? `
        <table class="data compact"><thead><tr><th>Category</th><th>Item</th><th>Cost</th><th>Spent</th><th></th></tr></thead><tbody>
          ${[...byCat].map(([cat, items]) => {
            const catBudget = items.reduce((s, e) => s + (parseCost(e.cost) || 0), 0);
            const spent = catSpent[cat] || 0;
            return items.map((e, i) => `<tr>
              <td>${i === 0 ? `<strong>${escapeHTML(cat)}</strong>` : ''}</td>
              <td>${escapeHTML(e.item || '—')}${e.optional ? ' <span class="badge badge--optional">optional</span>' : ''}</td>
              <td>${escapeHTML(String(e.cost ?? ''))}</td>
              <td>${i === 0 ? fmtMoney(spent, trip.currency) : ''}</td>
              <td>
                <button class="btn--ghost" data-est-edit="${e.id}">Edit</button>
                <button class="btn--ghost" data-est-del="${e.id}">Delete</button>
              </td>
            </tr>`).join('') + `<tr><td></td><td class="subtle">Subtotal</td><td><strong>${fmtMoney(catBudget, trip.currency)}</strong></td><td>${fmtMoney(catBudget - spent, trip.currency)} left</td><td></td></tr>`;
          }).join('')}
        </tbody></table>` : `<p class="subtle mb0">No estimates yet. Add line items grouped by category (e.g. Lodging, Transport, Food).</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Actual expenses</h2><span class="subtle">${expenses.length} total</span></div>
      ${expenses.length ? `
        <table class="data"><thead><tr><th>Date</th><th>Label</th><th>Category</th><th>Amount</th><th></th></tr></thead><tbody>
          ${expenses.map((e) => `<tr>
            <td>${escapeHTML(e.date ? fmtDate(e.date) : '')}</td>
            <td>${escapeHTML(e.label || '')}</td>
            <td>${escapeHTML(e.category || 'General')}</td>
            <td>${fmtMoney(e.amount, trip.currency)}</td>
            <td><button class="btn--ghost" data-del="${e.id}">Delete</button></td>
          </tr>`).join('')}
        </tbody></table>` : `<p class="subtle mb0">No expenses recorded yet. Track real spend against your estimates.</p>`}
    </div>
  `;

  panel.querySelector('#b-add-estimate').addEventListener('click', () => estimateModal(trip, null));
  panel.querySelector('#b-add-expense').addEventListener('click', () => addExpenseModal(trip));
  panel.querySelectorAll('[data-est-edit]').forEach((b) => b.addEventListener('click', () => {
    const e = estimates.find((x) => x.id === b.dataset.estEdit);
    if (e) estimateModal(trip, e);
  }));
  panel.querySelectorAll('[data-est-del]').forEach((b) => b.addEventListener('click', () => deleteBudgetEstimate(trip.id, b.dataset.estDel)));
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteExpense(trip.id, b.dataset.del)));
}

function estimateModal(trip, existing) {
  const cats = [...new Set((trip.budgetEstimates || []).map((e) => e.category).filter(Boolean))];
  const body = document.createElement('div');
  const catInput = document.createElement('input');
  catInput.className = 'input'; catInput.id = 'e-cat'; catInput.value = existing?.category || '';
  catInput.placeholder = 'Lodging'; catInput.setAttribute('list', 'cat-suggestions');
  const dl = document.createElement('datalist'); dl.id = 'cat-suggestions';
  dl.innerHTML = cats.map((c) => `<option value="${escapeHTML(c)}">`).join('') +
    ['Lodging', 'Transport', 'Food', 'Activities', 'Other'].map((c) => `<option value="${c}">`).join('');
  body.appendChild(dl);
  body.appendChild(field('Category', catInput));
  body.appendChild(field('Item', textEl('e-item', existing?.item || '', 'e.g. Hotel in Osaka (2 nights)')));
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(field(`Cost (${trip.currency || 'USD'})`, textEl('e-cost', existing?.cost ?? '', 'est. $450–600')));
  const opt = document.createElement('input'); opt.type = 'checkbox'; opt.id = 'e-opt'; opt.checked = !!existing?.optional;
  row.appendChild(field('Optional', opt, 'Excluded from required total'));
  body.appendChild(row);

  openModal({
    title: existing ? 'Edit estimate' : 'Add budget estimate',
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      const category = b.querySelector('#e-cat').value.trim() || 'General';
      const item = b.querySelector('#e-item').value.trim();
      const cost = b.querySelector('#e-cost').value.trim();
      const optional = b.querySelector('#e-opt').checked;
      if (!item) { alert('Enter an item description.'); return; }
      const payload = { category, item, cost, optional };
      if (existing) await updateBudgetEstimate(trip.id, existing.id, payload);
      else await addBudgetEstimate(trip.id, payload);
      close();
      toast('Estimate saved.', 'ok');
    } }],
  });
}

function addExpenseModal(trip) {
  const body = document.createElement('div');
  body.appendChild(field('Label', textEl('e-label', '', 'e.g. Train to Kyoto')));
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(field('Amount', numEl('e-amount', '')));
  const catSel = document.createElement('select'); catSel.className = 'input'; catSel.id = 'e-cat';
  const cats = (trip.budget?.categories || []).map((c) => c.name);
  const opts = cats.length ? cats : ['General', 'Lodging', 'Transport', 'Food', 'Activities', 'Other'];
  catSel.innerHTML = opts.map((c) => `<option>${escapeHTML(c)}</option>`).join('');
  row.appendChild(field('Category', catSel));
  const dateInp = document.createElement('input'); dateInp.className = 'input'; dateInp.type = 'date'; dateInp.id = 'e-date';
  if (trip.startDate) dateInp.value = trip.startDate;
  row.appendChild(field('Date', dateInp));
  body.appendChild(row);

  openModal({
    title: 'Add expense',
    body,
    actions: [{ label: 'Add', kind: 'primary', onclick: async (b, close) => {
      const amount = parseFloat(b.querySelector('#e-amount').value);
      if (!Number.isFinite(amount) || amount <= 0) { alert('Enter a positive amount.'); return; }
      await addExpense(trip.id, {
        label: b.querySelector('#e-label').value.trim(),
        amount,
        category: b.querySelector('#e-cat').value,
        date: b.querySelector('#e-date').value || undefined,
      });
      close();
      toast('Expense added.', 'ok');
    } }],
  });
}

function textEl(id, value, placeholder) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder; return i;
}
function numEl(id, value) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'number'; i.step = '0.01'; i.value = value ?? ''; return i;
}