// Budget: estimates as the plan, expenses as what actually happened (specs/03 §2.3).
//
// The roll-up is recomputed on every render from `budgetEstimates`. It is never stored: a
// stored total beside the lines it sums is two truths, and the first merge would have to
// arbitrate between them (03-data-model.md §2.3).

TP.ui.budget = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function render(root) {
    var trip = TP.store.trip();
    var estimates = trip.budgetEstimates || [];
    var expenses = trip.expenses || [];
    var currency = trip.currency || 'USD';

    var rollup = TP.model.rollupBudget(estimates);
    var spent = TP.model.expenseTotal(expenses);
    var required = estimates.reduce(function (sum, e) {
      return sum + (e.optional ? 0 : (TP.format.parseCost(e.cost) || 0));
    }, 0);
    var optional = rollup.total - required;

    r().append(root, summaryCard(currency, rollup.total, required, optional, spent, estimates.length, expenses.length));
    r().append(root, barsCard(rollup, currency, spent));
    r().append(root, estimatesCard(trip, currency));
    r().append(root, expensesCard(trip, currency));
  }

  function summaryCard(currency, total, required, optional, spent, lineCount, expenseCount) {
    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Budget' }),
        r().el('span', { class: 'subtle', text: lineCount ? TP.format.plural(lineCount, 'line item') : 'No estimates yet' }),
      ]),
      r().el('div', { class: 'row' }, [
        stat('Planned', TP.format.fmtMoney(total, currency), lineCount + ' line items'),
        stat('Must spend', TP.format.fmtMoney(required, currency), 'excluding optional'),
        stat('Optional', TP.format.fmtMoney(optional, currency), optional ? 'if the money is there' : 'none marked optional'),
        stat('Spent', TP.format.fmtMoney(spent, currency), expenseCount ? TP.format.plural(expenseCount, 'expense') : 'nothing recorded'),
      ]),
      spent > total && total > 0
        ? r().el('div', { class: 'info info--danger mt', text: 'Spending is ' + TP.format.fmtMoney(spent - total, currency) + ' past the plan.' })
        : null,
    ]);
  }

  function stat(label, value, note) {
    return r().el('div', {}, [
      r().el('div', { class: 'subtle', text: label }),
      r().el('div', { class: 'stat', text: value }),
      r().el('div', { class: 'subtle', text: note || '' }),
    ]);
  }

  function barsCard(rollup, currency, spent) {
    var card = r().el('div', { class: 'card' }, [r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'Where it goes' })])]);
    if (!rollup.categories.length) {
      r().append(card, r().el('p', { class: 'subtle mb0', text: 'Add line items with a category and the split appears here.' }));
      return card;
    }
    var max = rollup.categories.reduce(function (m, c) { return Math.max(m, c.amount); }, 0) || 1;
    rollup.categories.forEach(function (cat) {
      r().append(card, r().el('div', { class: 'mb' }, [
        r().el('div', { class: 'flex flex--between' }, [
          r().el('span', { text: cat.name }),
          r().el('span', { class: 'subtle', text: TP.format.fmtMoney(cat.amount, currency) }),
        ]),
        r().el('div', { class: 'bar' }, [
          r().el('div', {
            class: ['bar__fill', cat.amount > max ? 'bar__fill--over' : ''],
            // The one width that cannot be a class. It is set through the CSSOM rather than as a
            // `style` attribute, because the artifact's hash-pinned policy blocks the attribute
            // and does not cover the CSSOM (see ui/render.js).
            style: { width: Math.max(2, Math.round((cat.amount / max) * 100)) + '%' },
          }),
        ]),
      ]));
    });
    if (spent > 0) {
      r().append(card, r().el('p', { class: 'subtle mb0', text: 'Bars show the plan. Recorded spending is ' + TP.format.fmtMoney(spent, currency) + ' in total.' }));
    }
    return card;
  }

  function estimatesCard(trip, currency) {
    var rows = trip.budgetEstimates || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Estimated costs' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'line item') : 'Nothing yet' }),
      ]),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'What you expect to spend, grouped by category. A range like “$450–600” is fine — the low end is counted.' }));
    } else {
      var total = TP.model.rollupBudget(rows).total;
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [
          r().el('th', { text: 'Category' }), r().el('th', { text: 'Item' }), r().el('th', { text: 'Cost' }),
          r().el('th', { text: 'Optional' }), r().el('th', { attrs: { 'aria-label': 'Actions' } }),
        ])),
        r().el('tbody', {}, rows.map(function (row) { return estimateRow(row); }).concat([
          r().el('tr', {}, [
            r().el('th', { text: 'Total' }),
            r().el('td', {}),
            r().el('th', { text: TP.format.fmtMoney(total, currency) }),
            r().el('td', {}),
            r().el('td', {}),
          ]),
        ])),
      ]));
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add a line item', function () { editEstimate(null); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  function estimateRow(row) {
    return r().el('tr', {}, [
      r().el('td', {}, [cellInput('budgetEstimates', row.id, 'category', row.category, 'text')]),
      r().el('td', {}, [cellInput('budgetEstimates', row.id, 'item', row.item, 'text')]),
      r().el('td', {}, [cellInput('budgetEstimates', row.id, 'cost', row.cost, 'text')]),
      r().el('td', {}, [cellCheck('budgetEstimates', row.id, 'optional', row.optional)]),
      r().el('td', {}, [
        r().button('✕', function () { removeRow('budgetEstimates', row.id); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Remove this line' } }),
      ]),
    ]);
  }

  function expensesCard(trip, currency) {
    var rows = trip.expenses || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'What you actually spent' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.fmtMoney(TP.model.expenseTotal(rows), currency) : 'Nothing recorded' }),
      ]),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Record spending as it happens and the plan above stops being a guess.' }));
    } else {
      var sorted = rows.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [
          r().el('th', { text: 'Date' }), r().el('th', { text: 'Item' }), r().el('th', { text: 'Category' }),
          r().el('th', { text: 'Amount' }), r().el('th', { attrs: { 'aria-label': 'Actions' } }),
        ])),
        r().el('tbody', {}, sorted.map(function (row) {
          return r().el('tr', {}, [
            r().el('td', {}, [cellInput('expenses', row.id, 'date', row.date, 'date')]),
            r().el('td', {}, [cellInput('expenses', row.id, 'item', row.item, 'text')]),
            r().el('td', {}, [cellInput('expenses', row.id, 'category', row.category, 'text')]),
            r().el('td', {}, [cellInput('expenses', row.id, 'amount', row.amount, 'number')]),
            r().el('td', {}, [
              r().button('✕', function () { removeRow('expenses', row.id); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Remove this expense' } }),
            ]),
          ]);
        })),
      ]));
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Record spending', function () { editExpense(null); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  // ---- Cells ----

  function cellInput(key, rowId, field, value, type) {
    var input = r().el('input', {
      class: 'input',
      type: type === 'date' ? 'date' : type === 'number' ? 'number' : 'text',
      value: value == null ? '' : String(value),
      attrs: type === 'number' ? { step: 'any' } : null,
    });
    input.addEventListener('change', function () {
      setField(key, rowId, field, type === 'number'
        ? (input.value === '' ? null : Number(input.value))
        : (input.value === '' ? null : input.value));
    });
    return input;
  }

  function cellCheck(key, rowId, field, value) {
    var box = r().el('input', { type: 'checkbox', checked: !!value, attrs: { 'aria-label': field } });
    box.addEventListener('change', function () { setField(key, rowId, field, box.checked); });
    return box;
  }

  function setField(key, rowId, field, value) {
    TP.store.edit('Change the budget', function (trip) {
      var row = TP.model.findIn(trip[key], rowId);
      if (!row) return;
      if (value === null) delete row[field];
      else row[field] = value;
    });
    TP.ui.shell.renderActive();
  }

  function removeRow(key, rowId) {
    TP.store.edit('Remove a budget line', function (trip) {
      trip[key] = (trip[key] || []).filter(function (x) { return x.id !== rowId; });
    });
    TP.ui.shell.renderActive();
  }

  // ---- Dialogs ----

  function editEstimate(id) {
    var existing = id ? TP.model.findIn(TP.store.trip().budgetEstimates, id) : { category: '', item: '', cost: '', optional: false };
    var fields = {
      category: r().el('input', { class: 'input', type: 'text', value: existing.category || '', attrs: { placeholder: 'Lodging' } }),
      item: r().el('input', { class: 'input', type: 'text', value: existing.item || '', attrs: { placeholder: 'Hotel in Barstow, 2 nights' } }),
      cost: r().el('input', { class: 'input', type: 'text', value: existing.cost == null ? '' : String(existing.cost), attrs: { placeholder: 'est. $450–600' } }),
      optional: r().el('input', { type: 'checkbox', checked: !!existing.optional }),
    };
    var error = r().el('div', { class: 'subtle mt' });

    return TP.ui.modal.open({
      title: 'Add a line item',
      body: [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Category' }), fields.category]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Item' }), fields.item]),
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Cost' }), fields.cost]),
          r().el('div', { class: 'field' }, [
            r().el('label', { text: 'Optional' }),
            r().el('label', { class: 'flex gap' }, [fields.optional, r().el('span', { text: 'Only if the money is there' })]),
          ]),
        ]),
        error,
      ],
      defaultAction: 'save',
      actions: [{ id: 'cancel', label: 'Cancel' }, {
        id: 'save',
        label: 'Add it',
        run: function (settle) {
          if (!fields.item.value.trim()) { error.textContent = 'Say what the line is for.'; return; }
          TP.store.edit('Add a budget line', function (trip) {
            trip.budgetEstimates = trip.budgetEstimates || [];
            var row = {
              id: TP.uid(),
              category: fields.category.value.trim() || 'General',
              item: fields.item.value.trim(),
              optional: !!fields.optional.checked,
            };
            // Cost is optional, so a blank one OMITS the key. Writing `null` instead put a null in a
            // field the wire types as `stringOrNumber`, and the exported trip-data.json was then
            // refused by this app's own validator — an absent field is not a null field (ADR-0018),
            // which is why `setField` above deletes the key for the same case.
            var cost = fields.cost.value.trim();
            if (cost) row.cost = cost;
            trip.budgetEstimates.push(row);
          });
          settle('save');
          TP.ui.shell.renderActive();
        },
      }],
    });
  }

  function editExpense(id) {
    var existing = id ? TP.model.findIn(TP.store.trip().expenses, id) : { date: TP.dates.todayISO(), item: '', category: '', amount: null };
    var fields = {
      date: r().el('input', { class: 'input', type: 'date', value: existing.date || TP.dates.todayISO() }),
      item: r().el('input', { class: 'input', type: 'text', value: existing.item || '' }),
      category: r().el('input', { class: 'input', type: 'text', value: existing.category || '', attrs: { placeholder: 'General' } }),
      amount: r().el('input', { class: 'input', type: 'number', value: existing.amount == null ? '' : existing.amount, attrs: { step: 'any' } }),
    };
    var error = r().el('div', { class: 'subtle mt' });

    return TP.ui.modal.open({
      title: 'Record spending',
      body: [
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'When' }), fields.date]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Amount' }), fields.amount]),
        ]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Item' }), fields.item]),
        r().el('div', { class: 'field' }, [
          r().el('label', { text: 'Category' }), fields.category,
          r().el('div', { class: 'subtle', text: 'Left blank, this is recorded as General — the same default the export uses.' }),
        ]),
        error,
      ],
      defaultAction: 'save',
      actions: [{ id: 'cancel', label: 'Cancel' }, {
        id: 'save',
        label: 'Record it',
        run: function (settle) {
          var amount = fields.amount.value === '' ? null : Number(fields.amount.value);
          if (amount == null || !isFinite(amount)) { error.textContent = 'An amount is needed.'; return; }
          TP.store.edit('Record spending', function (trip) {
            trip.expenses = trip.expenses || [];
            trip.expenses.push({
              id: TP.uid(),
              date: fields.date.value || TP.dates.todayISO(),
              item: fields.item.value.trim(),
              category: fields.category.value.trim() || 'General',
              amount: amount,
            });
          });
          settle('save');
          TP.ui.shell.renderActive();
        },
      }],
    });
  }

  return {
    render: render,
    editEstimate: editEstimate,
    editExpense: editExpense,
    setField: setField,
    removeRow: removeRow,
  };
})();
