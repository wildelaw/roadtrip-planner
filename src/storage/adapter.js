// The storage seam (specs/05-storage.md §2, REQ-401, PAT-INV-12).
//
//   get(key)        -> value | null
//   set(key, value) -> void; throws QuotaError
//   del(key)        -> void
//   keys(prefix)    -> string[]
//   bytesUsed()     -> number
//   available()     -> boolean
//
// Nothing else touches a storage API. "Storage is unavailable" is a configuration, not a
// code path (PAT-DEC-12): three implementations, chosen once at boot, mean the "cannot
// persist" case is exercised by the same code as the normal case rather than by a branch
// inside every feature.

TP.storage = (function () {
  'use strict';

  var REGISTRY_KEY = 'tp.registry';
  var SETTINGS_KEY = 'tp.app.settings';
  var DOC_PREFIX = 'tp.doc.';
  var META_SUFFIX = '.meta';
  var COMMIT_INFIX = '.c.';
  var CONV_PREFIX = 'tp.app.conv.';

  function QuotaError(message) {
    this.name = 'QuotaError';
    this.message = message;
    this.quota = true;
  }
  QuotaError.prototype = Object.create(Error.prototype);

  function ReadOnlyError(message) {
    this.name = 'ReadOnlyError';
    this.message = message;
    this.readOnly = true;
  }
  ReadOnlyError.prototype = Object.create(Error.prototype);

  function metaKey(docId) { return DOC_PREFIX + docId + META_SUFFIX; }
  function commitKey(docId, commitId) { return DOC_PREFIX + docId + COMMIT_INFIX + commitId; }
  function commitPrefix(docId) { return DOC_PREFIX + docId + COMMIT_INFIX; }
  function convKey(id) { return CONV_PREFIX + id; }

  function isQuota(err) {
    if (!err) return false;
    var name = err.name || '';
    var msg = String(err.message || '');
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 || err.code === 1014 || /quota/i.test(msg);
  }

  // Which adapter to use, decided once, at boot (02-architecture.md §6 step 3).
  function choose(options) {
    var opts = options || {};
    if (opts.force) return create(opts.force);
    if (opts.readOnly) return create('null');
    return create('localstorage');
  }

  function create(kind) {
    if (kind === 'memory') return TP.storageMemory.create();
    if (kind === 'null') return TP.storageNull.create();
    var ls = TP.storageLocalstorage.create();
    if (ls.available()) return ls;
    // localStorage threw on access — some file:// configurations, private windows, blocked
    // site data. The session still works, and every operation still reaches a correct
    // outcome (REQ-403).
    var mem = TP.storageMemory.create();
    mem.downgraded = true;
    return mem;
  }

  return {
    REGISTRY_KEY: REGISTRY_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    DOC_PREFIX: DOC_PREFIX,
    COMMIT_INFIX: COMMIT_INFIX,
    CONV_PREFIX: CONV_PREFIX,
    QuotaError: QuotaError,
    ReadOnlyError: ReadOnlyError,
    isQuota: isQuota,
    metaKey: metaKey,
    commitKey: commitKey,
    commitPrefix: commitPrefix,
    convKey: convKey,
    choose: choose,
    create: create,
  };
})();
