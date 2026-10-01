// The real store. Synchronous, which the deterministic boot sequence needs (REQ-612), and
// its ~5 MB ceiling is a problem this design handles rather than one it pretends not to have
// (05-storage.md §6).

TP.storageLocalstorage = (function () {
  'use strict';

  function create(backing) {
    var ls = backing || null;
    var ok = true;

    function store() {
      if (ls) return ls;
      try {
        // Touching localStorage can throw outright under file:// in some configurations.
        ls = window.localStorage;
        ls.getItem('tp.probe');
      } catch (e) {
        ok = false;
        ls = null;
      }
      return ls;
    }

    function get(key) {
      var s = store();
      if (!s) return null;
      var raw;
      try { raw = s.getItem(key); } catch (e) { ok = false; return null; }
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function set(key, value) {
      var s = store();
      if (!s) throw new TP.storage.ReadOnlyError('This browser gives the page no writable storage, so nothing can be saved locally.');
      var raw = JSON.stringify(value);
      try {
        s.setItem(key, raw);
      } catch (e) {
        if (TP.storage.isQuota(e)) {
          throw new TP.storage.QuotaError(
            'Local storage is full, so "' + key + '" could not be written. Nothing was deleted — ' +
            'your history may be the only copy. Export this document, then compact its history in Settings.');
        }
        ok = false;
        throw new TP.storage.ReadOnlyError('Local storage refused the write: ' + (e && e.message ? e.message : e));
      }
      return value;
    }

    function del(key) {
      var s = store();
      if (!s) return;
      try { s.removeItem(key); } catch (e) { ok = false; }
    }

    function keys(prefix) {
      var s = store();
      if (!s) return [];
      var out = [];
      try {
        for (var i = 0; i < s.length; i++) {
          var k = s.key(i);
          if (k && (!prefix || k.indexOf(prefix) === 0)) out.push(k);
        }
      } catch (e) { ok = false; }
      return out;
    }

    function bytesUsed() {
      var s = store();
      if (!s) return 0;
      var total = 0;
      try {
        for (var i = 0; i < s.length; i++) {
          var k = s.key(i);
          if (!k) continue;
          var v = s.getItem(k);
          total += k.length + (v ? v.length : 0);
        }
      } catch (e) { /* report what we measured */ }
      return total;
    }

    function available() {
      store();
      return ok && !!ls;
    }

    function kind() { return 'localstorage'; }
    function describe() {
      return available()
        ? 'Stored in this browser (localStorage)'
        : 'This browser gives the page no writable storage';
    }

    return {
      get: get, set: set, del: del, keys: keys,
      bytesUsed: bytesUsed, available: available,
      kind: kind, describe: describe,
    };
  }

  return { create: create };
})();
