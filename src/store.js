// The document store: the one place that holds the container, the working payload, and the
// relationship between them.
//
// Three ideas hold this together:
//
//   * The WORKING payload is what the UI edits. It may differ from the head commit; that is
//     what "unsaved" means.
//
//   * A COMMIT is a deliberate boundary. Undo and redo move within the working payload and
//     therefore stop at the last commit — which is exactly the promise the UI makes when it
//     says "undo" (REQ-315). Reversing a committed change is a different, more deliberate act:
//     History → revert, which writes a FORWARD commit so that nothing is ever destroyed.
//
//   * Persistence is a cache of the file, never its owner (PAT-INV-01). Saving is best-effort
//     and its failure is disclosed; the document in the user's hand is unaffected.

TP.store = (function () {
  'use strict';

  var MAX_UNDO = 50;
  var AUTOSAVE_MS = 900;

  var state = {
    container: null,
    storage: null,
    readOnly: false,
    interactive: false,
    working: null,      // the payload being edited
    dirty: false,
    holding: false,     // true while a grouped operation owns the commit boundary
    undo: [],
    redo: [],
    lastSavedAt: null,
    saveError: null,
    persistenceNote: null,
  };

  var listeners = [];
  var autosaveTimer = null;
  var pendingMessage = null;

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  function emit(what) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](what || 'change'); } catch (e) { /* one view's failure is not the store's */ }
    }
  }

  // ---- Lifecycle ----

  function init(container, storage, options) {
    var opts = options || {};
    state.container = container;
    state.storage = storage;
    state.readOnly = !!opts.readOnly;
    state.interactive = false;
    state.working = TP.model.clone(TP.container.payloadTrip(container) || TP.model.newTrip());
    state.dirty = false;
    state.holding = false;
    state.undo = [];
    state.redo = [];
    state.saveError = null;
    state.lastSavedAt = null;
    state.persistenceNote = opts.persistenceNote || describeStorage(storage);
  }

  // Adopt a document AFTER boot, completing the transition `init` deliberately leaves open.
  //
  // `init` resets `interactive` to false because boot calls it fourth and reconcile runs fifth
  // (REQ-612): the UI must not be live over a document whose own history has not been checked yet,
  // and boot re-arms the flag itself once the sequence finishes or the divergence is settled.
  //
  // Every later swap — the registry's row, New Trip, opening a file — has already done its own
  // integrity check synchronously by the time it reaches the store, so there is no window left to
  // protect: the store holds a document it can vouch for the moment `init` returns. Leaving the
  // flag where `init` put it greyed every control gated on it for the rest of the session, which
  // is exactly what the Export button did after opening a second trip from the sidebar.
  function openDocument(container, storage, options) {
    init(container, storage, options);
    state.interactive = true;
  }

  function describeStorage(storage) {
    if (!storage) return null;
    if (storage.downgraded) return storage.describe();
    if (!storage.available()) return storage.describe ? storage.describe() : 'Nothing can be saved locally.';
    return null;
  }

  function container() { return state.container; }
  function storage() { return state.storage; }
  function isReadOnly() { return state.readOnly; }
  function isInteractive() { return state.interactive; }
  function setInteractive(v) { state.interactive = !!v; }

  function history() { return state.container.history; }
  function head() { return state.container.history.head; }
  function trip() { return state.working; }
  function payload() { return { trip: state.working }; }
  function isDirty() { return state.dirty; }

  function commits() { return state.container.history.commits; }

  function headCommit() {
    var h = head();
    return h ? TP.history.find(state.container.history, h) : null;
  }

  // The payload at head, reconstructed rather than remembered — the same path verification
  // and export use, so there is only one answer to "what does this document say".
  function committedPayload() {
    return TP.history.headPayload(state.container.history);
  }

  // ---- Editing ----

  function snapshotForUndo() {
    state.undo.push(TP.model.clone(state.working));
    if (state.undo.length > MAX_UNDO) state.undo.shift();
    state.redo.length = 0;
  }

  // Apply a mutation to the working payload. `label` is what the eventual commit will say, so
  // a group of edits made together lands as one honest line in the history.
  function edit(label, mutate) {
    if (state.readOnly) return { ok: false, reason: 'This document is open read-only.' };
    var next = TP.model.clone(state.working);
    mutate(next);

    // A mutation that changed nothing is not an edit, and saying it was one has consequences beyond
    // the flag: the document is left looking dirty, the autosave runs, and an agent that accomplished
    // nothing reports a change and asks for a commit. The comparison is CANONICAL, so key order and
    // number formatting do not count as a change — the same rule `commit` uses to avoid an empty line
    // in the history. The case this exists for is a mutator that refuses: `ai/tools.js` reports a day
    // it could not find by returning an error WITHOUT touching the trip, and before this the store
    // marked the copy dirty anyway.
    if (TP.canonical.serialize(next) === TP.canonical.serialize(state.working)) {
      return { ok: true, unchanged: true };
    }

    snapshotForUndo();
    state.working = next;
    state.dirty = true;
    pendingMessage = label || pendingMessage || 'Edit';
    scheduleAutosave();
    emit('edit');
    return { ok: true };
  }

  // Replace the whole trip (import, AI proposal, revert). One undo step, one commit.
  function replaceTrip(label, nextTrip) {
    if (state.readOnly) return { ok: false, reason: 'This document is open read-only.' };
    snapshotForUndo();
    state.working = TP.model.clone(nextTrip);
    state.dirty = true;
    pendingMessage = label || 'Replace trip';
    scheduleAutosave();
    emit('edit');
    return { ok: true };
  }

  function undo() {
    if (!state.undo.length) return { ok: false, reason: 'Nothing to undo since the last commit.' };
    state.redo.push(TP.model.clone(state.working));
    state.working = state.undo.pop();
    state.dirty = true;
    pendingMessage = 'Undo';
    scheduleAutosave();
    emit('edit');
    return { ok: true };
  }

  function redo() {
    if (!state.redo.length) return { ok: false, reason: 'Nothing to redo.' };
    state.undo.push(TP.model.clone(state.working));
    state.working = state.redo.pop();
    state.dirty = true;
    pendingMessage = 'Redo';
    scheduleAutosave();
    emit('edit');
    return { ok: true };
  }

  function canUndo() { return state.undo.length > 0; }
  function canRedo() { return state.redo.length > 0; }

  // ---- Committing ----

  function scheduleAutosave() {
    if (state.holding) return;                       // a long operation owns the commit boundary
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      commit(pendingMessage || 'Edit', { automatic: true });
    }, AUTOSAVE_MS);
  }

  // Hold the autosave open so a group of edits lands as ONE commit. The AI agent takes forty turns
  // to produce one thing the user asked for; forty lines in the history would be a lie about what
  // happened, and Cmd-Z would have to be pressed forty times to undo it. The holder MUST release,
  // including on failure — hence the try/finally in `TP.ai.agent`, not just a happy path.
  function holdCommits() {
    state.holding = true;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }

  function releaseCommits() {
    state.holding = false;
    if (state.dirty) scheduleAutosave();
  }

  function commit(message, options) {
    var opts = options || {};
    if (state.readOnly) return { ok: false, reason: 'This document is open read-only.' };
    if (!state.dirty) return { ok: true, noop: true };

    var payload = { trip: state.working };

    // A commit identical to its parent would be an empty line in the history. The check is
    // canonical, so reformatting alone is not a change.
    var parentPayload = committedPayload();
    if (parentPayload && TP.canonical.serialize(parentPayload) === TP.canonical.serialize(payload)) {
      state.dirty = false;
      state.undo.length = 0;
      return { ok: true, noop: true };
    }

    var result = TP.history.append(state.container.history, payload, {
      docId: docIdOf(state.container),
      author: currentAuthor(),
      timestamp: new Date().toISOString(),
      message: message || 'Edit',
    });
    if (!result || result.ok === false) {
      return { ok: false, reason: (result && result.reason) || 'The change could not be recorded.' };
    }

    state.container.history = result.history;
    state.container.payload = payload;
    state.dirty = false;
    state.undo.length = 0;
    state.redo.length = 0;
    pendingMessage = null;

    var saved = save({ silent: !!opts.automatic });
    emit('commit');
    return { ok: true, commit: result.commit, saved: saved };
  }

  function revertTo(commitId, message) {
    if (state.readOnly) return { ok: false, reason: 'This document is open read-only.' };
    var target = TP.history.find(state.container.history, commitId);
    if (!target) return { ok: false, reason: 'That commit is not in this document.' };
    var payload = TP.history.reconstruct(state.container.history, commitId);
    if (!payload) return { ok: false, reason: 'That commit could not be reconstructed, so nothing was changed.' };

    // Forward, never backward (REQ-311): the change is recorded as a new commit, so the
    // history that was reverted from is still there to revert back to.
    snapshotForUndo();
    state.working = TP.model.clone(payload.trip);
    state.dirty = true;
    var res = commit(message || ('Revert to ' + TP.verify.shortId(commitId)));
    return res;
  }

  function docIdOf(cont) {
    var cs = (cont.history && cont.history.commits) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i].docId) return cs[i].docId;
    return (cont.payload && cont.payload.trip && cont.payload.trip.docId) || null;
  }

  function currentAuthor() {
    var settings = readSettings();
    return settings.author || { name: 'You', email: '' };
  }

  function readSettings() {
    if (!state.storage) return {};
    try { return state.storage.get(TP.storage.SETTINGS_KEY) || {}; } catch (e) { return {}; }
  }

  function writeSettings(patch) {
    if (!state.storage) return {};
    var current = readSettings();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) current[k] = patch[k];
    try { state.storage.set(TP.storage.SETTINGS_KEY, current); } catch (e) { /* settings are a convenience */ }
    return current;
  }

  // ---- Persistence ----

  function save(options) {
    var opts = options || {};
    if (state.readOnly) return { ok: false, reason: 'read-only' };
    if (!state.storage || !state.storage.available()) {
      state.persistenceNote = state.storage ? state.storage.describe() : 'Nothing can be saved locally.';
      if (!opts.silent) emit('save-failed');
      return { ok: false, reason: 'unavailable' };
    }
    var docId = docIdOf(state.container);
    if (!docId) return { ok: false, reason: 'This document has no identity yet.' };
    try {
      var res = TP.registry.writeDocument(state.storage, state.container);
      if (!res.ok) {
        state.saveError = res.message || 'Another copy of the planner is writing to this document.';
        emit('save-failed');
        return res;
      }
      TP.registry.register(state.storage, {
        docId: docId,
        title: TP.model.tripTitle(state.working),
        updatedAt: new Date().toISOString(),
      });
      state.lastSavedAt = new Date().toISOString();
      state.saveError = null;
      if (!opts.silent) emit('saved');
      return { ok: true };
    } catch (e) {
      state.saveError = e && e.message ? e.message : String(e);
      if (e && e.quota) state.persistenceNote = state.saveError;
      if (!opts.silent) emit('save-failed');
      return { ok: false, reason: state.saveError, quota: !!(e && e.quota) };
    }
  }

  function saveStatus() {
    return {
      lastSavedAt: state.lastSavedAt,
      error: state.saveError,
      note: state.persistenceNote,
      dirty: state.dirty,
      storageKind: state.storage ? state.storage.kind() : 'null',
    };
  }

  // ---- Opening ----

  // Reconcile the container carried by the file with whatever this browser has stored for the
  // same document. Ordering is decided by ancestry; the clock is never consulted (PAT-INV-08).
  //
  // Every outcome other than DIVERGED is applied here, because every other outcome is a
  // statement about ancestry that needs no one's permission. DIVERGED is returned to the
  // caller, which must ask: there is no way to choose between two lines of history that does
  // not discard someone's work.
  function reconcileLocal() {
    if (!state.storage || !state.storage.available()) return { action: TP.merge.IDENTICAL };
    var docId = docIdOf(state.container);
    if (!docId || !TP.registry.hasLocal(state.storage, docId)) return { action: TP.merge.IDENTICAL };

    var local = TP.registry.localHistory(state.storage, docId);
    var localHistory = {
      keyframeInterval: local.keyframeInterval || TP.history.KEYFRAME_INTERVAL,
      head: local.head,
      commits: local.commits,
    };
    var plan = TP.merge.plan(
      { history: state.container.history, docId: docId },
      { history: localHistory, docId: docId }
    );

    if (plan.action === TP.merge.DIVERGED) return plan;

    if (plan.action === TP.merge.KEEP_LOCAL) {
      // This browser's copy has commits the file does not. Adopting it keeps that work; the
      // next export writes it into a file. Nothing is deleted either way.
      adopt(localHistory);
      return { action: plan.action, reason: 'the stored copy has work the file does not', adopted: true };
    }

    if (plan.action === TP.merge.SEPARATE) {
      // The stored history belongs to a different document that happens to share an id, or has
      // nothing in common with this one. It is left exactly where it is.
      return { action: plan.action, reason: plan.reason };
    }

    // ADOPT and IDENTICAL and FAST_FORWARD all mean the file is the document of record.
    // Touching the store for any of them would be a write with nothing to say.
    return plan;
  }

  function adopt(localHistory) {
    state.container.history = localHistory;
    var payload = TP.history.headPayload(localHistory);
    if (payload) {
      state.container.payload = payload;
      state.working = TP.model.clone(payload.trip);
    }
  }

  // Compaction (REQ-319, REQ-318), reached from Settings.
  //
  // It is NOT `adopt`. `adopt` exists to take on a history that arrived from somewhere else, and it
  // re-derives the working trip from that history's head — which is right when the file is the
  // document of record and wrong here, because compaction changes no content and the working copy may
  // hold edits that have not been committed yet. Deriving the trip again would silently discard them,
  // and "silently discards work" is the one outcome this app refuses everywhere else.
  //
  // The history is replaced; the payload, the working copy, the undo stack and the dirty flag are all
  // left exactly as they were, because none of them is a storage representation. `removeOrphans` is
  // the only argument, and it defaults to false: PAT-INV-05 puts discarding unreachable commits behind
  // an explicit informed confirmation, so the caller that wants it has to say so.
  function compactHistory(options) {
    var opts = options || {};
    if (state.readOnly) return { ok: false, reason: 'This document is open read-only.' };
    var result = TP.history.compact(state.container.history, { removeOrphans: !!opts.removeOrphans });
    state.container.history = result.history;
    emit('compact');
    return { ok: true, report: result.report };
  }

  // What compaction WOULD do, without doing it. The dialog needs the numbers before the person
  // decides, and the numbers have to be the ones the action would produce — so this asks
  // `TP.history.compact` the same question, through the same function, and reads its report. A dialog
  // that estimated "about this much" and then did something else would be a dialog nobody could check.
  function planCompaction(options) {
    var opts = options || {};
    return TP.history.compact(state.container.history, { removeOrphans: !!opts.removeOrphans }).report;
  }

  function newDocument() {
    var docId = TP.uid();
    // `newTrip` takes an options object, not a bare id. Passing the id positionally left the
    // placeholder trip's `docId` as '', so a document minted here had no identity: `docIdOf` found
    // nothing, every commit was written with an empty `docId`, `verify.chain` reported "no docId"
    // and `save` refused the document outright (03-data-model.md §"New Trip", REQ-301).
    var trip = TP.model.newTrip({ docId: docId });
    var history = TP.history.newHistory();
    var container = TP.container.create({ trip: trip }, buildInfo(), history);
    init(container, state.storage, { readOnly: false });
    return container;
  }

  function buildInfo() {
    return {
      appVersion: declaredMeta('app-version'),
      appHash: declaredMeta('app-hash'),
      generatedAt: new Date().toISOString(),
    };
  }

  function declaredMeta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : '';
  }

  return {
    MAX_UNDO: MAX_UNDO,
    AUTOSAVE_MS: AUTOSAVE_MS,
    onChange: onChange,
    emit: emit,
    init: init,
    openDocument: openDocument,
    container: container,
    holdCommits: holdCommits,
    releaseCommits: releaseCommits,
    storage: storage,
    isReadOnly: isReadOnly,
    isInteractive: isInteractive,
    setInteractive: setInteractive,
    history: history,
    head: head,
    headCommit: headCommit,
    commits: commits,
    trip: trip,
    payload: payload,
    isDirty: isDirty,
    committedPayload: committedPayload,
    edit: edit,
    replaceTrip: replaceTrip,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    commit: commit,
    revertTo: revertTo,
    save: save,
    saveStatus: saveStatus,
    reconcileLocal: reconcileLocal,
    readSettings: readSettings,
    writeSettings: writeSettings,
    newDocument: newDocument,
    compactHistory: compactHistory,
    planCompaction: planCompaction,
    docIdOf: docIdOf,
    buildInfo: buildInfo,
  };
})();
