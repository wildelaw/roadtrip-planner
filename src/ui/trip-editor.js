// The trip's own fields, and the export dialog (specs/07-ui.md §4, specs/06 §4).

TP.ui.tripEditor = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  // ---- Field writers ----
  //
  // Every edit goes through TP.store.edit, so it is undone as a unit and lands in the history
  // with a label that says what changed.

  function setField(label, path, value) {
    TP.store.edit(label, function (trip) {
      var parts = path.split('.');
      var node = trip;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
    });
  }

  function textField(label, path, value, options) {
    var opts = options || {};
    var input = r().el('input', {
      class: 'input',
      type: opts.type || 'text',
      value: value == null ? '' : value,
      attrs: opts.placeholder ? { placeholder: opts.placeholder } : null,
    });
    input.addEventListener('change', function () {
      var next = input.value;
      if (path === 'vehicle.model' && !next.trim()) {
        // Clearing the vehicle model is how a trip stops being an EV trip; leaving an empty
        // vehicle object behind would keep the Charging tab on for nobody. The key goes rather
        // than being nulled, because the schema says `vehicle` is an object when it is there at
        // all — see the note in `model/trip.js`.
        TP.store.edit('Remove vehicle', function (trip) { delete trip.vehicle; });
        return;
      }
      setField(label, path, next);
    });
    return r().labelled(opts.labelText || label, input);
  }

  function dateField(label, path, value) {
    var input = r().el('input', { class: 'input', type: 'date', value: value || '' });
    input.addEventListener('change', function () {
      setField(label, path, input.value || null);
      // The day list follows the dates. Shrinking the range does not delete days that still
      // hold items — itineraryDay.resync asks first.
      TP.ui.itineraryDay.resync();
    });
    return r().labelled(label, input);
  }

  function peopleControl(trip, label) {
    var input = r().el('input', { class: 'input', type: 'text', value: travelerNames(trip) });
    input.addEventListener('change', function () {
      setField(label || 'Change travelers', 'travelers', readTravelers(input.value));
    });
    return input;
  }

  // ---- Travelers ----

  function travelerNames(trip) {
    return ((trip && trip.travelers) || []).map(function (t) {
      return typeof t === 'string' ? t : (t && t.name) || '';
    }).filter(Boolean).join(', ');
  }

  function readTravelers(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (name) {
        var t = TP.model.newTraveler();
        t.name = name;
        return t;
      });
  }

  // ---- A whole trip, as a form ----

  function tripForm(trip) {
    var draft = trip || TP.model.newTrip({});
    var fields = {
      title: r().el('input', { class: 'input', type: 'text', value: draft.title || '', attrs: { placeholder: 'Pacific Coast, September' } }),
      subtitle: r().el('input', { class: 'input', type: 'text', value: draft.subtitle || '', attrs: { placeholder: 'Optional' } }),
      startDate: r().el('input', { class: 'input', type: 'date', value: draft.startDate || TP.dates.todayISO() }),
      endDate: r().el('input', { class: 'input', type: 'date', value: draft.endDate || '' }),
      currency: r().el('input', { class: 'input', type: 'text', value: draft.currency || 'USD', attrs: { maxlength: '8' } }),
      vehicleModel: r().el('input', { class: 'input', type: 'text', value: (draft.vehicle && draft.vehicle.model) || '', attrs: { placeholder: 'Leave blank if not driving an EV' } }),
      travelers: r().el('input', { class: 'input', type: 'text', value: travelerNames(draft) }),
    };

    var body = [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Trip name' }), fields.title]),
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Subtitle' }), fields.subtitle]),
      r().el('div', { class: 'row' }, [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'First day' }), fields.startDate]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Last day' }), fields.endDate]),
      ]),
      r().el('div', { class: 'row' }, [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Currency' }), fields.currency]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Vehicle' }), fields.vehicleModel]),
      ]),
      r().el('div', { class: 'field' }, [
        r().el('label', { text: 'People' }),
        fields.travelers,
        r().el('div', { class: 'subtle', text: 'Separate names with commas.' }),
      ]),
    ];

    return { body: body, fields: fields };
  }

  // New Trip.
  function createTrip() {
    var form = tripForm(null);
    return TP.ui.modal.open({
      title: 'New trip',
      body: form.body,
      defaultAction: 'create',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'create', label: 'Create' }],
    }).then(function (id) {
      if (id !== 'create') return null;
      var f = form.fields;
      var start = f.startDate.value || TP.dates.todayISO();
      var end = f.endDate.value || start;
      if (TP.dates.daysBetween(start, end) < 0) {
        // A trip that ends before it starts is not a trip. The range is swapped rather than
        // refused, because the user's intent is obvious and a dialog about it helps nobody.
        var swap = start; start = end; end = swap;
      }
      var trip = TP.model.newTrip({
        title: f.title.value || 'Untitled trip',
        startDate: start,
        endDate: end,
        currency: (f.currency.value || 'USD').toUpperCase(),
      });
      trip.subtitle = f.subtitle.value || '';
      trip.travelers = readTravelers(f.travelers.value);
      if (f.vehicleModel.value.trim()) {
        trip.vehicle = { model: f.vehicleModel.value.trim() };
      }
      return TP.model.normalize(trip);
    });
  }

  // ---- The trip's own card, drawn at the top of the itinerary (REQ-702) ----

  function renderHeader(root, trip) {
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: TP.model.tripTitle(trip) }),
        r().el('span', { class: 'subtle', text: dateRange(trip) }),
      ]),
      trip.subtitle ? r().el('p', { class: 'subtle mb0', text: trip.subtitle }) : null,
      r().el('div', { class: 'row mt' }, [
        textField('Trip name', 'title', trip.title, { labelText: 'Trip name' }),
        dateField('First day', 'startDate', trip.startDate),
        dateField('Last day', 'endDate', trip.endDate),
      ]),
      r().el('div', { class: 'row' }, [
        textField('Currency', 'currency', trip.currency, { labelText: 'Currency' }),
        textField('Vehicle', 'vehicle.model', trip.vehicle && trip.vehicle.model, {
          labelText: 'Vehicle', placeholder: 'Leave blank if not driving an EV',
        }),
      ]),
      r().el('div', { class: 'field' }, [
        r().el('label', { text: 'People' }),
        peopleControl(trip, 'Change travelers'),
      ]),
    ]);
    r().append(root, card);
  }

  function dateRange(trip) {
    if (!trip || !trip.startDate) return 'No dates yet';
    if (!trip.endDate || trip.endDate === trip.startDate) return TP.dates.fmtDateLong(trip.startDate);
    return TP.dates.fmtDateLong(trip.startDate) + ' – ' + TP.dates.fmtDateLong(trip.endDate);
  }

  // ---- Export (specs/06 §4) ----

  var FORMATS = [
    { id: 'artifact', label: 'Planner document (.html)', note: 'The whole thing: your trip, its history, and the program. Open it later, on any machine, and everything is there.' },
    { id: 'tripdata', label: 'Trip data (.json)', note: 'Your trip as plain data, for another program or a backup you can read.' },
    { id: 'ical', label: 'Calendar (.ics)', note: 'Your itinerary as calendar events.' },
  ];

  function exportDialog() {
    var chosen = 'artifact';
    var notes = r().el('div');

    function refreshNotes() {
      if (chosen === 'artifact') { r().mount(notes, []); return; }
      var disc = TP.io.export.disclosures(chosen);
      r().mount(notes, [r().el('div', { class: 'info', text: disc.text })]);
    }

    var options = FORMATS.map(function (f) {
      var radio = r().el('input', { type: 'radio', name: 'export-format', value: f.id, checked: f.id === chosen });
      radio.addEventListener('change', function () { if (radio.checked) { chosen = f.id; refreshNotes(); } });
      return r().el('label', { class: 'flex gap items-start mb' }, [
        radio,
        r().el('span', {}, [r().el('strong', { text: f.label }), r().el('div', { class: 'subtle', text: f.note })]),
      ]);
    });

    refreshNotes();

    return TP.ui.modal.open({
      title: 'Export',
      body: [
        r().el('p', { class: 'subtle', text: 'What would you like to save?' }),
        r().el('div', { class: 'field' }, options),
        notes,
      ],
      defaultAction: 'export',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'export', label: 'Export' }],
    }).then(function (id) {
      if (id !== 'export') return null;
      return doExport(chosen);
    });
  }

  function build(format) {
    var trip = TP.store.trip();
    if (format === 'tripdata') return TP.io.export.tripData(trip);
    if (format === 'ical') return TP.io.export.ical(trip);

    // The container that is written must be the one the app holds, with the working copy
    // recorded at head if there are uncommitted edits — otherwise Export would quietly drop
    // the change the user just made.
    if (TP.store.isDirty()) TP.store.commit('Save before export');
    return TP.io.export.artifact(TP.store.container());
  }

  function doExport(format) {
    var result = build(format);

    if (!result.ok) {
      return TP.ui.modal.notice({
        title: 'This file was not produced',
        body: [
          r().el('div', { class: 'info info--danger', text: result.reason || 'The export failed.' }),
          (result.checks || []).length
            ? r().el('ul', {}, result.checks.map(function (c) {
              return r().el('li', { text: (c.ok ? '✓ ' : '✗ ') + c.name + (c.detail ? ' — ' + c.detail : '') });
            }))
            : null,
        ],
      }).then(function () { return null; });
    }

    var body = [];
    if (result.checks && result.checks.length) {
      body.push(r().el('ul', { class: 'sublist' }, result.checks.map(function (c) {
        return r().el('li', { text: c.name });
      })));
    }
    if (result.synthesized && result.synthesized.length) {
      body.push(r().el('div', { class: 'info', text: 'Added so the calendar is valid: ' + result.synthesized.join(' ') }));
    }
    if (result.blocked && result.blocked.length) {
      body.push(r().el('div', { class: 'info info--warn', text: result.blocked.length +
        (result.blocked.length === 1 ? ' item has no date, so it is not in the calendar: ' : ' items have no date, so they are not in the calendar: ') +
        result.blocked.map(function (b) { return b.title || b.id; }).join(', ') +
        '. They are still in the planner document.' }));
    }
    if (result.losses && result.losses.length) {
      body.push(r().el('div', { class: 'info', text: TP.io.export.disclosures(format).text }));
    }
    body.push(r().el('p', { class: 'subtle', text: 'Save as ' + result.filename + '?' }));

    return TP.ui.modal.open({
      title: 'Save ' + result.filename,
      body: body,
      defaultAction: 'save',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'save', label: 'Choose where to save' }],
    }).then(function (id) {
      if (id !== 'save') return null;
      return TP.io.export.deliver(result).then(function (delivered) {
        if (delivered.aborted) return null;
        if (!delivered.ok) {
          TP.ui.toast.warn(delivered.reason || 'The file could not be saved. The text is below so you can copy it.');
          return offerText(result, false);
        }
        TP.ui.toast.ok('Saved ' + delivered.filename + '.');
        if (delivered.offerCopy) return offerText(result, true);
        return delivered;
      });
    });
  }

  // Text export: when the browser will not hand a file:// page a download, the text itself is
  // the deliverable (REQ-510, REQ-604). It is shown in a read-only textarea, which the user
  // can select — the text is set as a property, never parsed as markup.
  function offerText(result, secondary) {
    var area = r().el('textarea', { class: 'input', attrs: { rows: '12', readonly: 'readonly', 'aria-label': 'File contents' } });
    area.value = result.text;
    return TP.ui.modal.open({
      title: secondary ? 'A copy you can paste' : 'Copy this to a file',
      body: [
        r().el('p', { class: 'subtle', text: secondary
          ? 'Some browsers will not download a file from a page opened from disk. The contents are here if you want them.'
          : 'Copy this text and paste it into a new file named ' + result.filename + '.' }),
        area,
      ],
      defaultAction: 'copy',
      actions: [{ id: 'close', label: 'Close' }, { id: 'copy', label: 'Copy to clipboard' }],
    }).then(function (id) {
      if (id !== 'copy') return null;
      return TP.io.export.copyToClipboard(result.text).then(function (res) {
        if (res.ok) TP.ui.toast.ok('Copied.');
        else TP.ui.toast.warn(res.reason);
        return res;
      });
    });
  }

  // ---- Collections ----
  //
  // Lodging, bookings, places, charging networks, budget lines: all of them are the same shape
  // — a list of entities on the trip, each with a few fields. They are drawn by one function so
  // that "add a row, change a cell, remove a row" behaves identically everywhere, and so that
  // every one of them writes through TP.store.edit and therefore lands in the history.

  function collectionCard(spec) {
    var trip = spec.trip;
    var rows = trip[spec.key] || [];
    var newRow = spec.blank || function () { return { id: TP.uid() }; };

    function cell(row, col) {
      var value = row[col.key];
      // A derived column is read-only: it shows something computed from the row rather than
      // stored on it, so editing it would create a second truth (03-data-model.md §2.3).
      if (col.derive) {
        var shown = col.derive(row);
        return r().el('span', { class: 'subtle', text: shown == null || shown === '' ? '—' : String(shown) });
      }
      if (col.type === 'checkbox') {
        var box = r().el('input', { type: 'checkbox', checked: !!value, attrs: { 'aria-label': col.label } });
        box.addEventListener('change', function () { setCell(row.id, col, box.checked); });
        return box;
      }
      if (col.type === 'select') {
        var sel = r().el('select', { class: 'input', attrs: { 'aria-label': col.label } },
          (col.options || []).map(function (o) {
            var v = typeof o === 'string' ? o : o.value;
            var l = typeof o === 'string' ? o : o.label;
            return r().el('option', { value: v, text: l, selected: String(value || '') === v });
          }));
        sel.addEventListener('change', function () { setCell(row.id, col, sel.value); });
        return sel;
      }
      var input = r().el('input', {
        class: 'input',
        type: col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text',
        value: value == null ? '' : value,
        attrs: col.placeholder ? { placeholder: col.placeholder, 'aria-label': col.label } : { 'aria-label': col.label },
      });
      input.addEventListener('change', function () {
        var next = input.value;
        if (col.type === 'number') next = next === '' ? null : Number(next);
        setCell(row.id, col, next);
      });
      return input;
    }

    function setCell(id, col, value) {
      TP.store.edit(spec.editLabel || ('Change ' + (spec.title || spec.key).toLowerCase()), function (t) {
        var list = t[spec.key] || [];
        var target = TP.model.findIn(list, id);
        if (!target) return;
        // A cleared cell DELETES the key rather than storing a null. The wire types the number
        // columns (`minSoc`) as `number`, so a null makes an export this app's own validator
        // refuses; an absent field is not a null field (ADR-0018). `budget.setField` does the same.
        if (col.set) col.set(target, value);
        else if (value === null) delete target[col.key];
        else target[col.key] = value;
      });
      TP.ui.shell.renderAll();
    }

    var table = r().el('table', { class: 'data compact' }, [
      r().el('thead', {}, r().el('tr', {}, (spec.columns || []).map(function (c) {
        return r().el('th', { text: c.label });
      }).concat([r().el('th', { attrs: { 'aria-label': 'Actions' } })]))),
      r().el('tbody', {}, rows.map(function (row) {
        return r().el('tr', {}, (spec.columns || []).map(function (c) {
          return r().el('td', {}, cell(row, c));
        }).concat([
          r().el('td', {}, [r().button('✕', function () { removeRow(row.id); }, {
            class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Remove this row', title: 'Remove this row' },
          })]),
        ]));
      })),
    ]);

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: spec.title || spec.key }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'entry', 'entries') : 'Nothing here yet' }),
      ]),
      spec.intro ? r().el('p', { class: 'subtle', text: spec.intro }) : null,
      rows.length ? table : r().el('p', { class: 'subtle', text: spec.empty || 'Nothing here yet.' }),
      r().el('div', { class: 'mt' }, [
        r().button('+ Add', function () { addRow(); }, { class: 'btn btn--primary btn--sm' }),
      ]),
    ]);

    function addRow() {
      var row = newRow();
      TP.store.edit(spec.editLabel || ('Add to ' + (spec.title || spec.key).toLowerCase()), function (t) {
        if (!Array.isArray(t[spec.key])) t[spec.key] = [];
        t[spec.key].push(row);
      });
      TP.ui.shell.renderAll();
      return row;
    }

    function removeRow(id) {
      TP.store.edit(spec.editLabel || ('Remove from ' + (spec.title || spec.key).toLowerCase()), function (t) {
        t[spec.key] = (t[spec.key] || []).filter(function (x) { return x.id !== id; });
      });
      TP.ui.shell.renderAll();
    }

    return { card: card, addRow: addRow, removeRow: removeRow };
  }

  return {
    setField: setField,
    textField: textField,
    dateField: dateField,
    peopleControl: peopleControl,
    tripForm: tripForm,
    createTrip: createTrip,
    renderHeader: renderHeader,
    dateRange: dateRange,
    travelerNames: travelerNames,
    readTravelers: readTravelers,
    exportDialog: exportDialog,
    doExport: doExport,
    build: build,
    collectionCard: collectionCard,
    FORMATS: FORMATS,
  };
})();
