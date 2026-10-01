// The shell: tabs, toolbar, and the one place that decides what is visible (specs/07-ui.md §1,
// §5).
//
// Gating is not a set of `if (isFile)` branches scattered through the views. It is a filter over
// one list (REQ-603): the tab list is computed, the panels are shown or hidden from the same
// answer, and a view never asks about the platform at all.

TP.ui.shell = (function () {
  'use strict';

  var R = null;

  // The full tab list, in order. `gate` names the reason a tab may be absent; the visibility
  // rule lives in `visible()` below, not here.
  var TABS = [
    { id: 'itinerary', label: 'Itinerary' },
    { id: 'checklists', label: 'Checklists' },
    { id: 'lodging', label: 'Lodging' },
    { id: 'bookings', label: 'Bookings' },
    { id: 'places', label: 'Places' },
    { id: 'charging', label: 'Charging', gate: 'ev' },
    { id: 'budget', label: 'Budget' },
    { id: 'ai', label: 'AI Planner', gate: 'ai' },
    { id: 'settings', label: 'Settings' },
  ];

  var PANEL_IDS = TABS.map(function (t) { return t.id; }).concat(['history']);

  var renderers = {};
  var active = 'itinerary';
  var historyOpen = false;

  function init() {
    R = TP.ui.render;
    buildTabs();
    wireToolbar();
    wireDrawer();
    wireKeys();
    reflectMode();
  }

  function registerView(id, render) {
    renderers[id] = render;
  }

  // ---- Visibility ----

  // The model's own rule, `!!(trip && trip.vehicle)` (specs/07-ui.md, REQ-609). A second, wider rule
  // here — charging networks or thresholds without a vehicle — showed a Charging tab for a trip the
  // tab itself then called "not an electric-vehicle trip", because the tab asks the model.
  function isEv(trip) {
    return TP.model.isEv(trip);
  }

  function visible(tab) {
    if (!tab.gate) return true;
    if (tab.gate === 'ai') return TP.environment.aiEnabled;
    if (tab.gate === 'ev') return isEv(TP.store.trip());
    return true;
  }

  function activeTabs() {
    return TABS.filter(visible);
  }

  function buildTabs() {
    var nav = R.byId('tabs');
    if (!nav) return;
    var trip = TP.store.trip();
    var tabs = activeTabs();

    R.mount(nav, tabs.map(function (t) {
      return R.el('button', {
        class: ['tab', t.id === active && !historyOpen ? 'tab--active' : ''],
        attrs: { role: 'tab', 'data-tab': t.id, 'aria-selected': t.id === active && !historyOpen ? 'true' : 'false' },
        on: { click: function () { setTab(t.id); } },
        text: t.label,
      });
    }));

    // A tab that is not offered must also be absent from the DOM's interactive surface, so
    // the panel is hidden and removed from the tablist rather than merely styled.
    PANEL_IDS.forEach(function (id) {
      var panel = R.byId('panel-' + id);
      if (!panel) return;
      var offered = id === 'history' ? historyOpen : tabs.some(function (t) { return t.id === id; });
      R.show(panel, offered && (id === 'history' ? historyOpen : id === active));
    });

    if (!tabs.some(function (t) { return t.id === active; })) {
      active = (tabs[0] || { id: 'settings' }).id;
    }
    refreshSaveStatus();
    void trip;
  }

  function setTab(id, options) {
    var opts = options || {};
    if (!opts.keepHistory) historyOpen = false;
    active = id;
    buildTabs();
    renderActive();
    // The earlier version mirrored the tab into `location.hash` for deep links. It is not here:
    // REQ-601 confines every use of `location` to the environment seam, and a convenience that
    // lives just outside a stated invariant is how the invariant stops being true.
    void opts;
  }

  function currentTab() { return historyOpen ? 'history' : active; }

  function openHistory() {
    historyOpen = true;
    buildTabs();
    renderActive();
  }

  function closeHistory() {
    historyOpen = false;
    buildTabs();
    renderActive();
  }

  // ---- Rendering ----

  function renderAll() {
    buildTabs();
    renderActive();
    renderSidebarFoot();
    // The document list is part of the chrome, so "render everything" includes it. Boot registers
    // this file in the registry before calling here, which is why the list is not empty on load.
    TP.ui.tripList.render();
  }

  function renderActive() {
    var id = currentTab();
    var fn = renderers[id];
    var panel = R.byId('panel-' + id);
    if (!panel) return;
    R.clear(panel);
    if (!fn) {
      R.append(panel, R.el('div', { class: 'empty' }, [
        R.el('h2', { text: 'This view is not available' }),
        R.el('p', { text: 'The part of the program that draws it did not load.' }),
      ]));
      return;
    }
    try {
      fn(panel);
    } catch (e) {
      R.clear(panel);
      R.append(panel, R.el('div', { class: 'empty' }, [
        R.el('h2', { text: 'This view could not be drawn' }),
        R.el('p', { text: (e && e.message) ? e.message : String(e) }),
      ]));
    }
  }

  // ---- Mode reflection (REQ-603, REQ-605) ----

  function reflectMode() {
    var env = TP.environment;

    // The callout. One sentence about what is limited and one about what is not, at the place
    // where a user would look for the missing feature.
    var note = R.byId('mode-note');
    if (note) {
      if (env.aiEnabled) {
        R.mount(note, []);
        R.show(note, false);
      } else {
        R.mount(note, [R.el('div', { class: 'info' }, [
          R.el('strong', { text: 'AI planning needs a web address. ' }),
          'This planner is running from a file on your disk, where the browser gives it no web ',
          'identity — so it cannot reach an AI service, and it will not store a service key ',
          'somewhere any other local file could read it. Open the same planner from ',
          R.el('code', { text: 'http(s)://' }),
          ' instead and the AI tab appears. Everything else — your itinerary, budget, bookings, ',
          'checklists, history, import and export — works exactly as it does here, from the file ',
          'on your disk.',
        ])]);
        R.show(note, true);
      }
    }

    // The tab title names the document, in the form the shell template declares (specs/02 §1):
    // app first, document after. The template's static title and this runtime one are the same
    // shape on purpose — a file that has been edited should not change what the tab is called.
    var trip = TP.store.trip();
    document.title = 'Trip Planner — ' + (trip ? TP.model.tripTitle(trip) : 'Untitled trip');

    renderSidebarFoot();
  }

  function renderSidebarFoot() {
    var foot = R.byId('storage-status');
    if (!foot) return;
    var status = TP.store.saveStatus();
    var parts = [];

    if (TP.store.isReadOnly()) {
      parts.push('Read-only');
    } else if (status.dirty) {
      parts.push('Unsaved changes');
    } else if (status.lastSavedAt) {
      parts.push('Saved locally');
    } else {
      parts.push('Not saved here yet');
    }

    if (status.storageKind === 'memory') parts.push('this session only');
    if (status.storageKind === 'null') parts.push('no local storage');

    R.mount(foot, [R.el('span', { class: 'muted', text: parts.join(' · ') })]);
    if (status.error) {
      R.append(foot, R.el('div', { class: 'muted', text: status.error }));
    }
  }

  function refreshSaveStatus() {
    var status = TP.store.saveStatus();

    var undoBtn = R.byId('undo-btn');
    var redoBtn = R.byId('redo-btn');
    if (undoBtn) undoBtn.disabled = !TP.store.canUndo();
    if (redoBtn) redoBtn.disabled = !TP.store.canRedo();

    var save = R.byId('save-status');
    if (save) {
      var label = TP.store.isReadOnly() ? 'Read-only'
        : status.dirty ? 'Unsaved'
        : status.lastSavedAt ? 'Saved' : 'Not saved here';
      R.mount(save, [R.el('span', { class: 'subtle', text: label })]);
    }

    var exportBtn = R.byId('export-btn');
    if (exportBtn) exportBtn.disabled = !TP.store.isInteractive();

    renderSidebarFoot();

    var banner = R.byId('persistence-note');
    if (banner) {
      if (status.note) {
        R.mount(banner, [R.el('div', { class: 'info info--warn', text: status.note })]);
        R.show(banner, true);
      } else {
        R.mount(banner, []);
        R.show(banner, false);
      }
    }
  }

  // ---- Toolbar ----

  function wireToolbar() {
    var map = {
      'undo-btn': function () { TP.store.undo(); renderAll(); },
      'redo-btn': function () { TP.store.redo(); renderAll(); },
      'history-btn': function () { openHistory(); },
      'new-trip-btn': function () { newTrip(); },
      'import-btn': function () { TP.ui.shell.importFile(); },
      'export-btn': function () { TP.ui.shell.exportDocument(); },
    };
    Object.keys(map).forEach(function (id) {
      var node = R.byId(id);
      if (node) node.addEventListener('click', map[id]);
    });

    var picker = R.byId('import-file');
    if (picker) {
      picker.addEventListener('change', function () {
        var file = picker.files && picker.files[0];
        picker.value = '';
        if (file) handlePickedFile(file);
      });
    }

    var storageBtn = R.byId('storage-status');
    if (storageBtn) {
      storageBtn.addEventListener('click', function () { showStorageDetail(); });
    }
  }

  function wireDrawer() {
    var app = R.byId('app');
    var menu = R.byId('menu-btn');
    var backdrop = R.byId('drawer-backdrop');
    function setOpen(open) {
      if (!app) return;
      if (open) app.classList.add('app--drawer-open');
      else app.classList.remove('app--drawer-open');
      if (menu) menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (backdrop) R.show(backdrop, open);
    }
    if (menu) menu.addEventListener('click', function () { setOpen(!app.classList.contains('app--drawer-open')); });
    if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
    TP.ui.shell.closeDrawer = function () { setOpen(false); };
  }

  function wireKeys() {
    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) TP.store.redo(); else TP.store.undo();
        renderAll();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        var res = TP.store.commit('Manual save');
        if (!res || !res.ok) {
          TP.ui.toast.warn((res && res.reason) || 'Nothing could be saved.');
          renderAll();
          return;
        }
        // A commit with nothing new in it answers `noop` without going near storage, so "the commit
        // succeeded" is not the same question as "the document is on disk" — and the last save may
        // have failed (a writer conflict, a quota, a document with no identity). Ask the store what
        // happened before saying "Saved.": a green toast over unwritten work is the one lie this
        // app must not tell (PAT-INV-01, REQ-405).
        var saved = res.saved || TP.store.save();
        if (saved && saved.ok) TP.ui.toast.ok('Saved.');
        else TP.ui.toast.warn((saved && (saved.reason || saved.message)) || 'Nothing could be written.');
        renderAll();
      }
    });
  }

  // ---- Actions that need the shell's regions ----

  function newTrip() {
    TP.ui.tripEditor.createTrip().then(function (trip) {
      if (!trip) return;
      TP.ui.tripList.addAndOpen(trip);
      setTab('itinerary');
      renderAll();
      TP.ui.toast.ok('New trip created.');
    });
  }

  function importFile() {
    var picker = R.byId('import-file');
    if (picker) picker.click();
  }

  function handlePickedFile(file) {
    TP.io.import.readFile(file).then(function (result) {
      if (!result.ok) {
        TP.ui.toast.error(result.reason || 'That file could not be read.');
        return;
      }
      return TP.ui.reconcile.acceptImport(result);
    }).catch(function (e) {
      TP.ui.toast.error('That file could not be read: ' + (e && e.message ? e.message : e));
    });
  }

  function exportDocument() {
    TP.ui.tripEditor.exportDialog();
  }

  function showStorageDetail() {
    var status = TP.store.saveStatus();
    var storage = TP.store.storage();
    var bytes = storage && storage.bytesUsed ? storage.bytesUsed() : 0;
    R.mount(R.byId('modal-host'), []);
    TP.ui.modal.notice({
      title: 'Where this document is kept',
      body: [
        R.el('div', { class: 'info', text: storage && storage.describe ? storage.describe() : 'Nothing can be saved locally.' }),
        R.el('dl', { class: 'kv' }, [
          R.el('dt', { text: 'Storage used' }),
          R.el('dd', { text: TP.format.fmtNumber(bytes) + ' bytes' }),
          R.el('dt', { text: 'Last saved here' }),
          R.el('dd', { text: status.lastSavedAt ? TP.dates.fmtDateLong(status.lastSavedAt.slice(0, 10)) : 'not yet' }),
          R.el('dt', { text: 'Document' }),
          R.el('dd', { text: TP.store.docIdOf(TP.store.container()) || 'unsaved' }),
        ]),
        R.el('p', { class: 'subtle mt', text:
          'This copy is a cache. The file you exported is the document, and this browser may ' +
          'forget its copy at any time — clearing site data, or simply never opening this page ' +
          'again, loses nothing you have exported.' }),
      ],
    });
  }

  return {
    TABS: TABS,
    PANEL_IDS: PANEL_IDS,
    init: init,
    registerView: registerView,
    visible: visible,
    activeTabs: activeTabs,
    isEv: isEv,
    buildTabs: buildTabs,
    setTab: setTab,
    currentTab: currentTab,
    openHistory: openHistory,
    closeHistory: closeHistory,
    historyOpen: function () { return historyOpen; },
    renderAll: renderAll,
    renderActive: renderActive,
    reflectMode: reflectMode,
    refreshSaveStatus: refreshSaveStatus,
    renderSidebarFoot: renderSidebarFoot,
    newTrip: newTrip,
    importFile: importFile,
    handlePickedFile: handlePickedFile,
    exportDocument: exportDocument,
    showStorageDetail: showStorageDetail,
    closeDrawer: function () {},
  };
})();
