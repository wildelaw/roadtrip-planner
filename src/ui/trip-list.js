// The trip list in the sidebar (specs/07-ui.md §3).
//
// This lists documents this browser has SEEN, held in the registry. It is a convenience index,
// not a library: each row is a pointer, and removing a row removes the pointer and says so.
// The document itself is the file the user has, and the app never deletes that.

TP.ui.tripList = (function () {
  'use strict';

  var R = null;
  var query = '';

  function init() {
    R = TP.ui.render;
    var search = R.byId('trip-search');
    if (search) {
      search.addEventListener('input', function () {
        query = search.value || '';
        render(R.byId('trip-list'));
      });
    }
  }

  function entries() {
    var storage = TP.store.storage();
    if (!storage || !storage.available()) return [];
    var reg = TP.registry.load(storage);
    var q = query.trim().toLowerCase();
    var rows = reg.docs;
    if (q) rows = rows.filter(function (d) { return String(d.title || '').toLowerCase().indexOf(q) !== -1; });
    return rows;
  }

  function render(root) {
    R = R || TP.ui.render;
    var node = root || R.byId('trip-list');
    if (!node) return;

    var storage = TP.store.storage();
    if (!storage || !storage.available()) {
      R.mount(node, [R.el('p', { class: 'muted', text:
        'This browser is not keeping a list of trips. Open a document from a file each time.' })]);
      return;
    }

    var rows = entries();
    if (!rows.length) {
      R.mount(node, [R.el('p', { class: 'muted', text: query
        ? 'No trips match that search.'
        : 'No documents have been opened here yet. Use Import to open one, or New Trip to start.' })]);
      return;
    }

    var currentDoc = TP.store.docIdOf(TP.store.container());
    R.mount(node, rows.map(function (doc) {
      var isCurrent = doc.docId === currentDoc;
      // An entry can outlive the copy this browser kept — every load re-seeds the index from the
      // file, so a name is here from the moment a file is opened, before anything has been written.
      // The row says which it is rather than guessing (REQ-405, REQ-406: a stale entry is not an
      // error, and an entry is never deleted on the user's behalf).
      var held = TP.registry.hasLocal(storage, doc.docId);
      return R.el('button', {
        class: ['trip-item', isCurrent ? 'trip-item--active' : '', held ? '' : 'trip-item--absent'],
        attrs: { type: 'button' },
        on: { click: function () { openLocal(doc.docId); } },
      }, [
        R.el('div', { class: 'trip-item__title', text: doc.title || 'Untitled trip' }),
        R.el('div', { class: 'trip-item__meta', text: !held
          ? 'not kept in this browser — open its file'
          : doc.updatedAt
            ? TP.dates.fmtDate(doc.updatedAt.slice(0, 10))
            : 'not opened since' }),
      ]);
    }));
  }

  // Opening from the list opens THIS BROWSER'S copy, which may lag the file on disk. Saying so
  // is the whole difference between a cache and a lie (PAT-INV-01).
  function openLocal(docId) {
    var storage = TP.store.storage();
    if (!storage || !storage.available()) {
      TP.ui.toast.warn('This browser is not keeping local copies, so that document cannot be reopened from here. Open its file instead.');
      return;
    }
    var local = TP.registry.localHistory(storage, docId);
    if (!local.commits.length) {
      // The entry is left alone. It is an index row, not a record, and this app does not delete
      // the user's reminders for them — Settings has "Forget this entry" for that, deliberately.
      var doc = TP.registry.entry(storage, docId);
      TP.ui.modal.notice({
        title: 'This browser has no copy of that document',
        body: [
          R.el('p', { text: 'The list remembers “' + ((doc && doc.title) || 'that trip') + '” from a file you opened here, ' +
            'but nothing about it was ever written into this browser — so there is nothing to reopen from here.' }),
          R.el('p', { class: 'subtle', text: 'Open the document’s file (Import) to work on it. It is the copy that matters, and this list will pick it up again when you do.' }),
          R.el('p', { class: 'subtle', text: 'To remove the name from the list, use “Forget this entry” in Settings → Documents this browser has seen.' }),
        ],
      });
      return;
    }

    var chain = TP.verify.chain(local);
    if (!chain.ok) {
      var first = (chain.errors && chain.errors[0]) || null;
      TP.ui.modal.notice({
        title: 'This copy has a broken history',
        body: [R.el('p', { text: 'The copy of this document in this browser does not hold together: ' +
          (first ? 'commit ' + TP.verify.shortId(first.commitId) + ' ' + first.problem : 'no reason was recorded') + '.' }),
          R.el('p', { class: 'subtle', text: 'The app will not open it and will not repair it. Open the document\'s file instead — the file is the copy that matters.' })],
      });
      return;
    }

    var payload = TP.history.headPayload(local);
    var container = TP.container.create(payload, TP.store.buildInfo(), local);
    TP.store.init(container, storage);
    TP.registry.touch(storage, docId);
    TP.ui.shell.reflectMode();
    TP.ui.shell.renderAll();
    TP.ui.toast.info('Opened from this browser\'s copy. Export to write a file that carries it.');
  }

  function addAndOpen(trip) {
    var container = TP.store.newDocument();
    // `newDocument` mints the document identity and carries it on the placeholder trip; the editor's
    // trip is the content that replaces it. The identity has to move across with it, because
    // `docIdOf` reads the commits first and the payload trip second — and there are no commits yet.
    // Without this the new document has no identity at all: the commit is written with an empty
    // `docId`, `verify.chain` reports "no docId", `save` refuses it, and the trip is lost on reload
    // (03-data-model.md §"New Trip", REQ-301).
    trip.docId = TP.store.docIdOf(container) || TP.uid();
    container.payload = { trip: trip };
    var res = TP.history.append(container.history, container.payload, {
      docId: trip.docId,
      author: { name: 'You', email: '' },
      timestamp: new Date().toISOString(),
      message: 'New trip',
    });
    if (res && res.history) container.history = res.history;
    TP.store.init(container, TP.store.storage());
    TP.store.commit('New trip');
    render();
  }

  return {
    init: init,
    render: render,
    entries: entries,
    openLocal: openLocal,
    addAndOpen: addAndOpen,
  };
})();
