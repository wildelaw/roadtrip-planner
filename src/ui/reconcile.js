// Reconciliation and import decisions (specs/04-versioning.md §5, specs/06 §2).
//
// Both of the dialogs in this file exist because a program cannot make the choice honestly:
// when two lines of history have diverged, or when a file's content would replace what is on
// screen, the user is the only one who knows which version they meant. Neither dialog has a
// default that discards anything.

TP.ui.reconcile = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  // ---- Two copies of the same document that have both moved on ----

  function applyDivergence(plan) {
    var options = TP.merge.optionsFor(plan);
    var base = plan.base ? TP.history.find(TP.store.history(), plan.base) : null;

    var radios = [];
    var body = [
      r().el('div', { class: 'info info--warn' }, [
        r().el('strong', { text: 'This file and the copy in this browser have both changed.' }),
        r().el('div', { text: 'Neither is a later version of the other — they are two lines of history. ' +
          'Whichever you choose, the other is left alone on disk or in storage; nothing is deleted.' }),
      ]),
      base ? r().el('p', { class: 'subtle', text: 'They last agreed at ' + TP.verify.shortId(plan.base) + ' — “' + (base.message || 'Edit') + '”, ' + TP.ui.history.when(base.timestamp) + '.' }) : null,
      r().el('div', { class: 'field' }, options.map(function (o) {
        var radio = r().el('input', { type: 'radio', name: 'reconcile', value: o.id, checked: o.id === options[0].id });
        radios.push(radio);
        return r().el('label', { class: 'flex gap items-start mb-sm' }, [
          radio,
          r().el('span', {}, [r().el('strong', { text: o.label }), r().el('div', { class: 'subtle', text: o.hint })]),
        ]);
      })),
    ];

    // The dialog resolves with the ACTION, not the form (modal.open), so the selection has to be
    // read off the radios when it is answered. Capturing `options[0].id` before opening it — which
    // is what this did — made the first option the only one that could ever be applied: choosing
    // "Take the file" and pressing the button silently kept this browser's copy instead.
    function chosenId() {
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
      return options.length ? options[0].id : null;
    }

    return TP.ui.modal.open({
      title: 'Two versions of this document',
      dismissible: false,
      body: body,
      defaultAction: 'apply',
      actions: [
        { id: 'apply', label: 'Use this choice' },
        { id: 'readonly', label: 'Open read-only' },
      ],
    }).then(function (id) {
      if (id === 'apply') {
        var chosen = chosenId();
        applyChoice(plan, chosen);
        return { ok: true, choice: chosen };
      }
      return { ok: true, choice: 'read-only', readOnly: true };
    });
  }

  function applyChoice(plan, choiceId) {
    if (choiceId === 'take-file') {
      // The file becomes the new head, recorded as a merge commit with the local work as the
      // second parent — so the local line is still reachable rather than abandoned.
      var localHead = TP.store.head();
      var result = TP.history.merge(TP.store.history(), TP.store.payload(), [localHead], {
        docId: TP.store.docIdOf(TP.store.container()),
        author: { name: 'You', email: '' },
        timestamp: new Date().toISOString(),
        message: 'Merge: took the file, kept this browser’s history',
      });
      if (result && result.history) {
        TP.store.container().history = result.history;
        TP.store.save();
        TP.ui.toast.ok('The file’s version is now current. Your other line is still in the history.');
      }
      return;
    }
    // keep-local: nothing changes. Saying so out loud is the point.
    TP.ui.toast.info('This browser’s version stays as it is. The file is untouched; export to write a new one.');
    void plan;
  }

  // ---- Import ----

  function acceptImport(result) {
    if (!result || !result.ok) {
      TP.ui.toast.error((result && result.reason) || 'That file could not be read.');
      return Promise.resolve(null);
    }
    if (result.format === 'artifact') return acceptDocument(result);
    return acceptData(result);
  }

  // A planner document opens as itself. It is not merged into the trip on screen: two trips
  // are two documents, and one of them is about to be replaced on screen — the file on disk
  // is untouched either way.
  function acceptDocument(result) {
    var chain = TP.verify.chain(result.container.history);
    var payloadCheck = TP.verify.payload(result.container.history);

    var body = [
      r().el('p', { text: TP.io.import.describe(result) }),
      r().el('dl', { class: 'kv' }, [
        r().el('dt', { text: 'Document' }), r().el('dd', { text: TP.store.docIdOf(result.container) || 'none recorded' }),
        r().el('dt', { text: 'Format' }), r().el('dd', { text: String(result.container.format) }),
        r().el('dt', { text: 'Made with' }), r().el('dd', { text: (result.container.build && result.container.build.appVersion) || 'unknown' }),
      ]),
      chain.ok
        ? r().el('div', { class: 'info', text: 'Its chain is intact' + (payloadCheck.ok ? ' and its contents rebuild exactly.' : ', though its contents could not be rebuilt.') })
        : r().el('div', { class: 'info info--danger', text: 'Its history does not hold together: ' +
          ((chain.errors[0] && TP.verify.shortId(chain.errors[0].commitId) + ' ' + chain.errors[0].problem) || 'no reason recorded') +
          '. It will be opened read-only, and nothing will be written to your storage.' }),
    ];

    var incompatible = result.container.format && !TP.container.isReadableFormat(result.container.format);
    if (incompatible) {
      body.push(r().el('div', { class: 'info info--warn', text:
        'This file was made by a newer version of the planner (format ' + result.container.format +
        ', and this app reads up to ' + TP.container.FORMAT + '). It will be opened read-only so ' +
        'that opening it cannot quietly strip out something you cannot see.' }));
    }

    var current = TP.store.docIdOf(TP.store.container());
    if (current && current === TP.store.docIdOf(result.container)) {
      body.push(r().el('p', { class: 'subtle', text: 'This is the same document you have open. Opening it again replaces what is on screen with the file’s version.' }));
    } else {
      body.push(r().el('p', { class: 'subtle', text: 'Opening it replaces what is on screen. The document you have now is not lost — it is still in this browser and in whatever file you exported.' }));
    }

    return TP.ui.modal.open({
      title: 'Open this document?',
      body: body,
      defaultAction: 'open',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'open', label: 'Open it' }],
    }).then(function (id) {
      if (id !== 'open') return null;
      var readOnly = !chain.ok || incompatible;
      var storage = readOnly
        ? TP.storage.create('null')
        : TP.store.storage();
      TP.store.init(result.container, storage, { readOnly: readOnly });
      if (!readOnly && storage && storage.available()) {
        TP.registry.register(storage, {
          docId: TP.store.docIdOf(result.container),
          title: TP.model.tripTitle(TP.container.payloadTrip(result.container)),
          updatedAt: new Date().toISOString(),
        });
      }
      var plan = readOnly ? { action: TP.merge.IDENTICAL } : TP.store.reconcileLocal();
      TP.ui.shell.reflectMode();
      TP.ui.shell.renderAll();
      if (plan.action === TP.merge.DIVERGED) return applyDivergence(plan).then(function () { return id; });

      if (readOnly) {
        TP.ui.toast.warn('Opened read-only. Export to get a copy you can edit.');
      } else {
        TP.ui.toast.ok('Opened ' + TP.model.tripTitle(TP.store.trip()) + '.');
      }
      return id;
    });
  }

  // Trip data and calendars carry a trip, not a document. The default is a NEW document
  // (REQ-616): a file someone sent you is its own trip, and dropping it into the document you
  // have open would attach it to a history it never belonged to. Replacing or adding are both
  // offered, and both are things the user asks for rather than things that happen.
  function acceptData(result) {
    var trip = result.trip;
    var days = (trip.days || []).length;
    var items = countItems(trip);

    var body = [
      r().el('p', { text: TP.io.import.describe(result) }),
      r().el('dl', { class: 'kv' }, [
        r().el('dt', { text: 'Dates' }), r().el('dd', { text: (trip.startDate || 'unstated') + ' → ' + (trip.endDate || 'unstated') }),
        r().el('dt', { text: 'Days' }), r().el('dd', { text: String(days) }),
        r().el('dt', { text: 'Items' }), r().el('dd', { text: String(items) }),
      ]),
    ];

    if (result.losses && result.losses.length) {
      body.push(r().el('div', { class: 'info', text: 'This format cannot carry: ' +
        result.losses.map(function (l) { return l.field; }).join(', ') +
        '. What it did carry arrives in full.' }));
    }
    if (result.blocked && result.blocked.length) {
      body.push(r().el('div', { class: 'info info--warn', text: result.blocked.length +
        ' entr' + (result.blocked.length === 1 ? 'y was' : 'ies were') + ' left out because ' +
        (result.blocked.length === 1 ? 'it has' : 'they have') + ' no date: ' +
        result.blocked.map(function (b) { return b.title || b.id; }).join(', ') + '.' }));
    }

    body.push(r().el('p', { class: 'subtle', text: 'Opening it on its own leaves the trip you have exactly as it is, and gives the imported one a history of its own.' }));

    return TP.ui.modal.open({
      title: 'What should happen to this trip?',
      body: body,
      defaultAction: 'new-document',
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'new-document', label: 'Open it on its own' },
        { id: 'add', label: 'Add it to this trip' },
        { id: 'replace', label: 'Replace this trip', danger: true },
      ],
    }).then(function (id) {
      if (id === 'cancel' || !id) return null;
      if (id === 'new-document') return openAsNewDocument(trip);
      if (id === 'replace') return replaceTrip(trip);
      return addTrip(trip);
    });
  }

  function openAsNewDocument(trip) {
    TP.store.newDocument();
    TP.store.replaceTrip('Import ' + (trip.title || 'a trip'), trip);
    var res = TP.store.commit('Import ' + (trip.title || 'a trip'));
    TP.ui.tripList.render();
    TP.ui.shell.renderSidebarFoot();
    TP.ui.shell.reflectMode();
    TP.ui.shell.renderAll();
    TP.ui.toast.ok(res && res.ok
      ? 'Opened as its own document. Export it to make a file that carries it.'
      : 'Opened as its own document.');
    return 'new-document';
  }

  function replaceTrip(incoming) {
    var current = TP.store.trip();
    return TP.ui.modal.confirm({
      title: 'Replace the trip on screen?',
      body: r().el('div', {}, [
        r().el('p', { text: '“' + TP.model.tripTitle(current) + '” is replaced by “' + TP.model.tripTitle(incoming) + '”.' }),
        r().el('p', { class: 'subtle', text: 'The replacement is recorded as a commit, so History can put the old trip back. It is not deleted.' }),
      ]),
      confirmLabel: 'Replace it',
      danger: true,
    }).then(function (yes) {
      if (!yes) return null;
      TP.store.replaceTrip('Replace with ' + (incoming.title || 'imported trip'), incoming);
      TP.store.commit('Import ' + (incoming.title || 'a trip'));
      TP.ui.shell.renderSidebarFoot();
      TP.ui.shell.reflectMode();
      TP.ui.shell.renderAll();
      TP.ui.toast.ok('Replaced. History has the previous trip if you want it back.');
      return 'replace';
    });
  }

  // Adding means: days that already exist in the range gain the incoming items; days outside
  // it are appended. Nothing already on screen is removed, and nothing is overwritten.
  function addTrip(incoming) {
    var before = countItems(TP.store.trip());
    TP.store.edit('Add an imported ' + (incoming.title || 'trip'), function (trip) {
      var byDate = Object.create(null);
      (trip.days || []).forEach(function (d) { if (d.date) byDate[d.date] = d; });

      (incoming.days || []).forEach(function (day) {
        var target = day.date ? byDate[day.date] : null;
        if (!target) {
          var copy = TP.model.clone(day);
          copy.id = TP.uid();
          (copy.items || []).forEach(function (i) { i.id = TP.uid(); });
          trip.days = trip.days || [];
          trip.days.push(copy);
          if (day.date) byDate[day.date] = copy;
          return;
        }
        // An existing day keeps its own words; only the incoming items are added, and each
        // gets a fresh id so it can be undone and removed on its own.
        (day.items || []).forEach(function (item) {
          var copy = TP.model.clone(item);
          copy.id = TP.uid();
          target.items.push(copy);
        });
      });

      if (!trip.startDate || (incoming.startDate && incoming.startDate < trip.startDate)) trip.startDate = incoming.startDate || trip.startDate;
      if (!trip.endDate || (incoming.endDate && incoming.endDate > trip.endDate)) trip.endDate = incoming.endDate || trip.endDate;

      (trip.days || []).sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
    });
    TP.store.commit('Import ' + (incoming.title || 'a trip'));

    var added = countItems(TP.store.trip()) - before;
    TP.ui.shell.reflectMode();
    TP.ui.shell.renderAll();
    TP.ui.toast.ok(added > 0
      ? 'Added ' + TP.format.plural(added, 'item') + ' to this trip.'
      : 'Nothing new to add — this trip already has all of it.');
    return 'add';
  }

  function countItems(trip) {
    return (trip.days || []).reduce(function (n, d) { return n + (d.items || []).length; }, 0);
  }

  return {
    applyDivergence: applyDivergence,
    applyChoice: applyChoice,
    acceptImport: acceptImport,
    acceptDocument: acceptDocument,
    acceptData: acceptData,
    openAsNewDocument: openAsNewDocument,
    replaceTrip: replaceTrip,
    addTrip: addTrip,
    countItems: countItems,
  };
})();
