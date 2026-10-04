// The registry and document persistence (specs/05-storage.md §3–§8).
//
// The registry is a CONVENIENCE, never an authority (PAT-AP-09): it is re-seeded from files
// on every load, deleting an entry never deletes a document, and an empty registry means
// "no documents have been opened here" — never data loss.

TP.registry = (function () {
  'use strict';

  var WRITER_STALE_MS = 5 * 60 * 1000;
  var MAX_COMMITS_PER_DOC = 20000;

  // One id per tab, so two tabs detect each other (§7).
  var INSTANCE = 'i-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function instanceId() { return INSTANCE; }

  // ---- The registry index ----

  function load(adapter) {
    var raw = adapter.get(TP.storage.REGISTRY_KEY);
    if (!raw || typeof raw !== 'object') return { version: 1, docs: [] };
    var docs = Array.isArray(raw.docs) ? raw.docs : [];
    return {
      version: 1,
      docs: docs
        .filter(function (d) { return d && typeof d.docId === 'string'; })
        .map(function (d) {
          return {
            docId: d.docId,
            title: typeof d.title === 'string' ? d.title : 'Untitled trip',
            updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
            lastPath: d.lastPath == null ? null : d.lastPath,
          };
        }),
    };
  }

  function save(adapter, reg) {
    adapter.set(TP.storage.REGISTRY_KEY, {
      version: 1,
      docs: (reg && reg.docs) || [],
    });
  }

  function entry(adapter, docId) {
    var reg = load(adapter);
    for (var i = 0; i < reg.docs.length; i++) if (reg.docs[i].docId === docId) return reg.docs[i];
    return null;
  }

  // Opening a document writes its registry entry. The registry follows the files; it does
  // not lead them (REQ-405).
  function register(adapter, info) {
    var reg = load(adapter);
    var found = null;
    for (var i = 0; i < reg.docs.length; i++) {
      if (reg.docs[i].docId === info.docId) { found = reg.docs[i]; break; }
    }
    if (found) {
      found.title = info.title || found.title;
      found.updatedAt = info.updatedAt || found.updatedAt;
      if (info.lastPath !== undefined) found.lastPath = info.lastPath;
    } else {
      reg.docs.push({
        docId: info.docId,
        title: info.title || 'Untitled trip',
        updatedAt: info.updatedAt || null,
        lastPath: info.lastPath == null ? null : info.lastPath,
      });
    }
    reg.docs.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    save(adapter, reg);
    return reg;
  }

  // Removing an entry removes an index row. The document is a file the app may no longer be
  // able to see; it is not the app's to delete (REQ-406).
  function removeEntry(adapter, docId) {
    var reg = load(adapter);
    reg.docs = reg.docs.filter(function (d) { return d.docId !== docId; });
    save(adapter, reg);
    return reg;
  }

  // ---- Document persistence ----

  function readMeta(adapter, docId) {
    var m = adapter.get(TP.storage.metaKey(docId));
    if (!m || typeof m !== 'object') return null;
    return {
      format: m.format || null,
      head: m.head || null,
      lastOpenedAt: m.lastOpenedAt || null,
      writer: m.writer && typeof m.writer === 'object' ? m.writer : null,
    };
  }

  function localHistory(adapter, docId) {
    var keys = adapter.keys(TP.storage.commitPrefix(docId));
    var commits = [];
    for (var i = 0; i < keys.length; i++) {
      var c = adapter.get(keys[i]);
      if (c && typeof c === 'object') commits.push(c);
    }
    var meta = readMeta(adapter, docId);
    return {
      docId: docId,
      head: meta ? meta.head : null,
      commits: commits,
      keyframeInterval: (meta && meta.keyframeInterval) || TP.history.KEYFRAME_INTERVAL,
    };
  }

  function hasLocal(adapter, docId) {
    return adapter.keys(TP.storage.commitPrefix(docId)).length > 0;
  }

  // Write ordering (PAT-INV-13, REQ-407): commits first, then the pointer. An interruption
  // leaves unreferenced commits — waste, not corruption. The inverse ordering is the natural
  // one to write and it makes a cancelled save look like a corrupt document forever after.
  function writeDocument(adapter, container, options) {
    var opts = options || {};
    var docId = container.history && container.history.commits.length
      ? container.history.commits[0].docId
      : opts.docId;
    if (!docId) throw new Error('registry: the container does not identify a document');

    var check = claimWriter(adapter, docId, opts.force);
    if (!check.ok) return check;

    var commits = (container.history && container.history.commits) || [];
    if (commits.length > MAX_COMMITS_PER_DOC) {
      throw new TP.storage.QuotaError('This document has ' + commits.length +
        ' commits, beyond the ' + MAX_COMMITS_PER_DOC + ' this app will store locally.');
    }
    for (var i = 0; i < commits.length; i++) {
      adapter.set(TP.storage.commitKey(docId, commits[i].id), commits[i]);
    }
    adapter.set(TP.storage.metaKey(docId), {
      format: container.format,
      head: container.history ? container.history.head : null,
      keyframeInterval: (container.history && container.history.keyframeInterval) || TP.history.KEYFRAME_INTERVAL,
      lastOpenedAt: new Date().toISOString(),
      writer: { instanceId: INSTANCE, at: new Date().toISOString() },
    });
    return { ok: true };
  }

  // Delete ordering (PAT-INV-13): pointer first, then the commits. Interrupted, this leaves
  // orphans rather than a dangling head.
  //
  // It is only ever reached through an explicit, informed confirmation (REQ-318): no quota
  // path, no corruption path, and no "obviously unreachable" cleanup calls it.
  function forget(adapter, docId) {
    adapter.del(TP.storage.metaKey(docId));
    var keys = adapter.keys(TP.storage.commitPrefix(docId));
    for (var i = 0; i < keys.length; i++) adapter.del(keys[i]);
  }

  // ---- Concurrency (§7) ----

  function claimWriter(adapter, docId, force) {
    var meta = readMeta(adapter, docId);
    if (!meta || !meta.writer || !meta.writer.instanceId) return { ok: true };
    if (meta.writer.instanceId === INSTANCE) return { ok: true };
    var at = Date.parse(meta.writer.at || '');
    var recent = isFinite(at) && (Date.now() - at) < WRITER_STALE_MS;
    if (!recent || force) return { ok: true };
    return {
      ok: false,
      conflict: true,
      message: 'Another copy of this planner (' + meta.writer.instanceId + ') wrote to this document ' +
        'in the last few minutes. Writing now would overwrite its work without either of you ' +
        'noticing. Reload that tab first, or confirm here to write anyway.',
    };
  }

  function touch(adapter, docId) {
    var meta = readMeta(adapter, docId);
    if (!meta) return;
    meta.lastOpenedAt = new Date().toISOString();
    meta.writer = { instanceId: INSTANCE, at: meta.lastOpenedAt };
    adapter.set(TP.storage.metaKey(docId), meta);
  }

  function bytesFor(adapter, docId) {
    var total = 0;
    var keys = adapter.keys(TP.storage.DOC_PREFIX + docId);
    for (var i = 0; i < keys.length; i++) {
      var v = adapter.get(keys[i]);
      total += keys[i].length + (v ? JSON.stringify(v).length : 0);
    }
    return total;
  }

  // ---- App-local state (§9) ----

  function saveConversation(adapter, conv) {
    if (!conv || !conv.id) return;
    adapter.set(TP.storage.convKey(conv.id), conv);
  }

  function listConversations(adapter, tripId) {
    var keys = adapter.keys(TP.storage.CONV_PREFIX);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var c = adapter.get(keys[i]);
      if (c && (!tripId || c.tripId === tripId)) out.push(c);
    }
    out.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    return out;
  }

  // Deleting a document's conversations (REQ-413). Scoped by `tripId` exactly as
  // `listConversations` is, so one document's clear cannot touch another's. A falsy `tripId`
  // deletes NOTHING rather than everything — "all" is not a thing this call means, and the
  // difference matters because a missing document id must not become a browser-wide wipe. Storage
  // absent or read-only is a clean zero (PAT-INV-02), not an exception the caller must catch.
  function deleteConversations(adapter, tripId) {
    if (!adapter || !adapter.available() || !tripId) return 0;
    var keys = adapter.keys(TP.storage.CONV_PREFIX);
    var removed = 0;
    for (var i = 0; i < keys.length; i++) {
      var c = adapter.get(keys[i]);
      if (c && c.tripId === tripId) { adapter.del(keys[i]); removed++; }
    }
    return removed;
  }

  // ---- Migration from IndexedDB (§8, REQ-411) ----
  //
  // Served mode only: IndexedDB is blocked on some file:// origins, and a migration that
  // appears to find nothing is worse than one that says it could not look.

  function idbAvailable() {
    try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
  }

  function migrateFromIndexedDB(adapter, options) {
    var opts = options || {};
    if (!idbAvailable()) {
      return { ok: false, reason: 'unavailable',
        message: 'This browser does not expose IndexedDB here, so the app cannot look for older trips. Nothing was changed.' };
    }
    if (TP.environment && TP.environment.isFile) {
      return { ok: false, reason: 'file',
        message: 'Older trips live in a browser database that some browsers block for files opened from disk. ' +
          'Open this planner from a web address to import them. Nothing was changed.' };
    }
    return readIndexedDBTrips().then(function (trips) {
      if (!trips.length) {
        return { ok: true, imported: 0, message: 'No older trips were found. Nothing was changed.' };
      }
      var imported = [];
      for (var i = 0; i < trips.length; i++) {
        var doc = buildDocumentFromLegacyTrip(trips[i]);
        var res = writeDocument(adapter, doc.container, { force: true });
        if (!res.ok) return res;
        register(adapter, { docId: doc.docId, title: doc.title, updatedAt: new Date().toISOString() });
        imported.push({ docId: doc.docId, title: doc.title });
      }
      return {
        ok: true,
        imported: imported.length,
        docs: imported,
        message: imported.length + (imported.length === 1 ? ' trip imported. Each is now its own document.' : ' trips imported. Each is now its own document.'),
        // The IndexedDB data is deliberately NOT deleted (REQ-318, PAT-INV-05). A migration
        // that fails halfway must leave the source intact.
        sourceUntouched: true,
      };
    }).catch(function (e) {
      return { ok: false, reason: 'error', message: 'The older trips could not be read: ' + (e && e.message ? e.message : e) + '. Nothing was changed.' };
    });
  }

  function readIndexedDBTrips() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('trip-planner', 1);
      req.onupgradeneeded = function () {
        // The database does not exist yet: there is nothing to migrate. Creating the stores
        // here would be a lie about what was found.
        reject(new Error('no existing database'));
      };
      req.onerror = function () { reject(req.error || new Error('could not open the database')); };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('trips')) { resolve([]); return; }
        var tx = db.transaction('trips', 'readonly');
        var all = tx.objectStore('trips').getAll();
        all.onsuccess = function () { resolve(all.result || []); };
        all.onerror = function () { reject(all.error); };
      };
    });
  }

  // A legacy trip becomes a document: a fresh docId, a root commit whose payload is the
  // trip normalised into the canonical model, written through the normal write ordering.
  function buildDocumentFromLegacyTrip(legacy) {
    var docId = TP.uid();
    var trip = TP.model.normalize(TP.uid ? TP.model.clone(legacy) : legacy, docId);
    trip.docId = docId;
    var payload = { trip: trip };
    var history = TP.history.newHistory();
    var appended = TP.history.append(history, payload, {
      docId: docId,
      author: { name: 'Imported from IndexedDB', email: '' },
      timestamp: new Date().toISOString(),
      message: 'Imported from the earlier version of this planner',
    });
    var container = TP.container.create(payload, {
      appVersion: '0.2.0',
      appHash: '',
      generatedAt: new Date().toISOString(),
    }, appended.history);
    return { docId: docId, title: TP.model.tripTitle(trip), container: container };
  }

  return {
    WRITER_STALE_MS: WRITER_STALE_MS,
    instanceId: instanceId,
    load: load,
    save: save,
    entry: entry,
    register: register,
    removeEntry: removeEntry,
    readMeta: readMeta,
    localHistory: localHistory,
    hasLocal: hasLocal,
    writeDocument: writeDocument,
    forget: forget,
    claimWriter: claimWriter,
    touch: touch,
    bytesFor: bytesFor,
    saveConversation: saveConversation,
    listConversations: listConversations,
    deleteConversations: deleteConversations,
    idbAvailable: idbAvailable,
    migrateFromIndexedDB: migrateFromIndexedDB,
    buildDocumentFromLegacyTrip: buildDocumentFromLegacyTrip,
  };
})();
