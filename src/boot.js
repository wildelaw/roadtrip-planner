// Boot (specs/02-architecture.md §6, REQ-612, PAT-INV-14).
//
// The order below is the whole design, and it is not a preference:
//
//   0. Capture the pristine copy of the page. This MUST be first — it is the export's source of
//      truth, and anything that runs before it would be captured into every file the user makes.
//   1. Read the container out of the data block.
//   2. Check the history's integrity. A broken chain is discovered here, before the UI exists,
//      so there is no moment where the app is interactive over a document it cannot vouch for.
//   3. Choose storage. The choice depends on step 2: an unverified document gets the null adapter
//      and cannot be written to at all.
//   4. Reconcile what the file carries against what this browser has stored.
//   5. Only now is the UI interactive.
//
// The UI is not interactive before reconcile completes (REQ-612). Running reconcile against a
// half-initialised store is the failure PAT-INV-14 names, and it is the reason this is a boot
// sequence rather than a series of listener callbacks.

TP.boot = (function () {
  'use strict';

  function start() {
    // ---- 0. Pristine, before anything else touches the document ----
    TP.io.export.capturePristine();

    var report = { step: 'container', ok: false, notes: [] };

    try {
      run(report);
    } catch (e) {
      fatal(report, e);
    }
  }

  function run(report) {
    // ---- 1. The container ----
    var container;
    try {
      container = TP.container.read();
    } catch (e) {
      return fatal(report, e, 'The document could not be read');
    }
    report.step = 'integrity';
    report.notes.push('Read a ' + TP.container.FORMAT + ' document.');

    // A file written by a newer version is readable but not fully understood. Opening it
    // read-only is the honest outcome: opening it writable would let one save strip out whatever
    // this version does not know about (REQ-212).
    var formatOk = TP.container.isReadableFormat(container.format);
    if (!formatOk) {
      report.notes.push('Written by a newer version of the planner (' + container.format + ').');
    }

    // ---- 2. Integrity ----
    var chain = TP.verify.chain(container.history);
    if (!chain.ok) {
      var first = (chain.errors && chain.errors[0]) || null;
      report.notes.push('The history does not hold together: ' +
        (first ? TP.verify.shortId(first.commitId) + ' ' + first.problem : 'no reason was recorded') + '.');
    } else {
      report.notes.push(TP.verify.label(chain) + '.');
    }

    var readOnly = !chain.ok || !formatOk;

    // ---- 3. Storage ----
    report.step = 'storage';
    var storage;
    if (readOnly) {
      // The null adapter: reads nothing, and throws on every write. A broken document is not
      // "repaired" and never written back — that would destroy the evidence and the user's copy
      // at the same time (REQ-320).
      storage = TP.storage.create('null');
    } else {
      // localStorage, or an in-memory stand-in when the browser refuses it — see ADR-0012 and
      // storage/adapter.js. Whichever it lands on, every operation still reaches a correct
      // outcome (REQ-403), and the user is told which one they got.
      storage = TP.storage.choose();
    }

    // ---- 4. Store and reconcile ----
    report.step = 'reconcile';
    TP.store.init(container, storage, {
      readOnly: readOnly,
      persistenceNote: readOnly
        ? 'This document is open read-only: its history does not hold together, so nothing will be written to it or to this browser.'
        : null,
    });

    var plan = TP.store.reconcileLocal();
    report.notes.push(describePlan(plan));
    report.ok = true;
    report.plan = plan;

    // ---- 5. Interactive ----
    boot(container, storage, readOnly, plan, report);
  }

  function describePlan(plan) {
    if (!plan) return 'Nothing was stored here for this document.';
    if (plan.action === TP.merge.IDENTICAL) return 'This browser has no newer copy of this document.';
    if (plan.action === TP.merge.FAST_FORWARD) return 'The stored copy was behind the file, so the file is current.';
    if (plan.action === TP.merge.ADOPT) return 'The file is the current version.';
    if (plan.action === TP.merge.KEEP_LOCAL) return 'The stored copy had work the file did not, so it was adopted.';
    if (plan.action === TP.merge.SEPARATE) return 'The stored copy belongs to a different document and was left alone.';
    if (plan.action === TP.merge.DIVERGED) return 'This file and the stored copy have both changed.';
    return '';
  }

  function boot(container, storage, readOnly, plan, report) {
    var R = TP.ui.render;

    // Every view registers itself here, in one place, so a missing view is a missing line rather
    // than a mystery about load order.
    TP.ui.shell.registerView('itinerary', TP.ui.itineraryDay.render);
    TP.ui.shell.registerView('checklists', TP.ui.checklists.render);
    TP.ui.shell.registerView('lodging', TP.ui.lodging.render);
    TP.ui.shell.registerView('bookings', TP.ui.bookings.render);
    TP.ui.shell.registerView('places', TP.ui.places.render);
    TP.ui.shell.registerView('charging', TP.ui.charging.render);
    TP.ui.shell.registerView('budget', TP.ui.budget.render);
    TP.ui.shell.registerView('ai', TP.ui.aiPanel.render);
    TP.ui.shell.registerView('settings', TP.ui.settingsView.render);
    TP.ui.shell.registerView('history', TP.ui.history.render);

    TP.ui.tripList.init();
    TP.ui.shell.init();

    // The status chrome follows the store. The ACTIVE VIEW is deliberately not re-rendered here:
    // the autosave commits ~1s after the last keystroke, and re-rendering on that would replace
    // the input the user is typing in, mid-word.
    TP.store.onChange(function (what) {
      TP.ui.shell.refreshSaveStatus();
      if (what === 'commit' && !editingInSidebar()) TP.ui.tripList.render();
    });

    // Seed the registry from this file. The registry follows the files rather than leading them
    // (REQ-405): opening a document is what puts it in the list, every time.
    if (!readOnly && storage && storage.available()) {
      var docId = TP.store.docIdOf(container);
      if (docId) {
        TP.registry.register(storage, {
          docId: docId,
          title: TP.model.tripTitle(TP.store.trip()),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    TP.ui.shell.reflectMode();
    TP.ui.shell.renderAll();

    // Divergence is the one outcome the store cannot settle by itself, so it is asked here —
    // before the UI is interactive, since the alternative is a user editing a document whose
    // history is about to be replaced under them.
    if (plan && plan.action === TP.merge.DIVERGED) {
      TP.ui.reconcile.applyDivergence(plan).then(function () {
        TP.ui.shell.renderAll();
        interactive(report);
      });
    } else {
      interactive(report);
    }
  }

  function editingInSidebar() {
    var active = document.activeElement;
    var sidebar = TP.ui.render.byId('trip-search');
    return !!(active && sidebar && (active === sidebar || sidebar.contains(active)));
  }

  function interactive(report) {
    TP.store.setInteractive(true);
    TP.ui.shell.refreshSaveStatus();

    if (TP.store.isReadOnly()) {
      // Sticky: read-only is a property of the whole session, not an event that just happened.
      TP.ui.toast.warn('Opened read-only. Export to get a copy you can edit.', { ms: 0 });
    } else if (report && report.notes.length) {
      // One quiet line at the bottom of the sidebar rather than a dialog: the boot outcome is
      // worth being able to find, not worth interrupting someone to read.
      var foot = TP.ui.render.byId('storage-status');
      if (foot) TP.ui.render.append(foot, TP.ui.render.el('div', { class: 'muted', text: report.notes.join(' ') }));
    }
  }

  // A boot failure is not a crash screen. The document could not be read, so there is nothing to
  // show — and the app says exactly that, plus what to do, rather than rendering a blank page.
  function fatal(report, e, title) {
    TP.store.setInteractive(false);
    var message = (e && e.message) ? e.message : String(e);
    var host = document.getElementById('panel-itinerary') || document.body;
    var R = TP.ui.render;

    R.mount(host, [R.el('div', { class: 'empty' }, [
      R.el('h2', { text: title || 'This document could not be opened' }),
      R.el('p', { text: message }),
      R.el('p', { class: 'subtle', text: 'Nothing was changed, and nothing was written to this browser. The file on your disk is untouched — if it came from somewhere you do not trust, closing it and opening a copy you made yourself is the safe move.' }),
      R.el('p', { class: 'subtle', text: 'A file made by a newer version of the planner cannot be opened by this one. Open it with the version it was made with to export a copy this one can read.' }),
    ])]);

    var note = document.getElementById('mode-note');
    if (note) R.mount(note, []);
    void report;
  }

  return {
    start: start,
    describePlan: describePlan,
  };
})();

TP.boot.start();
