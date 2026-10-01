// The itinerary: the trip's days and the items in them (specs/07-ui.md §4).

TP.ui.itineraryDay = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function render(root) {
    var trip = TP.store.trip();
    var header = r().el('div');
    TP.ui.tripEditor.renderHeader(header, trip);
    r().append(root, header);

    r().append(root, alertsCard(trip));

    var days = trip.days || [];
    if (!days.length) {
      r().append(root, r().el('div', { class: 'empty' }, [
        r().el('h2', { text: 'No days yet' }),
        r().el('p', { text: 'Set the trip\'s first and last day above and the days appear here.' }),
        r().button('Add a day', function () { addDay(); }, { class: 'btn btn--primary' }),
      ]));
      return;
    }

    days.forEach(function (day, index) {
      r().append(root, dayCard(day, index, days.length));
    });
  }

  // ---- Things to watch for ----
  //
  // Critical alerts sit at the top of the itinerary, where a warning is worth having. They are
  // the trip's own content, not a calendar VALARM, and neither export format carries them —
  // the ledger records that as a D rather than calling them "folded" and hoping.
  function alertsCard(trip) {
    var alerts = trip.criticalAlerts || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Things to watch for' }),
        r().el('span', { class: 'flex gap ml-auto' }, [
          r().button('+ Add', function () { addAlert(); }, { class: 'btn btn--sm' }),
        ]),
      ]),
    ]);

    if (!alerts.length) {
      r().append(card, r().el('p', { class: 'subtle mb0', text: 'Anything that would catch you out: a closed pass, a ferry that stops running, a booking that needs cash.' }));
      return card;
    }

    alerts.forEach(function (alert) {
      var severity = alert.severity === 'danger' ? 'high' : alert.severity === 'warn' ? 'med' : 'low';
      r().append(card, r().el('div', { class: 'flex gap items-start mb-sm' }, [
        r().el('span', { class: 'badge badge--' + severity, text: alert.severity || 'info' }),
        r().el('span', { class: 'flex-1' }, [
          r().el('strong', { text: alert.title || '' }),
          alert.text ? r().el('div', { class: 'subtle', text: alert.text }) : null,
        ]),
        r().button('Edit', function () { addAlert(alert.id); }, { class: 'btn btn--ghost btn--sm' }),
        r().button('✕', function () { removeAlert(alert.id); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Remove this alert' } }),
      ]));
    });

    return card;
  }

  function addAlert(id) {
    var existing = id ? TP.model.findIn(TP.store.trip().criticalAlerts, id) : { severity: 'warn', title: '', text: '' };
    var fields = {
      title: r().el('input', { class: 'input', type: 'text', value: existing.title || '', attrs: { placeholder: 'The road over the pass closes at dusk' } }),
      severity: r().el('select', { class: 'input' }, ['info', 'warn', 'danger'].map(function (s) {
        return r().el('option', { value: s, text: s, selected: (existing.severity || 'warn') === s });
      })),
      text: r().el('textarea', { class: 'input', attrs: { rows: '3' } }),
    };
    fields.text.value = existing.text || '';
    var error = r().el('div', { class: 'subtle mt' });

    return TP.ui.modal.open({
      title: id ? 'Edit alert' : 'Add an alert',
      body: [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'What' }), fields.title]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'How serious' }), fields.severity]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Detail' }), fields.text]),
        error,
      ],
      defaultAction: 'save',
      actions: (id ? [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', danger: true }] : [{ id: 'cancel', label: 'Cancel' }])
        .concat([{
          id: 'save',
          label: 'Save',
          run: function (settle) {
            if (!fields.title.value.trim()) { error.textContent = 'A title is needed.'; return; }
            TP.store.edit(id ? 'Edit an alert' : 'Add an alert', function (trip) {
              if (id) {
                var target = TP.model.findIn(trip.criticalAlerts, id);
                if (!target) return;
                target.title = fields.title.value.trim();
                target.severity = fields.severity.value;
                target.text = fields.text.value;
              } else {
                trip.criticalAlerts = trip.criticalAlerts || [];
                trip.criticalAlerts.push({
                  id: TP.uid(), title: fields.title.value.trim(),
                  severity: fields.severity.value, text: fields.text.value,
                });
              }
            });
            settle('save');
            TP.ui.shell.renderActive();
          },
        }]),
    }).then(function (chosen) {
      if (chosen === 'delete') return removeAlert(id);
      return chosen;
    });
  }

  function removeAlert(id) {
    TP.store.edit('Remove an alert', function (trip) {
      trip.criticalAlerts = (trip.criticalAlerts || []).filter(function (a) { return a.id !== id; });
    });
    TP.ui.shell.renderActive();
    return id;
  }

  function dayCard(day, index, total) {    var items = day.items || [];
    var head = r().el('div', { class: 'day__head' }, [
      r().el('span', { class: 'day__date', text: day.date ? TP.dates.fmtDateLong(day.date) : 'Day ' + (index + 1) }),
      r().el('span', { class: 'subtle', text: 'Day ' + (index + 1) + ' of ' + total }),
      r().el('span', { class: 'flex gap ml-auto' }, [
        r().button('↑', function () { moveDay(day.id, -1); }, { class: 'btn btn--ghost btn--sm', attrs: { title: 'Move this day earlier', 'aria-label': 'Move this day earlier' } }),
        r().button('↓', function () { moveDay(day.id, 1); }, { class: 'btn btn--ghost btn--sm', attrs: { title: 'Move this day later', 'aria-label': 'Move this day later' } }),
        r().button('Remove', function () { removeDay(day.id); }, { class: 'btn btn--ghost btn--sm' }),
      ]),
    ]);

    var card = r().el('div', { class: 'card day' }, [head]);

    // The day's own fields. They are the reason a day is more than a list.
    var details = r().el('div', { class: 'row' }, [
      dayTextField(day, 'title', 'Day title', 'Where you are and what the day is for'),
      dayTextField(day, 'stay', 'Stay', 'Where you sleep'),
    ]);
    r().append(card, details);
    r().append(card, r().el('div', { class: 'row' }, [
      dayTextField(day, 'drive', 'Drive', 'Distance and route'),
      dayTextField(day, 'chargeStops', 'Charge stops', ''),
    ]));
    r().append(card, r().el('div', { class: 'row' }, [
      dayTextField(day, 'nacs', 'NACS', ''),
      dayTextField(day, 'summary', 'Summary', ''),
    ]));
    r().append(card, listField(day, 'dining', 'Dining'));
    r().append(card, listField(day, 'tips', 'Tips'));

    r().append(card, r().el('hr'));

    if (!items.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Nothing planned for this day yet.' }));
    } else {
      items.forEach(function (item, i) {
        r().append(card, itemRow(day, item, i));
      });
    }

    r().append(card, r().el('div', { class: 'flex gap mt' }, [
      r().button('+ Add an item', function () { addItem(day.id); }, { class: 'btn btn--primary btn--sm' }),
      r().button('Paste a list', function () { pasteList(day.id); }, { class: 'btn btn--sm' }),
    ]));

    return card;
  }

  function dayTextField(day, field, label, placeholder) {
    var input = r().el('input', {
      class: 'input', type: 'text', value: day[field] || '',
      attrs: placeholder ? { placeholder: placeholder } : null,
    });
    input.addEventListener('change', function () {
      editDay(day.id, 'Change ' + label.toLowerCase(), function (d) { d[field] = input.value; });
    });
    return r().el('div', { class: 'field' }, [r().el('label', { text: label }), input]);
  }

  function listField(day, field, label) {
    var input = r().el('input', {
      class: 'input', type: 'text', value: (day[field] || []).join(', '),
      attrs: { placeholder: 'Separate with commas' },
    });
    input.addEventListener('change', function () {
      var list = input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      editDay(day.id, 'Change ' + label.toLowerCase(), function (d) { d[field] = list; });
    });
    return r().el('div', { class: 'field' }, [r().el('label', { text: label }), input]);
  }

  function itemRow(day, item, index) {
    var type = TP.model.itemType(item);
    var row = r().el('div', { class: 'item' }, [
      r().el('div', { class: 'item__time', text: item.time || '—' }),
      r().el('div', {}, [
        r().el('div', { class: 'item__title', text: item.title || 'Untitled' }),
        r().el('div', { class: 'item__meta' }, [
          r().el('span', { class: 'tag tag--' + type, text: type }),
          item.location ? ' · ' + item.location : '',
          item.cost != null && item.cost !== '' ? ' · ' + item.cost : '',
          item.durationMin ? ' · ' + TP.format.plural(item.durationMin, 'minute') : '',
        ]),
        item.notes ? r().el('div', { class: 'item__meta', text: item.notes }) : null,
        item.confirmation ? r().el('div', { class: 'item__meta', text: 'Confirmation: ' + item.confirmation }) : null,
        item.link ? safeLink(item.link) : null,
      ]),
      r().el('div', { class: 'flex gap' }, [
        r().button('↑', function () { moveItem(day.id, item.id, -1); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Move up' } }),
        r().button('↓', function () { moveItem(day.id, item.id, 1); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Move down' } }),
        r().button('Edit', function () { editItem(day.id, item.id); }, { class: 'btn btn--ghost btn--sm' }),
        r().button('Delete', function () { removeItem(day.id, item.id); }, { class: 'btn btn--ghost btn--sm' }),
      ]),
    ]);
    void index;
    return row;
  }

  // A link is only a link if its scheme is one of the three the app allows (REQ-704).
  function safeLink(href) {
    var target = TP.format.linkifyTarget(href);
    if (!target) return r().el('div', { class: 'item__meta', text: String(href) });
    return r().el('div', { class: 'item__meta' }, [
      r().el('a', { href: target, attrs: { rel: 'noopener noreferrer', target: '_blank' }, text: target }),
    ]);
  }

  // ---- Mutations ----

  function editDay(dayId, label, mutate) {
    TP.store.edit(label, function (trip) {
      var day = TP.model.findDay(trip, dayId);
      if (!day) return;
      mutate(day);
    });
    TP.ui.shell.renderAll();
  }

  function editItem(dayId, itemId) {
    var trip = TP.store.trip();
    var item = TP.model.findItem(trip, dayId, itemId);
    if (!item) return;

    var fields = {
      time: r().el('input', { class: 'input', type: 'text', value: item.time || '', attrs: { placeholder: 'HH:MM' } }),
      title: r().el('input', { class: 'input', type: 'text', value: item.title || '' }),
      type: r().el('select', { class: 'input' }, ['activity', 'transport', 'lodging', 'note'].map(function (t) {
        return r().el('option', { value: t, text: t, selected: (item.type || 'activity') === t });
      })),
      location: r().el('input', { class: 'input', type: 'text', value: item.location || '' }),
      cost: r().el('input', { class: 'input', type: 'text', value: item.cost == null ? '' : item.cost, attrs: { placeholder: '$20 or 20' } }),
      durationMin: r().el('input', { class: 'input', type: 'text', value: item.durationMin == null ? '' : item.durationMin }),
      confirmation: r().el('input', { class: 'input', type: 'text', value: item.confirmation || '' }),
      link: r().el('input', { class: 'input', type: 'text', value: item.link || '', attrs: { placeholder: 'https://…' } }),
      notes: r().el('textarea', { class: 'input', attrs: { rows: '3' } }),
    };
    fields.notes.value = item.notes || '';

    return TP.ui.modal.open({
      title: 'Edit item',
      body: [
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Time' }), fields.time]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Type' }), fields.type]),
        ]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'What' }), fields.title]),
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Where' }), fields.location]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Cost' }), fields.cost]),
        ]),
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Minutes' }), fields.durationMin]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Confirmation' }), fields.confirmation]),
        ]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Link' }), fields.link]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Notes' }), fields.notes]),
      ],
      defaultAction: 'save',
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'delete', label: 'Delete', danger: true },
        { id: 'save', label: 'Save' },
      ],
    }).then(function (id) {
      if (id === 'cancel' || !id) return null;
      if (id === 'delete') return removeItem(dayId, itemId);
      var duration = fields.durationMin.value.trim() === '' ? null : Number(fields.durationMin.value);
      if (duration != null && !isFinite(duration)) duration = null;
      TP.store.edit('Edit item', function (t) {
        var target = TP.model.findItem(t, dayId, itemId);
        if (!target) return;
        target.time = fields.time.value.trim() || null;
        // The raw string the file carried is a second spelling of the SAME wire slot (ledger:
        // `item.timeRaw`), so clearing the time clears it too. Leaving it behind would put the value
        // the person just deleted back on the wire: the exporter writes the raw when there is no
        // parsed time beside it, and the time would come back on the next import.
        if (!target.time) delete target.timeRaw;
        target.title = fields.title.value;
        target.type = fields.type.value;
        target.location = fields.location.value;
        target.cost = fields.cost.value.trim() === '' ? null : fields.cost.value.trim();
        target.durationMin = duration;
        target.confirmation = fields.confirmation.value;
        target.link = fields.link.value.trim();
        target.notes = fields.notes.value;
      });
      TP.ui.shell.renderAll();
      return itemId;
    });
  }

  function addItem(dayId) {
    var item = {
      id: TP.uid(),
      time: null,
      title: '',
      type: 'activity',
      location: '',
      cost: null,
      durationMin: null,
      confirmation: '',
      link: '',
      notes: '',
      flags: {},
    };
    TP.store.edit('Add an item', function (trip) {
      var day = TP.model.findDay(trip, dayId);
      if (day) day.items.push(item);
    });
    TP.ui.shell.renderAll();
    return editItem(dayId, item.id);
  }

  // A pasted list becomes items: one per line, "9:30 Breakfast" keeping its time.
  function pasteList(dayId) {
    return TP.ui.modal.prompt({
      title: 'Paste a list',
      body: r().el('p', { class: 'subtle', text: 'One item per line. A line that starts with a time keeps it.' }),
      multiline: true,
      rows: 8,
      placeholder: '9:30 Breakfast at the diner\n11:00 Lighthouse',
      okLabel: 'Add them',
    }).then(function (text) {
      if (!text || !text.trim()) return null;
      var lines = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      TP.store.edit('Paste a list', function (trip) {
        var day = TP.model.findDay(trip, dayId);
        if (!day) return;
        lines.forEach(function (line) {
          var m = /^(\d{1,2}:\d{2})\s+(.*)$/.exec(line);
          day.items.push({
            id: TP.uid(),
            time: m ? m[1] : null,
            title: m ? m[2] : line,
            type: 'activity',
            location: '',
            cost: null,
            durationMin: null,
            confirmation: '',
            link: '',
            notes: '',
            flags: {},
          });
        });
      });
      TP.ui.shell.renderAll();
      TP.ui.toast.ok(lines.length + (lines.length === 1 ? ' item added.' : ' items added.'));
      return lines.length;
    });
  }

  function moveItem(dayId, itemId, delta) {
    TP.store.edit('Reorder items', function (trip) {
      var day = TP.model.findDay(trip, dayId);
      if (!day) return;
      var i = day.items.findIndex(function (x) { return x.id === itemId; });
      var j = i + delta;
      if (i === -1 || j < 0 || j >= day.items.length) return;
      var tmp = day.items[i];
      day.items[i] = day.items[j];
      day.items[j] = tmp;
    });
    TP.ui.shell.renderAll();
  }

  function removeItem(dayId, itemId) {
    TP.store.edit('Remove an item', function (trip) {
      var day = TP.model.findDay(trip, dayId);
      if (!day) return;
      day.items = day.items.filter(function (x) { return x.id !== itemId; });
    });
    TP.ui.shell.renderAll();
    TP.ui.toast.info('Item removed. Undo puts it back.');
  }

  function moveDay(dayId, delta) {
    TP.store.edit('Reorder days', function (trip) {
      var days = trip.days || [];
      var i = days.findIndex(function (d) { return d.id === dayId; });
      var j = i + delta;
      if (i === -1 || j < 0 || j >= days.length) return;
      var tmp = days[i];
      days[i] = days[j];
      days[j] = tmp;
    });
    TP.ui.shell.renderAll();
  }

  function addDay() {
    TP.store.edit('Add a day', function (trip) {
      var last = (trip.days || [])[trip.days.length - 1];
      var date = last && last.date ? TP.dates.toISO(TP.dates.addDays(TP.dates.parseISO(last.date), 1)) : TP.dates.todayISO();
      trip.days = trip.days || [];
      trip.days.push({ id: TP.uid(), date: date, title: '', stay: '', drive: '', chargeStops: '', nacs: '', summary: '', dining: [], tips: [], items: [] });
      if (!trip.endDate || date > trip.endDate) trip.endDate = date;
    });
    TP.ui.shell.renderAll();
  }

  function removeDay(dayId) {
    var trip = TP.store.trip();
    var day = TP.model.findDay(trip, dayId);
    if (!day) return;
    var items = (day.items || []).length;

    var go = items
      ? TP.ui.modal.confirm({
        title: 'Remove this day?',
        body: r().el('p', { text: 'This day has ' + TP.format.plural(items, 'item') + ' in it, and they go with it. Undo will not bring them back — the removal is recorded as a commit, and History can revert it.' }),
        confirmLabel: 'Remove the day and its items',
        danger: true,
      })
      : Promise.resolve(true);

    return go.then(function (yes) {
      if (!yes) return null;
      TP.store.edit('Remove a day', function (t) {
        t.days = t.days.filter(function (d) { return d.id !== dayId; });
      });
      TP.ui.shell.renderAll();
      return dayId;
    });
  }

  // ---- Keeping days and dates in step ----

  // Called when the trip's dates change. Days are added for new dates. Days that fall outside
  // the range are only removed after asking, and only when they hold something.
  function resync() {
    var trip = TP.store.trip();
    if (!trip.startDate || !trip.endDate) return;

    var wanted = TP.dates.expandDays(trip.startDate, trip.endDate).map(function (d) { return d.date; });
    if (!wanted.length) return;
    var have = (trip.days || []).map(function (d) { return d.date; });
    var missing = wanted.filter(function (d) { return have.indexOf(d) === -1; });

    var outside = (trip.days || []).filter(function (d) {
      return d.date && wanted.indexOf(d.date) === -1;
    });
    var outsideWithItems = outside.filter(function (d) { return (d.items || []).length > 0; });
    var outsideEmpty = outside.filter(function (d) { return !(d.items || []).length; });

    function apply(removeIds) {
      TP.store.edit('Match days to the trip dates', function (t) {
        removeIds.forEach(function (id) {
          t.days = t.days.filter(function (d) { return d.id !== id; });
        });
        missing.forEach(function (date) {
          t.days.push({ id: 'day-' + date, date: date, title: '', stay: '', drive: '', chargeStops: '', nacs: '', summary: '', dining: [], tips: [], items: [] });
        });
        t.days.sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
      });
      TP.ui.shell.renderAll();
    }

    var emptyIds = outsideEmpty.map(function (d) { return d.id; });

    if (!outsideWithItems.length) { apply(emptyIds); return Promise.resolve(); }

    return TP.ui.modal.confirm({
      title: 'Days outside the new dates',
      body: r().el('div', {}, [
        r().el('p', { text: outsideWithItems.length + (outsideWithItems.length === 1
          ? ' day falls outside the trip\'s dates and has things planned on it: '
          : ' days fall outside the trip\'s dates and have things planned on them: ') +
          outsideWithItems.map(function (d) { return TP.dates.fmtDate(d.date); }).join(', ') + '.' }),
        r().el('p', { class: 'subtle', text: 'Keeping them leaves the itinerary intact. Removing them takes their items with them.' }),
      ]),
      confirmLabel: 'Remove them',
      cancelLabel: 'Keep them',
      danger: true,
    }).then(function (remove) {
      apply(remove ? emptyIds.concat(outsideWithItems.map(function (d) { return d.id; })) : emptyIds);
    });
  }

  return {
    render: render,
    editDay: editDay,
    editItem: editItem,
    addItem: addItem,
    addDay: addDay,
    removeDay: removeDay,
    removeItem: removeItem,
    moveItem: moveItem,
    moveDay: moveDay,
    pasteList: pasteList,
    resync: resync,
    alertsCard: alertsCard,
    addAlert: addAlert,
    removeAlert: removeAlert,
  };
})();
