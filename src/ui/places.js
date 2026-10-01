// Places: the bucket list, and a library of locations with their activities
// (specs/03 §2.4).
//
// The bridge worth having: an activity on a location can be dropped onto a day, which creates
// an itinerary item. That is the moment a plan becomes a schedule, and it is the reason
// locations are stored rather than merely noted.

TP.ui.places = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function render(root) {
    var trip = TP.store.trip();

    r().append(root, r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'Places' })]),
      r().el('p', { class: 'subtle mb0', text:
        'The bucket list is what you hope to do. Locations are the places you have looked into, ' +
        'with the things worth doing there — and anything on a location can be dropped onto a day.' }),
    ]));

    r().append(root, bucketCard(trip));
    r().append(root, locationsCard(trip));
  }

  // ---- Bucket list ----

  function bucketCard(trip) {
    var rows = trip.bucketList || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Bucket list' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'idea') : 'Nothing yet' }),
      ]),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'Anything you would like to do, whether or not it fits the dates yet.' }));
    } else {
      r().append(card, r().el('div', { class: 'chips' }, rows.map(function (b) {
        return r().el('span', { class: 'chip' }, [
          b.name || 'Untitled',
          b.dateLabel || b.date
            ? r().el('span', { class: 'subtle', text: '· ' + (b.dateLabel || TP.dates.fmtDate(b.date)) })
            : null,
          r().button('+ day', function () { addToDay(trip, { title: b.name, kind: 'activity' }); }, {
            class: 'btn--ghost', attrs: { title: 'Add this to a day', 'aria-label': 'Add this to a day' },
          }),
          r().button('Edit', function () { editBucket(b.id); }, { class: 'btn--ghost' }),
          r().button('×', function () { removeBucket(b.id); }, { class: 'btn--ghost', attrs: { 'aria-label': 'Remove this idea' } }),
        ]);
      })));
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add an idea', function () { editBucket(null); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  function editBucket(id) {
    var existing = id ? TP.model.findIn(TP.store.trip().bucketList, id) : { name: '', date: null, dateLabel: '' };
    var fields = {
      name: r().el('input', { class: 'input', type: 'text', value: existing.name || '', attrs: { placeholder: 'See the northern lights' } }),
      date: r().el('input', { class: 'input', type: 'date', value: existing.date || '' }),
      dateLabel: r().el('input', { class: 'input', type: 'text', value: existing.dateLabel || '', attrs: { placeholder: 'Someday, or "next autumn"' } }),
    };
    var error = r().el('div', { class: 'subtle mt' });

    return TP.ui.modal.open({
      title: id ? 'Edit idea' : 'Add an idea',
      body: [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'What' }), fields.name]),
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Around a date' }), fields.date]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Or in words' }), fields.dateLabel]),
        ]),
        error,
      ],
      defaultAction: 'save',
      actions: (id ? [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', danger: true }] : [{ id: 'cancel', label: 'Cancel' }])
        .concat([{
          id: 'save',
          label: 'Save',
          run: function (settle) {
            if (!fields.name.value.trim()) { error.textContent = 'Something to do is needed.'; return; }
            TP.store.edit(id ? 'Edit an idea' : 'Add an idea', function (trip) {
              var row = id ? TP.model.findIn(trip.bucketList, id) : null;
              if (!row) {
                row = { id: TP.uid() };
                trip.bucketList = trip.bucketList || [];
                trip.bucketList.push(row);
              }
              row.name = fields.name.value.trim();
              if (fields.date.value) row.date = fields.date.value; else delete row.date;
              if (fields.dateLabel.value.trim()) row.dateLabel = fields.dateLabel.value.trim(); else delete row.dateLabel;
            });
            settle('save');
            TP.ui.shell.renderActive();
          },
        }]),
    }).then(function (chosen) {
      if (chosen === 'delete') return removeBucket(id);
      return chosen;
    });
  }

  function removeBucket(id) {
    TP.store.edit('Remove an idea', function (trip) {
      trip.bucketList = (trip.bucketList || []).filter(function (b) { return b.id !== id; });
    });
    TP.ui.shell.renderActive();
    return id;
  }

  // ---- Locations ----

  function locationsCard(trip) {
    var rows = trip.locations || [];
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Locations' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'place') : 'Nothing yet' }),
      ]),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'A place you have looked into: where you might stay, what to eat, what to do.' }));
    } else {
      rows.forEach(function (loc) {
        r().append(card, locationBlock(trip, loc));
      });
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add a location', function () { editLocation(null); }, { class: 'btn btn--primary btn--sm' }),
    ]));
    return card;
  }

  function locationBlock(trip, loc) {
    var activities = loc.activities || [];
    var block = r().el('div', { class: 'sect-sep' }, [
      r().el('div', { class: 'card__head mb0' }, [
        r().el('h2', { text: (loc.icon ? loc.icon + ' ' : '') + (loc.name || 'Untitled place') }),
        r().el('span', { class: 'flex gap ml-auto' }, [
          r().button('Edit', function () { editLocation(loc.id); }, { class: 'btn btn--ghost btn--sm' }),
          r().button('Delete', function () { removeLocation(loc.id); }, { class: 'btn btn--ghost btn--sm' }),
        ]),
      ]),
      loc.summary ? r().el('p', { class: 'subtle', text: loc.summary }) : null,
      loc.lodging ? r().el('div', { class: 'subtle', text: 'Staying: ' + loc.lodging }) : null,
      (loc.charging || []).length ? r().el('div', { class: 'subtle', text: 'Charging: ' + loc.charging.join(', ') }) : null,
      (loc.dining || []).length ? r().el('div', { class: 'subtle', text: 'Eating: ' + loc.dining.join(', ') }) : null,
    ]);

    if (activities.length) {
      var list = r().el('div', { class: 'loc__activities' });
      activities.forEach(function (act) {
        r().append(list, r().el('div', { class: 'loc__act' }, [
          r().el('span', { class: 'loc__act-type', text: act.type || 'activity' }),
          r().el('span', { class: 'flex-1' }, [
            r().el('strong', { text: act.name || '' }),
            act.desc ? r().el('div', { class: 'subtle', text: act.desc }) : null,
          ]),
          r().button('+ day', function () { addToDay(trip, { title: act.name, notes: act.desc || '', location: loc.name }); }, {
            class: 'btn btn--sm', attrs: { title: 'Add this to a day' },
          }),
        ]));
      });
      r().append(block, list);
    }

    return block;
  }

  function editLocation(id) {
    var trip = TP.store.trip();
    var existing = id ? TP.model.findIn(trip.locations, id) : {
      id: TP.uid(), name: '', icon: '', summary: '', lodging: '', charging: [], dining: [], activities: [],
    };
    var fields = {
      name: r().el('input', { class: 'input', type: 'text', value: existing.name || '', attrs: { placeholder: 'Osaka' } }),
      icon: r().el('input', { class: 'input', type: 'text', value: existing.icon || '', attrs: { placeholder: '📍' } }),
      summary: r().el('textarea', { class: 'input', attrs: { rows: '2' } }),
      lodging: r().el('input', { class: 'input', type: 'text', value: existing.lodging || '' }),
      charging: r().el('input', { class: 'input', type: 'text', value: (existing.charging || []).join(', '), attrs: { placeholder: 'Separate with commas' } }),
      dining: r().el('input', { class: 'input', type: 'text', value: (existing.dining || []).join(', '), attrs: { placeholder: 'Separate with commas' } }),
      activities: r().el('textarea', { class: 'input', attrs: { rows: '5', placeholder: 'Name | type | description — one per line' } }),
    };
    fields.summary.value = existing.summary || '';
    // Activities are edited as lines rather than as a sub-form: it keeps a nested list from
    // needing a nested dialog, and the format is the one the old app already wrote.
    fields.activities.value = (existing.activities || []).map(function (a) {
      return [a.name || '', a.type || '', a.desc || ''].join(' | ');
    }).join('\n');

    var error = r().el('div', { class: 'subtle mt' });

    return TP.ui.modal.open({
      title: id ? 'Edit location' : 'Add a location',
      body: [
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Name' }), fields.name]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Icon' }), fields.icon]),
        ]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Summary' }), fields.summary]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Where you might stay' }), fields.lodging]),
        r().el('div', { class: 'row' }, [
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Charging' }), fields.charging]),
          r().el('div', { class: 'field' }, [r().el('label', { text: 'Eating' }), fields.dining]),
        ]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Things to do' }), fields.activities]),
        error,
      ],
      defaultAction: 'save',
      actions: (id ? [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', danger: true }] : [{ id: 'cancel', label: 'Cancel' }])
        .concat([{
          id: 'save',
          label: 'Save',
          run: function (settle) {
            if (!fields.name.value.trim()) { error.textContent = 'A name is needed.'; return; }
            var activities = fields.activities.value.split('\n').map(function (line) {
              var parts = line.split('|').map(function (s) { return s.trim(); });
              if (!parts[0]) return null;
              var act = { name: parts[0] };
              if (parts[1]) act.type = parts[1];
              if (parts[2]) act.desc = parts[2];
              return act;
            }).filter(Boolean);

            TP.store.edit(id ? 'Edit a location' : 'Add a location', function (t) {
              var row = id ? TP.model.findIn(t.locations, id) : null;
              if (!row) {
                row = { id: existing.id };
                t.locations = t.locations || [];
                t.locations.push(row);
              }
              row.name = fields.name.value.trim();
              if (fields.icon.value.trim()) row.icon = fields.icon.value.trim(); else delete row.icon;
              if (fields.summary.value.trim()) row.summary = fields.summary.value; else delete row.summary;
              if (fields.lodging.value.trim()) row.lodging = fields.lodging.value.trim(); else delete row.lodging;
              row.charging = splitList(fields.charging.value);
              row.dining = splitList(fields.dining.value);
              row.activities = activities;
            });
            settle('save');
            TP.ui.shell.renderActive();
          },
        }]),
    }).then(function (chosen) {
      if (chosen === 'delete') return removeLocation(id);
      return chosen;
    });
  }

  function splitList(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function removeLocation(id) {
    var loc = TP.model.findIn(TP.store.trip().locations, id);
    return TP.ui.modal.confirm({
      title: 'Delete this location?',
      body: r().el('p', { text: '“' + ((loc && loc.name) || 'This place') + '” and its list of things to do will be removed. History can put it back.' }),
      confirmLabel: 'Delete',
      danger: true,
    }).then(function (yes) {
      if (!yes) return null;
      TP.store.edit('Delete a location', function (trip) {
        trip.locations = (trip.locations || []).filter(function (l) { return l.id !== id; });
      });
      TP.ui.shell.renderActive();
      return id;
    });
  }

  // ---- The bridge: a place's idea becomes an itinerary item ----

  function addToDay(trip, spec) {
    var days = trip.days || [];
    if (!days.length) {
      TP.ui.toast.warn('This trip has no days yet. Set its dates first.');
      return Promise.resolve(null);
    }

    var select = r().el('select', { class: 'input' }, days.map(function (d, i) {
      return r().el('option', {
        value: d.id,
        text: 'Day ' + (i + 1) + ' — ' + TP.dates.fmtDate(d.date) + (d.title ? ' · ' + d.title : ''),
      });
    }));
    var time = r().el('input', { class: 'input', type: 'text', attrs: { placeholder: 'HH:MM (optional)' } });

    return TP.ui.modal.open({
      title: 'Add to a day',
      body: [
        r().el('p', { class: 'subtle', text: spec.title || '' }),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Which day' }), select]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Time' }), time]),
      ],
      defaultAction: 'add',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'add', label: 'Add it' }],
    }).then(function (id) {
      if (id !== 'add') return null;
      TP.store.edit('Add a place to a day', function (t) {
        var day = TP.model.findDay(t, select.value);
        if (!day) return;
        day.items = day.items || [];
        day.items.push({
          id: TP.uid(),
          time: time.value.trim() || null,
          title: spec.title || 'Untitled',
          type: spec.kind || 'activity',
          location: spec.location || '',
          cost: null,
          durationMin: null,
          confirmation: '',
          link: '',
          notes: spec.notes || '',
          flags: {},
        });
      });
      TP.ui.shell.renderActive();
      TP.ui.toast.ok('Added to the itinerary.');
      return select.value;
    });
  }

  return {
    render: render,
    editBucket: editBucket,
    removeBucket: removeBucket,
    editLocation: editLocation,
    removeLocation: removeLocation,
    addToDay: addToDay,
  };
})();
