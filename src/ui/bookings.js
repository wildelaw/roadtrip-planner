// Bookings and the things that must happen before leaving (specs/03 §2.4).
//
// `done` on a reservation or a pre-trip action is a fact about the user's progress, not about
// the trip, and neither export format has a place for it — the ledger records that as a D and
// the export dialog says so. It is kept here because losing your ticks on every reload would
// be worse than the disclosure.

TP.ui.bookings = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  var PRIORITY = ['high', 'med', 'low'];

  function render(root) {
    var trip = TP.store.trip();
    var today = TP.dates.todayISO();

    r().append(root, r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'Bookings and tasks' })]),
      r().el('p', { class: 'subtle mb0', text:
        'What needs booking, what you can just turn up to, what to do before you leave, and who ' +
        'to call. Ticks are kept in this planner; neither export format carries them.' }),
    ]));

    r().append(root, reservationsCard(trip, today));
    r().append(root, r().el('div', { class: 'card' }, [overdueBanner(trip, today)]));
    r().append(root, noResCard(trip));
    r().append(root, actionsCard(trip));
    r().append(root, contactsCard(trip));
  }

  function overdueBanner(trip, today) {
    var overdue = (trip.reservations || []).filter(function (res) {
      return !res.done && res.bookBy && res.bookBy < today;
    });
    if (!overdue.length) {
      return r().el('p', { class: 'subtle mb0', text: 'Nothing is past its booking deadline.' });
    }
    return r().el('div', { class: 'info info--danger', text:
      overdue.length + (overdue.length === 1 ? ' booking is past its deadline: ' : ' bookings are past their deadline: ') +
      overdue.map(function (res) { return res.what || 'untitled'; }).join(', ') + '.' });
  }

  // ---- Reservations ----

  function reservationsCard(trip, today) {
    var rows = (trip.reservations || []).slice().sort(function (a, b) {
      return String(a.bookBy || '9999').localeCompare(String(b.bookBy || '9999'));
    });

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Reservations' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'thing', 'things') + ' to book' : 'Nothing yet' }),
      ]),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Anything that needs booking in advance: add what it is and by when.' }));
    } else {
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [
          r().el('th', { attrs: { 'aria-label': 'Booked' } }),
          r().el('th', { text: 'What' }),
          r().el('th', { text: 'When' }),
          r().el('th', { text: 'Book by' }),
          r().el('th', { text: 'Cost' }),
          r().el('th', { text: 'How' }),
          r().el('th', { attrs: { 'aria-label': 'Actions' } }),
        ])),
        r().el('tbody', {}, rows.map(function (res) { return reservationRow(res, today); })),
      ]));
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add a reservation', function () { addRow('reservations'); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  function reservationRow(res, today) {
    var overdue = res.bookBy && res.bookBy < today && !res.done;
    return r().el('tr', {}, [
      r().el('td', {}, [doneBox('reservations', res)]),
      r().el('td', {}, [
        r().el('strong', { text: res.what || 'Untitled' }),
        res.priority ? r().el('span', { class: 'badge badge--' + (res.priority || 'med'), text: res.priority }) : null,
      ]),
      r().el('td', { class: 'subtle', text: res.when ? TP.dates.fmtDate(res.when) : '—' }),
      r().el('td', { class: overdue ? 'overdue' : 'subtle', text: (res.bookBy ? TP.dates.fmtDate(res.bookBy) : '—') + (overdue ? ' ⚠' : '') }),
      r().el('td', { class: 'subtle', text: res.cost == null || res.cost === '' ? '—' : String(res.cost) }),
      r().el('td', {}, [linkCell(res.howToBook)]),
      actionsCell('reservations', res),
    ]);
  }

  // ---- No reservation needed ----

  function noResCard(trip) {
    var rows = trip.noReservationNeeded || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'No reservation needed' }),
        r().el('span', { class: 'subtle', text: rows.length ? String(rows.length) : 'Nothing yet' }),
      ]),
    ]);
    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Things you can just turn up to. Recording them stops you re-checking later.' }));
    } else {
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [r().el('th', { text: 'What' }), r().el('th', { text: 'Notes' }), r().el('th', { attrs: { 'aria-label': 'Actions' } })])),
        r().el('tbody', {}, rows.map(function (row) {
          return r().el('tr', {}, [
            r().el('td', { text: row.what || 'Untitled' }),
            r().el('td', { class: 'subtle', text: row.notes || '' }),
            actionsCell('noReservationNeeded', row),
          ]);
        })),
      ]));
    }
    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add', function () { addRow('noReservationNeeded'); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  // ---- Pre-trip actions ----

  function actionsCard(trip) {
    var rows = trip.preTripActions || [];
    var done = rows.filter(function (a) { return a.done; }).length;
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Before you leave' }),
        r().el('span', { class: 'subtle', text: rows.length ? done + ' of ' + rows.length + ' done' : 'Nothing yet' }),
      ]),
    ]);
    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Documents, vaccinations, a spare key, someone to water the plants.' }));
    } else {
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [
          r().el('th', { attrs: { 'aria-label': 'Done' } }),
          r().el('th', { text: 'Task' }),
          r().el('th', { text: 'Category' }),
          r().el('th', { text: 'Priority' }),
          r().el('th', { attrs: { 'aria-label': 'Actions' } }),
        ])),
        r().el('tbody', {}, rows.map(function (row) {
          return r().el('tr', {}, [
            r().el('td', {}, [doneBox('preTripActions', row)]),
            r().el('td', {}, [r().el('span', { class: row.done ? 'cl-text--done' : '', text: row.text || '' })]),
            r().el('td', { class: 'subtle', text: row.category || '—' }),
            r().el('td', {}, [row.priority ? r().el('span', { class: 'badge badge--' + row.priority, text: row.priority }) : r().el('span', { class: 'subtle', text: '—' })]),
            actionsCell('preTripActions', row),
          ]);
        })),
      ]));
    }
    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add a task', function () { addRow('preTripActions'); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  // ---- Contacts ----

  function contactsCard(trip) {
    var rows = trip.contacts || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Contacts' }),
        r().el('span', { class: 'subtle', text: rows.length ? String(rows.length) : 'Nothing yet' }),
      ]),
    ]);
    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Who to call, and what for. A phone number written down beats a search when you need it.' }));
    } else {
      r().append(card, r().el('table', { class: 'data compact' }, [
        r().el('thead', {}, r().el('tr', {}, [r().el('th', { text: 'For' }), r().el('th', { text: 'How' }), r().el('th', { attrs: { 'aria-label': 'Actions' } })])),
        r().el('tbody', {}, rows.map(function (row) {
          return r().el('tr', {}, [
            r().el('td', { text: row.what || '' }),
            r().el('td', {}, [linkCell(row.how)]),
            actionsCell('contacts', row),
          ]);
        })),
      ]));
    }
    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add a contact', function () { addRow('contacts'); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  // ---- Shared cells ----

  function doneBox(key, row) {
    var box = r().el('input', { type: 'checkbox', checked: !!row.done, attrs: { 'aria-label': 'Done' } });
    box.addEventListener('change', function () {
      TP.store.edit('Tick something off', function (trip) {
        var target = TP.model.findIn(trip[key], row.id);
        if (target) target.done = box.checked;
      });
      TP.ui.shell.renderActive();
    });
    return box;
  }

  // A phone number is not a link; a URL is, and only if its scheme is allowed (REQ-704).
  function linkCell(value) {
    var raw = value == null ? '' : String(value);
    if (!raw) return r().el('span', { class: 'subtle', text: '—' });
    var target = TP.format.linkifyTarget(raw);
    if (!target) return r().el('span', { class: 'subtle', text: raw });
    return r().el('a', { href: target, attrs: { rel: 'noopener noreferrer', target: '_blank' }, text: raw });
  }

  function actionsCell(key, row) {
    return r().el('td', {}, [
      r().button('Edit', function () { editRow(key, row.id); }, { class: 'btn btn--ghost btn--sm' }),
      r().button('Delete', function () { deleteRow(key, row.id); }, { class: 'btn btn--ghost btn--sm' }),
    ]);
  }

  // ---- Row editing ----

  var SPECS = {
    reservations: {
      title: 'reservation',
      label: 'what',
      fields: [
        { key: 'what', label: 'What', required: true, placeholder: 'Alcatraz ferry' },
        { key: 'when', label: 'When', type: 'date' },
        { key: 'bookBy', label: 'Book by', type: 'date' },
        { key: 'cost', label: 'Cost', placeholder: 'est. $80' },
        { key: 'howToBook', label: 'How to book', placeholder: 'URL or instructions' },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
        { key: 'done', label: 'Booked', type: 'checkbox' },
      ],
      blank: function () { return { id: TP.uid(), what: '', priority: 'med', done: false }; },
    },
    noReservationNeeded: {
      title: 'entry',
      label: 'what',
      fields: [
        { key: 'what', label: 'What', required: true, placeholder: 'Walk the Golden Gate Bridge' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      blank: function () { return { id: TP.uid(), what: '' }; },
    },
    preTripActions: {
      title: 'task',
      label: 'text',
      fields: [
        { key: 'text', label: 'Task', required: true, placeholder: 'Renew the passport' },
        { key: 'category', label: 'Category', placeholder: 'documents' },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
        { key: 'done', label: 'Done', type: 'checkbox' },
      ],
      blank: function () { return { id: TP.uid(), text: '', priority: 'low', done: false }; },
    },
    contacts: {
      title: 'contact',
      label: 'what',
      fields: [
        { key: 'what', label: 'For', required: true, placeholder: 'Hotel concierge' },
        { key: 'how', label: 'How', placeholder: 'phone or URL' },
      ],
      blank: function () { return { id: TP.uid(), what: '' }; },
    },
  };

  function addRow(key) {
    return editRow(key, null);
  }

  function editRow(key, id) {
    var spec = SPECS[key];
    if (!spec) return null;
    var trip = TP.store.trip();
    var existing = id ? TP.model.findIn(trip[key], id) : spec.blank();
    if (!existing) return null;

    var controls = {};
    var error = r().el('div', { class: 'subtle mt' });

    var body = spec.fields.map(function (f) {
      var current = existing[f.key];
      var control;
      if (f.type === 'textarea') {
        control = r().el('textarea', { class: 'input', attrs: { rows: '3' } });
        control.value = current == null ? '' : String(current);
      } else if (f.type === 'select') {
        control = r().el('select', { class: 'input' }, (f.options || []).map(function (o) {
          return r().el('option', { value: o, text: o, selected: String(current || '') === o });
        }));
      } else if (f.type === 'checkbox') {
        control = r().el('input', { type: 'checkbox', checked: !!current });
      } else {
        control = r().el('input', {
          class: 'input',
          type: f.type === 'date' ? 'date' : 'text',
          value: current == null ? '' : String(current),
          attrs: f.placeholder ? { placeholder: f.placeholder } : null,
        });
      }
      controls[f.key] = control;
      return r().el('div', { class: 'field' }, [r().el('label', { text: f.label }), control]);
    });

    return TP.ui.modal.open({
      title: (id ? 'Edit ' : 'Add ') + spec.title,
      body: body.concat([error]),
      defaultAction: 'save',
      actions: (id ? [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', danger: true }] : [{ id: 'cancel', label: 'Cancel' }])
        .concat([{
          id: 'save',
          label: 'Save',
          run: function (settle) {
            var values = {};
            spec.fields.forEach(function (f) {
              var c = controls[f.key];
              if (f.type === 'checkbox') { values[f.key] = !!c.checked; return; }
              var v = (c.value || '').trim();
              // An empty text field means "no value", not the empty string: the difference
              // between a cost of "" and no cost at all matters to the budget roll-up.
              values[f.key] = (v === '' && f.type !== 'date') ? null : v;
            });
            if (spec.fields.some(function (f) { return f.required && !controls[f.key].value.trim(); })) {
              error.textContent = 'The ' + spec.label + ' is needed.';
              return;
            }
            TP.store.edit(id ? 'Edit a ' + spec.title : 'Add a ' + spec.title, function (t) {
              if (id) {
                var target = TP.model.findIn(t[key], id);
                if (!target) return;
                for (var k in values) {
                  if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
                  if (values[k] === null) delete target[k];
                  else target[k] = values[k];
                }
              } else {
                if (!Array.isArray(t[key])) t[key] = [];
                var row = { id: existing.id };
                for (var k2 in values) {
                  if (Object.prototype.hasOwnProperty.call(values, k2) && values[k2] !== null) row[k2] = values[k2];
                }
                t[key].push(row);
              }
            });
            settle('save');
            TP.ui.shell.renderActive();
          },
        }]),
    }).then(function (chosen) {
      if (chosen === 'delete') return deleteRow(key, id);
      return chosen;
    });
  }

  function deleteRow(key, id) {
    var item = TP.model.findIn(TP.store.trip()[key], id);
    var what = item ? (item.what || item.text || item.location || 'this entry') : 'this entry';
    return TP.ui.modal.confirm({
      title: 'Delete it?',
      body: r().el('p', { text: '“' + what + '” will be removed. History keeps it, so a revert can bring it back.' }),
      confirmLabel: 'Delete',
      danger: true,
    }).then(function (yes) {
      if (!yes) return null;
      TP.store.edit('Delete an entry', function (t) {
        t[key] = (t[key] || []).filter(function (x) { return x.id !== id; });
      });
      TP.ui.shell.renderActive();
      return id;
    });
  }

  return {
    render: render,
    addRow: addRow,
    editRow: editRow,
    deleteRow: deleteRow,
    SPECS: SPECS,
  };
})();
